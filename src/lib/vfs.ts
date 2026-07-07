import { Api } from 'telegram';
import { getClient } from './telegram';
import { CustomFile } from 'telegram/client/uploads';
import { Buffer } from 'buffer';
import { db } from './db';

export interface DriveItem {
  id: number;
  name: string;
  isFolder: boolean;
  path: string; // Đường dẫn cha, ví dụ: '/'
  size?: number;
  date: number;
  mimeType?: string;
  tags?: string[];
  messageObj?: Api.Message;
}

let cachedStorageEntity: any = null;

export async function getStorageEntity() {
  if (cachedStorageEntity) return cachedStorageEntity;
  const client = await getClient();
  
  const dialogs = await client.getDialogs({});
  const channel = dialogs.find(d => d.title === 'TeleDrive Storage' && d.isChannel);

  if (channel) {
    cachedStorageEntity = channel.entity;
    return cachedStorageEntity;
  }

  // Create channel if not exists
  const result: any = await client.invoke(
    new Api.channels.CreateChannel({
      broadcast: true,
      megagroup: false,
      title: 'TeleDrive Storage',
      about: 'DO NOT DELETE. This channel is used by TeleDrive Web to store your cloud files.',
    })
  );
  
  if (result.chats && result.chats.length > 0) {
    cachedStorageEntity = result.chats[0];
    return cachedStorageEntity;
  }
  
  return 'me'; // Fallback
}

export async function fetchDriveItems(): Promise<DriveItem[]> {
  const client = await getClient();
  const entity = await getStorageEntity();
  
  let localItems = await db.files.toArray();
  const highestId = localItems.length > 0 ? Math.max(...localItems.map(i => i.id)) : 0;
  
  const messages = await client.getMessages(entity, {
    minId: highestId,
    limit: 1000,
  });

  const newItems: any[] = [];

  for (const msg of messages) {
    if (!msg) continue;
    if ((msg as any).className === 'MessageEmpty') continue;
    
    if (typeof msg.message !== 'string') continue;
    if (!msg.message.includes('#teledrive')) continue;
    
    try {
      const text = msg.message;
      const jsonStr = text.substring(text.indexOf('#teledrive') + 10).trim();
      const meta = jsonStr ? JSON.parse(jsonStr) : {};

      if (msg.document) {
        const doc = msg.document;
        let fileName = meta.name;
        if (!fileName) {
          const fnAttr = doc.attributes.find((a: any) => a.className === 'DocumentAttributeFilename');
          fileName = fnAttr ? (fnAttr as any).fileName : 'Unknown File';
        }
        newItems.push({
          id: msg.id, name: fileName, isFolder: false, path: meta.path || '/',
          size: Number(doc.size), date: msg.date, mimeType: doc.mimeType, messageObj: msg
        });
      } else if (meta.type === 'folder') {
        newItems.push({
          id: msg.id, name: meta.name || 'New Folder', isFolder: true,
          path: meta.path || '/', date: msg.date, messageObj: msg
        });
      }
    } catch (e) {
      console.warn("Lỗi parse metadata:", msg.id);
    }
  }

  if (newItems.length > 0) {
     const dbItems = newItems.map(i => ({
        id: i.id, name: i.name, isFolder: i.isFolder, path: i.path,
        size: i.size || 0, date: i.date, mimeType: i.mimeType || ''
     }));
     await db.files.bulkPut(dbItems);
     
     const newIds = new Set(newItems.map(i => i.id));
     localItems = [...localItems.filter(i => !newIds.has(i.id)), ...newItems];
  }

  return localItems.map(i => {
     const found = newItems.find(n => n.id === i.id);
     return {
        id: i.id, name: i.name, isFolder: i.isFolder, path: i.path,
        size: i.size, date: i.date, mimeType: i.mimeType,
        messageObj: found?.messageObj
     };
  }).sort((a, b) => b.id - a.id);
}

export async function uploadFile(file: File, parentPath: string, onProgress?: (p: number) => void): Promise<void> {
  const client = await getClient();
  const entity = await getStorageEntity();
  const caption = `#teledrive ${JSON.stringify({ path: parentPath, name: file.name })}`;
  
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const customFile = new CustomFile(file.name, file.size, "", buffer);

  const result: any = await client.sendFile(entity, {
    file: customFile,
    caption: caption,
    forceDocument: true,
    progressCallback: (progress: any, total?: any) => {
      let p = 0;
      if (total && total.toJSNumber) p = progress.toJSNumber() / total.toJSNumber();
      else p = Number(progress);
      if (onProgress) onProgress(p * 100);
    }
  });

  if (result && result.id) {
     await db.files.put({
        id: result.id, name: file.name, isFolder: false, path: parentPath,
        size: file.size, date: result.date, mimeType: file.type || 'application/octet-stream'
     });
  }
}

export async function createFolder(name: string, parentPath: string): Promise<void> {
  const client = await getClient();
  const entity = await getStorageEntity();
  const text = `#teledrive ${JSON.stringify({ type: 'folder', name, path: parentPath })}`;
  
  const result: any = await client.sendMessage(entity, { message: text });
  
  if (result && result.id) {
    await db.files.put({
      id: result.id, name, isFolder: true, path: parentPath, size: 0, date: result.date, mimeType: ''
    });
  }
}

export async function moveItemRecursive(item: DriveItem, newPath: string, allItems: DriveItem[]): Promise<void> {
  const client = await getClient();
  const entity = await getStorageEntity();
  
  if (item.id > 0) {
    const meta = item.isFolder ? { type: 'folder', name: item.name, path: newPath } : { path: newPath, name: item.name };
    await client.editMessage(entity, { message: item.id, text: `#teledrive ${JSON.stringify(meta)}` });
    await db.files.update(item.id, { path: newPath });
  }

  if (item.isFolder) {
    const oldFullPath = item.path === '/' ? `/${item.name}` : `${item.path}/${item.name}`;
    const newFullPath = newPath === '/' ? `/${item.name}` : `${newPath}/${item.name}`;
    
    const children = allItems.filter(i => i.path === oldFullPath || i.path.startsWith(oldFullPath + '/'));
    for (const child of children) {
      if (child.id > 0) {
         const childNewPath = child.path.replace(oldFullPath, newFullPath);
         const childMeta = child.isFolder
           ? { type: 'folder', name: child.name, path: childNewPath }
           : { path: childNewPath, name: child.name };
         await client.editMessage(entity, { message: child.id, text: `#teledrive ${JSON.stringify(childMeta)}` });
         await db.files.update(child.id, { path: childNewPath });
      }
    }
  }
}

export async function deleteItem(messageId: number): Promise<void> {
  const client = await getClient();
  const entity = await getStorageEntity();
  await client.deleteMessages(entity, [messageId], { revoke: true });
  await db.files.delete(messageId);
}

async function ensureMessageObj(item: DriveItem): Promise<Api.Message | null> {
  if (item.messageObj) return item.messageObj as any;
  const client = await getClient();
  const entity = await getStorageEntity();
  const messages = await client.getMessages(entity, { ids: item.id });
  if (messages && messages.length > 0) return messages[0] as any;
  return null;
}

export async function downloadFile(item: DriveItem, onProgress?: (p: number) => void): Promise<string | null> {
  const msgObj = await ensureMessageObj(item);
  if (!msgObj) return null;
  const client = await getClient();
  
  const buffer = await client.downloadMedia(msgObj, {
    progressCallback: (progress: any, total?: any) => {
      let p = 0;
      if (total && total.toJSNumber) p = progress.toJSNumber() / total.toJSNumber();
      else p = Number(progress);
      if (onProgress) onProgress(p * 100);
    }
  });

  if (buffer) {
    const blob = new Blob([buffer as any], { type: item.mimeType || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  }
  return null;
}

export async function downloadThumbnail(item: DriveItem): Promise<string | null> {
  if (!item.mimeType?.startsWith('image/')) return null;
  const msgObj = await ensureMessageObj(item);
  if (!msgObj) return null;
  const client = await getClient();
  try {
    const buffer = await client.downloadMedia(msgObj, { thumb: 1 });
    if (buffer && buffer.length > 0) {
      const blob = new Blob([buffer as any], { type: 'image/jpeg' });
      return URL.createObjectURL(blob);
    }
  } catch (e) {
    try {
      const buf2 = await client.downloadMedia(msgObj, { thumb: 0 });
      if (buf2 && buf2.length > 0) {
        const blob = new Blob([buf2 as any], { type: 'image/jpeg' });
        return URL.createObjectURL(blob);
      }
    } catch (e2) {
      console.warn("Lỗi tải thumbnail:", e2);
    }
  }
  return null;
}
