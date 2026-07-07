import Dexie, { type EntityTable } from 'dexie';

export interface FileRecord {
  id: number;
  name: string;
  isFolder: boolean;
  path: string;
  size: number;
  date: number;
  mimeType: string;
  tags?: string[];
}

export interface SessionRecord {
  id: string;
  sessionString: string;
}

const db = new Dexie('TelePhotosDB') as Dexie & {
  files: EntityTable<FileRecord, 'id'>;
  sessions: EntityTable<SessionRecord, 'id'>;
};

db.version(1).stores({
  files: 'id, name, path, date, mimeType, isFolder',
  sessions: 'id'
});

db.version(2).stores({
  files: 'id, name, path, date, mimeType, isFolder, *tags',
});

export { db };
