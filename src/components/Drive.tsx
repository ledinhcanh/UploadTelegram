import React, { useState, useEffect, useRef } from 'react';
import { Folder, File, Upload, FolderPlus, Download, Trash2, Home, ChevronRight, ChevronLeft, Loader, MoreVertical, Eye, X, FileImage, FileText, FileVideo, FileArchive, LayoutGrid, Image as ImageIcon, CheckSquare, Square, CornerUpRight, AlertTriangle, List as ListIcon, AlignJustify, Grid as GridIcon, Settings2, Search, Play, Moon, Sun, LogOut, Menu } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { fetchDriveItems, uploadFile, createFolder, deleteItem, downloadFile, downloadThumbnail, moveItemRecursive } from '../lib/vfs';
import type { DriveItem } from '../lib/vfs';
const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const isImageItem = (item: DriveItem) => !!(item.mimeType?.startsWith('image/'));
const isVideoItem = (item: DriveItem) => !!(item.mimeType?.startsWith('video/'));

const getFileIcon = (mimeType?: string, size: number = 36) => {
  if (!mimeType) return <File size={size} color="var(--text-secondary)" style={{ flexShrink: 0 }} />;
  if (mimeType.startsWith('image/')) return <FileImage size={size} color="#3b82f6" style={{ flexShrink: 0 }} />;
  if (mimeType.startsWith('video/')) return <FileVideo size={size} color="#ef4444" style={{ flexShrink: 0 }} />;
  if (mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('text')) return <FileText size={size} color="#f59e0b" style={{ flexShrink: 0 }} />;
  if (mimeType.includes('zip') || mimeType.includes('rar')) return <FileArchive size={size} color="#8b5cf6" style={{ flexShrink: 0 }} />;
  return <File size={size} color="var(--text-secondary)" style={{ flexShrink: 0 }} />;
};

type ViewMode = 'details' | 'list' | 'medium' | 'large' | 'extra_large';

interface DriveProps {
  onLogout: () => void;
}

const Drive: React.FC<DriveProps> = ({ onLogout }) => {
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('/');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadQueue, setUploadQueue] = useState({ total: 0, current: 0 });

  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fullUrls, setFullUrls] = useState<Record<number, string>>({});
  const [zoom, setZoom] = useState(1);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadAllProgress, setDownloadAllProgress] = useState({ current: 0, total: 0 });
  const [activeMenu, setActiveMenu] = useState<{ id: number, x: number, y: number } | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  type SortField = 'name' | 'date' | 'size';
  type SortDirection = 'asc' | 'desc';
  const [sortConfig, setSortConfig] = useState<{ field: SortField, direction: SortDirection }>({ field: 'name', direction: 'asc' });

  // View modes
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('viewMode') as ViewMode) || 'details');
  useEffect(() => { localStorage.setItem('viewMode', viewMode); }, [viewMode]);
  const [showViewMenu, setShowViewMenu] = useState(false);
  
  // Phase 8: Tabs & Search
  const [currentTab, setCurrentTab] = useState<'drive' | 'photos'>('drive');
  const [searchQuery, setSearchQuery] = useState('');
  const [photosVisibleCount, setPhotosVisibleCount] = useState(50);
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
     if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
     } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
     }
  }, [isDark]);

  useEffect(() => {
    setZoom(1);
  }, [previewItem]);

  const aiWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    import('../lib/aiWorker?worker').then((WorkerModule) => {
        const worker = new WorkerModule.default();
        worker.postMessage({ type: 'LOAD_MODEL' });
        worker.onmessage = (e) => {
           if (e.data.type === 'CLASSIFY_RESULT') {
               const { id, tags } = e.data;
               import('../lib/db').then(({ db }) => {
                   db.files.update(id, { tags });
                   setItems(prev => prev.map(i => i.id === id ? { ...i, tags } : i));
               });
           }
        };
        aiWorkerRef.current = worker;
    });

    return () => {
       if (aiWorkerRef.current) aiWorkerRef.current.terminate();
    };
  }, []);

  // Multi-select & Modals
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{type: 'createFolder' | 'move' | 'delete', data?: any} | null>(null);
  const [modalInput, setModalInput] = useState('');
  const [modalError, setModalError] = useState('');

  const loadItems = async () => {
    setLoading(true);
    try {
      const allItems = await fetchDriveItems();
      setItems(allItems);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    const handleClick = () => { setActiveMenu(null); setShowViewMenu(false); };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    setUploadQueue({ total: files.length, current: 1 });
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadQueue({ total: files.length, current: i + 1 });
        
        let targetPath = currentPath;
        if (file.webkitRelativePath) {
           const parts = file.webkitRelativePath.split('/');
           parts.pop();
           const relativeDir = parts.join('/');
           if (relativeDir) {
              targetPath = currentPath === '/' ? `/${relativeDir}` : `${currentPath}/${relativeDir}`;
           }
        }

        // Overwrite logic: Xóa file cũ nếu trùng tên và đường dẫn
        const existingFile = items.find(item => item.name === file.name && item.path === targetPath && !item.isFolder);
        if (existingFile) {
            await deleteItem(existingFile.id);
            setItems(prev => prev.filter(p => p.id !== existingFile.id));
        }

        let fileToUpload: globalThis.File | Blob = file;

        await uploadFile(fileToUpload as globalThis.File, targetPath, (p) => setUploadProgress(p));
        setUploadProgress(0);
      }
      await loadItems();
    } catch (err: any) {
      console.error(err);
      alert('Tải lên thất bại! Lỗi: ' + String(err.message || err));
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadQueue({ total: 0, current: 0 });
      e.target.value = '';
    }
  };

  const handleDownload = async (item: DriveItem) => {
    try {
      let url = await downloadFile(item, () => { });
      
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = item.name;
        a.click();
        
        setTimeout(() => URL.revokeObjectURL(url!), 1000);
      }
    } catch (err: any) {
      console.error(err);
      alert('Lỗi khi tải xuống: ' + String(err.message || err));
    }
  };

  const handleDownloadAllPhotos = async () => {
    const photos = items.filter(i => !i.isFolder && (isImageItem(i) || isVideoItem(i)));
    if (photos.length === 0) return;
    
    setDownloadingAll(true);
    setDownloadAllProgress({ current: 0, total: photos.length });
    
    // TRÌNH DUYỆT CHROME/V8 ENGINE CÓ GIỚI HẠN RAM KHOẢNG 2GB-4GB MỖI TAB.
    // Nếu để lên 5GB, 99% trình duyệt sẽ bị sập (Out of Memory - Aw Snap!)
    // Theo yêu cầu từ hệ thống có 24GB RAM, mốc này được nâng lên 5GB.
    const MAX_CHUNK_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
    
    try {
      let zip = new JSZip();
      let currentZipSize = 0;
      let partIndex = 1;
      let hasFiles = false;

      for (let i = 0; i < photos.length; i++) {
        const item = photos[i];
        setDownloadAllProgress({ current: i + 1, total: photos.length });
        
        const blobUrl = await downloadFile(item);
        if (blobUrl) {
           const res = await fetch(blobUrl);
           const blob = await res.blob();
           
           // Nếu nạp thêm file này bị lố 5GB, ta chốt và xuất Part hiện tại trước
           if (currentZipSize + blob.size > MAX_CHUNK_SIZE && hasFiles) {
              const zipBlob = await zip.generateAsync({ type: 'blob' });
              saveAs(zipBlob, `TeleDrive_Photos_Part${partIndex}.zip`);
              
              // Xóa sạch RAM rác, làm Part tiếp theo
              zip = new JSZip();
              currentZipSize = 0;
              partIndex++;
              hasFiles = false;
           }
           
           zip.file(item.name, blob);
           currentZipSize += blob.size;
           hasFiles = true;
           
           URL.revokeObjectURL(blobUrl);
        }
      }
      
      // Chốt nốt các file sót lại của Part cuối cùng
      if (hasFiles) {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const fileName = partIndex === 1 ? 'TeleDrive_Photos.zip' : `TeleDrive_Photos_Part${partIndex}.zip`;
        saveAs(zipBlob, fileName);
      }
      
    } catch (err: any) {
      console.error(err);
      alert('Lỗi tải xuống tất cả: ' + String(err.message || err));
    } finally {
      setDownloadingAll(false);
      setDownloadAllProgress({ current: 0, total: 0 });
    }
  };


  const handlePreview = async (item: DriveItem) => {
    const isImage = isImageItem(item);
    const isVideo = isVideoItem(item);

    if (isImage || isVideo) {
      setPreviewItem(item);
      
      if (isImage && thumbnails[item.id]) {
        setPreviewUrl(thumbnails[item.id]);
      } else {
        setPreviewUrl(null);
      }

      if (!fullUrls[item.id]) {
         setLoading(true);
         try {
           let url = await downloadFile(item, () => {});
           if (url) {
             setFullUrls(prev => ({ ...prev, [item.id]: url }));
           }
         } catch (err) {
           console.error(err);
         } finally {
           setLoading(false);
         }
      }
    } else {
      handleDownload(item);
    }
  };

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setSelectedIds(new Set());
    setSearchQuery('');
    setIsMobileSidebarOpen(false);
  };

  // Logic lấy danh sách hiển thị
  let allDisplayed: DriveItem[] = [];
  const subfolders = new Set<string>();

  if (currentTab === 'photos') {
      let photos = items.filter(i => !i.isFolder && (isImageItem(i) || isVideoItem(i)));
      if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          photos = photos.filter(i => i.name.toLowerCase().includes(q) || (i.tags && i.tags.some(t => t.toLowerCase().includes(q))));
      }
      allDisplayed = photos.sort((a, b) => b.date - a.date);
  } else {
      if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          allDisplayed = items.filter(i => 
             i.name.toLowerCase().includes(q) || 
             (i.tags && i.tags.some(t => t.includes(q)))
          );
      } else {
          const displayedItems = items.filter(i => i.path === currentPath);
          items.forEach(item => {
            if (item.path.startsWith(currentPath) && item.path !== currentPath) {
               const relativePath = item.path.substring(currentPath === '/' ? 1 : currentPath.length + 1);
               const nextSlash = relativePath.indexOf('/');
               const folderName = nextSlash === -1 ? relativePath : relativePath.substring(0, nextSlash);
               if (folderName) subfolders.add(folderName);
            }
          });
          const virtualFolders = Array.from(subfolders).filter(f => !displayedItems.find(di => di.isFolder && di.name === f)).map(f => ({
            id: -1 * Math.random(),
            name: f,
            isFolder: true,
            path: currentPath,
            date: Date.now()
          } as DriveItem));
          
          allDisplayed = [...displayedItems, ...virtualFolders].sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            
            let compareResult = 0;
            if (sortConfig.field === 'name') {
              compareResult = a.name.localeCompare(b.name);
            } else if (sortConfig.field === 'date') {
              compareResult = a.date - b.date;
            } else if (sortConfig.field === 'size') {
              const sizeA = a.size || 0;
              const sizeB = b.size || 0;
              compareResult = sizeA - sizeB;
            }
            return sortConfig.direction === 'asc' ? compareResult : -compareResult;
          });
      }
  }

  useEffect(() => {
    if (viewMode === 'large' || viewMode === 'extra_large' || viewMode === 'medium' || viewMode === 'details') {
      const itemsToFetch = currentTab === 'photos' ? allDisplayed.slice(0, photosVisibleCount) : allDisplayed;
      itemsToFetch.forEach(async (item) => {
        const isNormalImage = item.mimeType?.startsWith('image/');

        if (!item.isFolder && isImageItem(item) && !thumbnails[item.id]) {
           if (isNormalImage) {
               const url = await downloadThumbnail(item);
               if (url) {
                 setThumbnails(prev => ({ ...prev, [item.id]: url }));
                 
                 if (aiWorkerRef.current && (!item.tags || item.tags.length === 0)) {
                    const img = new Image();
                    img.onload = async () => {
                       try {
                           const bitmap = await createImageBitmap(img);
                           aiWorkerRef.current?.postMessage({ type: 'CLASSIFY', id: item.id, imageBitmap: bitmap }, [bitmap]);
                       } catch(e) {}
                    };
                    img.src = url;
                 }
               }
           }
        }
      });
    }
  }, [viewMode, allDisplayed, currentTab, photosVisibleCount]);

  const getFolderItemCount = (folderName: string, parentPath: string) => {
    const fullPath = parentPath === '/' ? `/${folderName}` : `${parentPath}/${folderName}`;
    return items.filter(i => i.path === fullPath || i.path.startsWith(fullPath + '/')).length;
  };

  const getSubfoldersList = () => {
    const allPaths = new Set<string>();
    allPaths.add('/');
    items.forEach(i => {
      if (i.isFolder) {
        const full = i.path === '/' ? `/${i.name}` : `${i.path}/${i.name}`;
        allPaths.add(full);
      }
    });
    return Array.from(allPaths).sort();
  };

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleBulkAction = (type: 'delete' | 'move') => {
    const selectedItems = allDisplayed.filter(i => selectedIds.has(i.id));
    if (selectedItems.length === 0) return;
    setModalError('');
    if (type === 'delete') {
      for (const item of selectedItems) {
         if (item.isFolder) {
            const count = getFolderItemCount(item.name, item.path);
            if (count > 0) {
               setModalError(`Không thể xóa thư mục "${item.name}" vì vẫn còn ${count} mục bên trong.`);
               setModal({ type: 'delete', data: selectedItems });
               return;
            }
         }
      }
    }
    if (type === 'move') setModalInput('/');
    setModal({ type, data: selectedItems });
  };

  const executeModalAction = async () => {
    if (!modal) return;
    setLoading(true);
    const actionData = modal.data;
    const actionType = modal.type;
    const destPath = modalInput;
    setModal(null);
    setModalInput('');

    try {
      if (actionType === 'createFolder') {
        if (!destPath || destPath.includes('/')) throw new Error("Tên không hợp lệ");
        await createFolder(destPath, currentPath);
      } else if (actionType === 'delete') {
        for (const item of actionData) {
          if (item.id > 0) await deleteItem(item.id);
        }
        setSelectedIds(new Set());
      } else if (actionType === 'move') {
        for (const item of actionData) {
          await moveItemRecursive(item, destPath, items);
        }
        setSelectedIds(new Set());
      }
      await loadItems();
    } catch (e) {
      console.error(e);
      alert('Thao tác thất bại');
    } finally {
      setLoading(false);
    }
  };

  const previewableItems = allDisplayed.filter(i => !i.isFolder && (isImageItem(i) || isVideoItem(i)));
  const currentPreviewIndex = previewItem ? previewableItems.findIndex(i => i.id === previewItem.id) : -1;

  const navigatePreview = (direction: 'prev' | 'next') => {
    if (currentPreviewIndex === -1) return;
    let newIndex = direction === 'next' ? currentPreviewIndex + 1 : currentPreviewIndex - 1;
    if (newIndex < 0) newIndex = previewableItems.length - 1;
    if (newIndex >= previewableItems.length) newIndex = 0;
    handlePreview(previewableItems[newIndex]);
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  const viewOptions = [
    { id: 'details', icon: <ListIcon size={16} />, label: 'Chi tiết (Details)' },
    { id: 'list', icon: <AlignJustify size={16} />, label: 'Danh sách (List)' },
    { id: 'medium', icon: <GridIcon size={16} />, label: 'Biểu tượng vừa' },
    { id: 'large', icon: <ImageIcon size={16} />, label: 'Biểu tượng lớn' },
    { id: 'extra_large', icon: <LayoutGrid size={16} />, label: 'Biểu tượng rất lớn' },
  ];
  const activeViewOption = viewOptions.find(o => o.id === viewMode);

  const getGridContainerStyle = () => {
    switch (viewMode) {
       case 'details': return { display: 'flex', flexDirection: 'column' as const };
       case 'list': return { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px', alignContent: 'start' };
       case 'medium': return { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px', alignContent: 'start' };
       case 'large': return { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '24px', alignContent: 'start' };
       case 'extra_large': return { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '32px', alignContent: 'start' };
       default: return {};
    }
  };

  const renderItemCard = (item: DriveItem) => {
      const isSelected = selectedIds.has(item.id);
      
      const handleItemClick = (e: React.MouseEvent) => {
         if (e.ctrlKey || e.metaKey) { toggleSelect(item.id); } 
         else {
            if (item.isFolder) {
              const newPath = currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`;
              navigateTo(newPath);
            } else { toggleSelect(item.id); }
         }
      };

      const handleItemDoubleClick = () => { if (!item.isFolder) handlePreview(item); };

      // === DETAILS VIEW ===
      if (viewMode === 'details') {
         return (
            <div 
               key={item.id}
               style={{ 
                  display: 'flex', alignItems: 'center', padding: '12px 16px', 
                  borderBottom: '1px solid var(--border-color)', 
                  background: isSelected ? 'var(--bg-secondary)' : 'transparent', 
                  cursor: 'pointer', position: 'relative'
               }}
               onClick={handleItemClick}
               onDoubleClick={handleItemDoubleClick}
            >
               <div style={{ width: '40px' }} onClick={e => { e.stopPropagation(); toggleSelect(item.id); }}>
                  {isSelected ? <CheckSquare size={18} color="var(--accent-primary)" /> : <Square size={18} color="var(--text-secondary)" />}
               </div>
               <div style={{ flex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 500, overflow: 'hidden', width: '100%' }}>
                     {item.isFolder ? <Folder size={24} color="var(--accent-primary)" style={{ flexShrink: 0 }} /> : getFileIcon(item.mimeType, 24)}
                     <span style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', flex: 1, minWidth: 0, display: 'block' }} title={item.name}>{item.name}</span>
                  </div>
                  <div className="show-on-mobile" style={{ fontSize: '12px', color: 'var(--text-secondary)', gap: '8px', alignItems: 'center' }}>
                     <span>{new Date(item.date * 1000).toLocaleDateString('vi-VN')}</span>
                     <span>•</span>
                     <span>{!item.isFolder ? formatBytes(item.size || 0) : `${getFolderItemCount(item.name, item.path)} mục`}</span>
                  </div>
               </div>
               <div className="hide-on-mobile" style={{ flex: 1, color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {new Date(item.date * 1000).toLocaleDateString('vi-VN')}
               </div>
               <div className="hide-on-mobile" style={{ flex: 1, color: 'var(--text-secondary)', fontSize: '13px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {item.isFolder ? 'Thư mục' : (item.mimeType || 'Tệp tin')}
               </div>
               <div className="hide-on-mobile" style={{ flex: 1, color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {!item.isFolder ? formatBytes(item.size || 0) : `${getFolderItemCount(item.name, item.path)} mục`}
               </div>
               <div style={{ width: '40px', display: 'flex', justifyContent: 'flex-end' }}>
                  <div onClick={(e) => { 
                     e.stopPropagation(); 
                     if (activeMenu?.id === item.id) setActiveMenu(null);
                     else {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setActiveMenu({ id: item.id, x: rect.right - 150, y: rect.bottom + 8 });
                     }
                  }}>
                     <MoreVertical size={18} color="var(--text-secondary)" />
                  </div>
               </div>
            </div>
         );
      }

      // === LIST VIEW ===
      if (viewMode === 'list') {
         return (
            <div 
               key={item.id}
               style={{ 
                  height: '44px', display: 'flex', alignItems: 'center', padding: '0 12px', gap: '12px', 
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)', 
                  borderRadius: 'var(--radius-sm)', background: isSelected ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                  cursor: 'pointer', position: 'relative'
               }}
               onClick={handleItemClick}
               onDoubleClick={handleItemDoubleClick}
            >
               <div onClick={e => { e.stopPropagation(); toggleSelect(item.id); }} style={{ display: 'flex' }}>
                  {isSelected ? <CheckSquare size={16} color="var(--accent-primary)" /> : <Square size={16} color="var(--text-secondary)" />}
               </div>
               {item.isFolder ? <Folder size={20} color="var(--accent-primary)" style={{ flexShrink: 0 }} /> : getFileIcon(item.mimeType, 20)}
               <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '13px', fontWeight: 500 }} title={item.name}>
                  {item.name}
               </div>
               <div onClick={(e) => { 
                  e.stopPropagation(); 
                  if (activeMenu?.id === item.id) setActiveMenu(null);
                  else {
                     const rect = e.currentTarget.getBoundingClientRect();
                     setActiveMenu({ id: item.id, x: rect.right - 150, y: rect.bottom + 8 });
                  }
               }}>
                  <MoreVertical size={16} color="var(--text-secondary)" />
               </div>
            </div>
         );
      }

      // === MEDIUM / LARGE / EXTRA LARGE ICON VIEW (Grid / Gallery) ===
      const isVertical = viewMode === 'large' || viewMode === 'extra_large';
      const cardHeight = viewMode === 'extra_large' ? '400px' : (viewMode === 'large' ? '200px' : '80px');
      return (
         <div 
            key={item.id} 
            className="card animate-fade-in" 
            style={{ 
               padding: isVertical ? '0' : '16px', cursor: 'pointer', display: 'flex', 
               flexDirection: isVertical ? 'column' : 'row', position: 'relative', 
               height: cardHeight, alignItems: isVertical ? 'stretch' : 'center',
               border: isSelected ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
               background: isSelected ? 'var(--bg-secondary)' : 'var(--bg-primary)',
               overflow: 'hidden'
            }}
            onClick={handleItemClick}
            onDoubleClick={handleItemDoubleClick}
         >
            <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 2, cursor: 'pointer', opacity: isSelected ? 1 : 0.2 }} onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}>
              {isSelected ? <CheckSquare size={18} color="var(--accent-primary)" /> : <Square size={18} color="var(--text-secondary)" />}
            </div>

            {isVertical ? (
               <>
                  <div style={{ flex: 1, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderBottom: '1px solid var(--border-color)' }}>
                     {!item.isFolder && isImageItem(item) && thumbnails[item.id] ? (
                        <img src={thumbnails[item.id]} alt="thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                     ) : (
                        item.isFolder ? <Folder size={viewMode === 'extra_large' ? 128 : 64} color="var(--accent-primary)" /> : getFileIcon(item.mimeType, viewMode === 'extra_large' ? 128 : 64)
                     )}
                  </div>
                  <div style={{ height: '60px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                     {item.isFolder ? <Folder size={20} color="var(--accent-primary)" style={{ flexShrink: 0 }} /> : getFileIcon(item.mimeType, 20)}
                     <div style={{ overflow: 'hidden', flex: 1 }}>
                       <div style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }} title={item.name}>{item.name}</div>
                     </div>
                     <div style={{ padding: '4px', borderRadius: '50%', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={(e) => { 
                        e.stopPropagation(); 
                        if (activeMenu?.id === item.id) setActiveMenu(null);
                        else {
                           const rect = e.currentTarget.getBoundingClientRect();
                           setActiveMenu({ id: item.id, x: rect.right - 150, y: rect.bottom + 8 });
                        }
                     }}>
                        <MoreVertical size={18} />
                     </div>
                  </div>
               </>
            ) : (
               <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingLeft: '16px', width: '100%' }}>
                 {item.isFolder ? <Folder size={36} color="var(--accent-primary)" style={{ flexShrink: 0 }} /> : getFileIcon(item.mimeType, 36)}
                 <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }} title={item.name}>{item.name}</div>
                    {!item.isFolder ? (
                       <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{formatBytes(item.size || 0)}</div>
                    ) : (
                       <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{getFolderItemCount(item.name, item.path)} mục</div>
                    )}
                 </div>
                 <div style={{ padding: '4px', borderRadius: '50%', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={(e) => { 
                    e.stopPropagation(); 
                    if (activeMenu?.id === item.id) setActiveMenu(null);
                    else {
                       const rect = e.currentTarget.getBoundingClientRect();
                       setActiveMenu({ id: item.id, x: rect.right - 150, y: rect.bottom + 8 });
                    }
                 }}>
                    <MoreVertical size={18} />
                 </div>
               </div>
            )}
         </div>
      );
  };

  const renderPhotoCard = (item: DriveItem) => {
      const isSelected = selectedIds.has(item.id);
      
      return (
         <div 
            key={item.id} 
            className="photo-card animate-fade-in" 
            style={{ 
               border: isSelected ? '4px solid var(--accent-primary)' : '1px solid transparent',
               transform: isSelected ? 'scale(0.95)' : 'scale(1)',
               boxSizing: 'border-box'
            }}
            onClick={(e) => {
               if (e.ctrlKey || e.metaKey) toggleSelect(item.id);
               else handlePreview(item);
            }}
         >
            {/* Checkbox overlay */}
            <div 
               className={`photo-checkbox ${isSelected ? 'selected' : ''}`}
               onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
            >
              {isSelected ? <CheckSquare size={20} color="var(--accent-primary)" /> : <Square size={20} color="white" />}
            </div>

            {/* Video Indicator */}
            {isVideoItem(item) && (
               <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2, display: 'flex', alignItems: 'center', gap: '4px', color: 'white', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                  <Play size={18} fill="white" />
               </div>
            )}

            {thumbnails[item.id] ? (
               <img src={thumbnails[item.id]} alt="thumb" className="photo-img" />
            ) : (
               <div style={{ width: '100%', height: '100%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isVideoItem(item) ? <FileVideo size={48} color="var(--text-secondary)" /> : <FileImage size={48} color="var(--text-secondary)" />}
               </div>
            )}
         </div>
      );
  };

  const renderContentArea = () => {
     if (loading && items.length === 0) {
        return (
           <div className="flex-center" style={{ height: '100%', flexDirection: 'column' }}>
             <Loader className="animate-spin" size={40} color="var(--accent-primary)" style={{ marginBottom: '16px' }} />
             <p style={{ color: 'var(--text-secondary)' }}>Đang đồng bộ dữ liệu...</p>
           </div>
        );
     }
     if (allDisplayed.length === 0) {
        return (
           <div className="flex-center" style={{ height: '100%', flexDirection: 'column', color: 'var(--text-secondary)' }}>
              <Folder size={64} style={{ marginBottom: '16px', opacity: 0.3 }} />
              <p style={{ fontSize: '16px' }}>{searchQuery ? 'Không tìm thấy kết quả nào' : 'Thư mục này trống'}</p>
           </div>
        );
     }

     if (currentTab === 'photos') {
        const visiblePhotos = allDisplayed.slice(0, photosVisibleCount);
        const groupedPhotos: Record<string, DriveItem[]> = {};
        visiblePhotos.forEach(item => {
           const d = new Date(item.date * 1000);
           const key = d.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
           if (!groupedPhotos[key]) groupedPhotos[key] = [];
           groupedPhotos[key].push(item);
        });

        return (
           <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                 {Object.entries(groupedPhotos).map(([dateLabel, itemsInDate]) => (
                    <div key={dateLabel}>
                       <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)' }}>{dateLabel}</h3>
                       <div className="photo-grid">
                          {itemsInDate.map(item => renderPhotoCard(item))}
                       </div>
                    </div>
                 ))}
                 {photosVisibleCount < allDisplayed.length && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px', paddingBottom: '24px' }}>
                       <button className="btn btn-outline" onClick={() => setPhotosVisibleCount(c => c + 50)}>
                          Tải thêm ảnh...
                       </button>
                    </div>
                 )}
              </div>
           </div>
        );
     }

     return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
           {viewMode === 'details' && (() => {
              const handleSort = (field: SortField) => {
                 setSortConfig(prev => ({
                    field,
                    direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
                 }));
              };
              
              const SortIcon = ({ field }: { field: SortField }) => {
                 if (sortConfig.field !== field) return null;
                 return <span style={{ marginLeft: '4px' }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
              };

              return (
                 <div className="details-header" style={{ display: 'flex', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>
                   <div style={{ width: '40px' }}></div>
                   <div style={{ flex: 3, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>Tên <SortIcon field="name" /></div>
                   <div style={{ flex: 1, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('date')}>Ngày sửa đổi <SortIcon field="date" /></div>
                   <div style={{ flex: 1 }}>Loại</div>
                   <div style={{ flex: 1, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('size')}>Kích thước <SortIcon field="size" /></div>
                   <div style={{ width: '40px' }}></div>
                 </div>
              );
           })()}
           <div style={getGridContainerStyle()}>
              {allDisplayed.map(item => renderItemCard(item))}
           </div>
        </div>
     );
  };

  return (
    <div className="app-container">
      <div className={`sidebar-overlay ${isMobileSidebarOpen ? 'open' : ''}`} onClick={() => setIsMobileSidebarOpen(false)} />
      {/* Sidebar */}
      <div className={`sidebar ${isMobileSidebarOpen ? 'open' : ''}`}>
        <h2 style={{ color: 'var(--accent-primary)', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '24px', fontWeight: 700 }}>
          <Folder color="var(--accent-primary)" /> TeleDrive
        </h2>
        
        <label className="btn btn-primary" style={{ marginBottom: '10px', display: 'flex', cursor: 'pointer', padding: '12px' }}>
          <Upload size={18} /> Tải file lên
          <input type="file" multiple style={{ display: 'none' }} onChange={handleFileUpload} />
        </label>
        <label className="btn btn-primary" style={{ marginBottom: '16px', display: 'flex', cursor: 'pointer', padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)' }}>
          <FolderPlus size={18} /> Tải thư mục lên
          <input type="file" multiple {...{webkitdirectory: "", directory: ""}} style={{ display: 'none' }} onChange={handleFileUpload} />
        </label>
        <button className="btn btn-outline" style={{ marginBottom: '32px', padding: '12px' }} onClick={() => { setModalError(''); setModalInput(''); setModal({ type: 'createFolder' }); }}>
          <FolderPlus size={18} /> Thư mục mới
        </button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div 
            style={{ 
              padding: '12px', background: currentTab === 'drive' ? 'var(--bg-secondary)' : 'transparent', borderRadius: 'var(--radius-md)', 
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer',
              color: currentTab === 'drive' ? 'var(--accent-primary)' : 'var(--text-primary)'
            }} 
            onClick={() => { setCurrentTab('drive'); navigateTo('/'); }}
          >
            <Home size={20} /> My Drive
          </div>
          <div 
            style={{ 
              padding: '12px', background: currentTab === 'photos' ? 'var(--bg-secondary)' : 'transparent', borderRadius: 'var(--radius-md)', 
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer',
              color: currentTab === 'photos' ? 'var(--accent-primary)' : 'var(--text-primary)'
            }} 
            onClick={() => { setCurrentTab('photos'); setSearchQuery(''); setIsMobileSidebarOpen(false); }}
          >
            <ImageIcon size={20} /> Photos
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button className="btn btn-outline" style={{ border: 'none', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'flex-start', padding: '12px' }} onClick={() => setIsDark(!isDark)}>
            {isDark ? <Sun size={20} /> : <Moon size={20} />} {isDark ? 'Chế độ Sáng' : 'Chế độ Tối'}
          </button>
          <button className="btn btn-outline" style={{ border: 'none', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'flex-start', padding: '12px' }} onClick={onLogout}>
            <LogOut size={20} /> Đăng xuất
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        
        {/* Header Area */}
        <div className="header-area">
          
          <div className="header-left">
             <button className="menu-btn" onClick={() => setIsMobileSidebarOpen(true)}>
               <Menu size={24} />
             </button>
             {currentTab === 'drive' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '20px', fontWeight: 600, whiteSpace: 'nowrap', overflowX: 'auto' }}>
                  <span style={{ cursor: 'pointer', color: currentPath === '/' ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'color 0.2s', flexShrink: 0 }} onClick={() => navigateTo('/')}>My Drive</span>
                  {searchQuery ? (
                     <>
                        <ChevronRight size={20} color="var(--text-secondary)" />
                        <span style={{ color: 'var(--text-primary)' }}>Tìm kiếm: "{searchQuery}"</span>
                     </>
                  ) : pathParts.map((part, index) => {
                    const pathSoFar = '/' + pathParts.slice(0, index + 1).join('/');
                    const isLast = index === pathParts.length - 1;
                    return (
                      <React.Fragment key={pathSoFar}>
                        <ChevronRight size={20} color="var(--text-secondary)" />
                        <span style={{ cursor: 'pointer', color: isLast ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'color 0.2s' }} onClick={() => navigateTo(pathSoFar)}>
                          {part}
                        </span>
                      </React.Fragment>
                    )
                  })}
                </div>
             ) : (
                <div style={{ fontSize: '20px', fontWeight: 600 }}>Thư viện Ảnh & Video</div>
             )}
          </div>

          {/* Search Bar */}
          <div className="search-bar">
             <Search size={18} color="var(--text-secondary)" />
             <input 
                type="text" 
                placeholder={currentTab === 'photos' ? "Tìm kiếm ảnh, video..." : "Tìm kiếm file, thư mục..."}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', marginLeft: '12px', fontSize: '14px' }}
             />
          </div>

          <div className="header-actions">
             {currentTab === 'photos' && items.filter(i => !i.isFolder && (isImageItem(i) || isVideoItem(i))).length > 0 && (
                <button 
                  className="btn btn-primary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: 'none', background: 'var(--accent-primary)', color: 'white' }}
                  onClick={handleDownloadAllPhotos}
                  disabled={downloadingAll}
                >
                  {downloadingAll ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
                  <span className="hide-on-mobile">Tải tất cả</span>
                </button>
             )}
             
             {currentTab === 'drive' && (
                <button 
                  className="btn btn-outline" 
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: 'none', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                  onClick={() => {
                     if (selectedIds.size === allDisplayed.length && allDisplayed.length > 0) {
                        setSelectedIds(new Set());
                     } else {
                        setSelectedIds(new Set(allDisplayed.map(i => i.id)));
                     }
                  }}
                >
                  {selectedIds.size === allDisplayed.length && allDisplayed.length > 0 
                     ? <CheckSquare size={16} color="var(--accent-primary)" /> 
                     : <Square size={16} />}
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>Chọn tất cả</span>
                </button>
             )}
             
             {/* View Dropdown */}
             {currentTab === 'drive' && (
                <div style={{ position: 'relative' }}>
                   <button 
                     className="btn btn-outline"
                     style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--bg-secondary)', border: 'none' }}
                     onClick={(e) => { e.stopPropagation(); setShowViewMenu(!showViewMenu); }}
                   >
                     <Settings2 size={16} /> 
                     <span style={{ fontSize: '14px', fontWeight: 500 }}>{activeViewOption?.label}</span>
                   </button>
                   {showViewMenu && (
                      <div style={{
                         position: 'absolute', top: '44px', right: '0', background: 'var(--bg-primary)',
                         border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                         boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, minWidth: '180px', overflow: 'hidden'
                      }}>
                         {viewOptions.map(opt => (
                            <div 
                              key={opt.id}
                              style={{
                                 padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px',
                                 fontSize: '14px', cursor: 'pointer', transition: 'background 0.2s',
                                 background: viewMode === opt.id ? 'var(--bg-secondary)' : 'transparent',
                                 color: viewMode === opt.id ? 'var(--accent-primary)' : 'var(--text-primary)'
                              }}
                              onMouseEnter={e => { if (viewMode !== opt.id) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                              onMouseLeave={e => { if (viewMode !== opt.id) e.currentTarget.style.background = 'transparent'; }}
                              onClick={() => setViewMode(opt.id as ViewMode)}
                            >
                               {opt.icon} {opt.label}
                            </div>
                         ))}
                      </div>
                   )}
                </div>
             )}
          </div>
        </div>

        {downloadingAll && (
           <div className="card animate-fade-in" style={{ marginBottom: '24px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Loader size={20} className="animate-spin" color="var(--accent-primary)" />
                    <span style={{ fontWeight: 500 }}>Đang chuẩn bị Tải xuống {downloadAllProgress.current}/{downloadAllProgress.total} file... (Vui lòng không đóng trang)</span>
                 </div>
              </div>
              <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(downloadAllProgress.current / Math.max(1, downloadAllProgress.total)) * 100}%`, background: 'var(--accent-primary)', transition: 'width 0.3s ease-out' }} />
              </div>
           </div>
        )}

        {uploading && (
           <div className="card animate-fade-in" style={{ marginBottom: '24px', padding: '20px' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontWeight: 500 }}>
               <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                 <Loader className="animate-spin" size={16} /> 
                 Đang tải lên {uploadQueue.current}/{uploadQueue.total}...
               </span>
               <span style={{ color: 'var(--accent-primary)' }}>{Math.round(uploadProgress)}%</span>
             </div>
             <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--accent-primary)', transition: 'width 0.3s ease-out' }} />
             </div>
           </div>
        )}

        {selectedIds.size > 0 && (
           <div className="card animate-fade-in selection-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                 <span style={{ cursor: 'pointer' }} onClick={() => setSelectedIds(new Set())}><X size={20} /></span>
                 <span style={{ fontWeight: 500 }}>Đã chọn {selectedIds.size} mục</span>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                 <button 
                   style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}
                   onClick={() => handleBulkAction('move')}
                 >
                   <CornerUpRight size={16} /> <span className="hide-on-mobile">Di chuyển</span>
                 </button>
                 <button 
                   style={{ background: '#ef4444', border: 'none', color: 'white', padding: '8px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}
                   onClick={() => handleBulkAction('delete')}
                 >
                   <Trash2 size={16} /> <span className="hide-on-mobile">Xóa</span>
                 </button>
              </div>
           </div>
        )}

        {/* Files Area */}
        <div className="glass-panel content-area" style={{ flex: 1, overflowY: 'auto' }}>
          {renderContentArea()}
        </div>
      </div>

      {/* Global Context Menu */}
      {activeMenu && (() => {
         const activeItem = allDisplayed.find(i => i.id === activeMenu.id);
         if (!activeItem) return null;
         
         const menuHeight = activeItem.isFolder ? 80 : 160; 
         let top = activeMenu.y;
         let left = activeMenu.x;
         if (top + menuHeight > window.innerHeight) {
            top -= menuHeight + 30; // show above
         }

         return (
            <div style={{
              position: 'fixed', left: left, top: top, 
              background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', 
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 1000, minWidth: '150px', overflow: 'hidden'
            }}>
              {!activeItem.isFolder && (
                <div 
                  style={{ padding: '10px 16px', display: 'flex', gap: '8px', fontSize: '14px', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={(e) => { e.stopPropagation(); handlePreview(activeItem); setActiveMenu(null); }}
                >
                  <Eye size={16} /> Xem trước
                </div>
              )}
              {!activeItem.isFolder && (
                <div 
                  style={{ padding: '10px 16px', display: 'flex', gap: '8px', fontSize: '14px', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={(e) => { e.stopPropagation(); handleDownload(activeItem); setActiveMenu(null); }}
                >
                  <Download size={16} /> Tải xuống
                </div>
              )}
              <div 
                style={{ padding: '10px 16px', display: 'flex', gap: '8px', fontSize: '14px', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={(e) => { e.stopPropagation(); setActiveMenu(null); setSelectedIds(new Set([activeItem.id])); handleBulkAction('move'); }}
              >
                <CornerUpRight size={16} /> Di chuyển
              </div>
              {(!activeItem.isFolder || activeItem.id > 0) && (
                <div 
                  style={{ padding: '10px 16px', display: 'flex', gap: '8px', fontSize: '14px', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s', color: '#ef4444' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fee2e2')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={(e) => { e.stopPropagation(); setActiveMenu(null); setSelectedIds(new Set([activeItem.id])); handleBulkAction('delete'); }}
                >
                  <Trash2 size={16} /> Xóa
                </div>
              )}
            </div>
         );
      })()}

      {/* Preview Modal */}
      {previewItem && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', flexDirection: 'column', backdropFilter: 'blur(4px)'
        }}>
          <div className="preview-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', color: 'white', zIndex: 102, gap: '16px' }}>
            <div style={{ fontSize: '18px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
               <span style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }} title={previewItem.name}>{previewItem.name}</span> 
               {previewableItems.length > 1 && <span style={{ opacity: 0.5, fontSize: '14px', flexShrink: 0 }}>({currentPreviewIndex + 1} / {previewableItems.length})</span>}
               {(!fullUrls[previewItem.id] && loading) && <Loader size={16} className="animate-spin" color="var(--accent-primary)" style={{ flexShrink: 0 }} />}
            </div>
            <div className="preview-actions" style={{ display: 'flex', gap: '16px', alignItems: 'center', flexShrink: 0 }}>
              <button className="btn btn-primary" style={{ padding: '8px 16px', display: 'flex', gap: '8px', alignItems: 'center' }} onClick={() => handleDownload(previewItem)}>
                <Download size={18} /> <span className="hide-on-mobile">Tải xuống</span>
              </button>
              <button style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center' }} onClick={() => setPreviewItem(null)}>
                <X size={24} />
              </button>
            </div>
          </div>
          <div 
             style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflow: zoom > 1 ? 'auto' : 'hidden', position: 'relative' }}
             onWheel={(e) => {
               if (isImageItem(previewItem)) {
                 if (e.deltaY < 0) setZoom(z => Math.min(z + 0.25, 4));
                 else setZoom(z => Math.max(z - 0.25, 0.5));
               }
             }}
          >
            
            {previewableItems.length > 1 && (
               <button 
                 onClick={() => navigatePreview('prev')}
                 style={{ position: 'fixed', left: '40px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '16px', borderRadius: '50%', cursor: 'pointer', zIndex: 101, transition: 'all 0.2s' }}
                 onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                 onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
               >
                  <ChevronLeft size={36} />
               </button>
            )}

            {isImageItem(previewItem) ? (
               <img 
                 src={fullUrls[previewItem.id] || previewUrl || ''} 
                 alt={previewItem.name} 
                 style={{ 
                    maxWidth: zoom > 1 ? 'none' : '100%', 
                    maxHeight: zoom > 1 ? 'none' : '100%', 
                    objectFit: 'contain',
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.2s ease-out',
                    cursor: zoom > 1 ? 'zoom-out' : 'zoom-in',
                    filter: !fullUrls[previewItem.id] ? 'blur(4px)' : 'none'
                 }} 
                 onDoubleClick={() => setZoom(z => z > 1 ? 1 : 2)}
                 onClick={() => setZoom(z => z > 1 ? 1 : 2)}
               />
            ) : isVideoItem(previewItem) ? (
               <video src={fullUrls[previewItem.id] || previewUrl || ''} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%' }} />
            ) : (
               <div style={{ color: 'white' }}>Không thể xem trước định dạng này. Vui lòng tải xuống.</div>
            )}

            {previewableItems.length > 1 && (
               <button 
                 onClick={() => navigatePreview('next')}
                 style={{ position: 'fixed', right: '40px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '16px', borderRadius: '50%', cursor: 'pointer', zIndex: 101, transition: 'all 0.2s' }}
                 onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                 onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
               >
                  <ChevronRight size={36} />
               </button>
            )}

          </div>
        </div>
      )}

      {/* Action Modals */}
      {modal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
           <div className="card animate-fade-in" style={{ width: '400px', padding: '24px', background: 'var(--bg-primary)' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
                 {modal.type === 'createFolder' ? 'Tạo Thư Mục Mới' : modal.type === 'delete' ? 'Xác nhận xóa' : 'Di chuyển đến...'}
                 <X size={20} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setModal(null)} />
              </div>
              
              {modalError && (
                 <div style={{ background: '#fee2e2', color: '#ef4444', padding: '12px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <AlertTriangle size={18} /> {modalError}
                 </div>
              )}

              {modal.type === 'createFolder' && (
                 <div>
                    <input 
                      type="text" 
                      className="input" 
                      placeholder="Nhập tên thư mục..." 
                      value={modalInput} 
                      onChange={e => setModalInput(e.target.value)}
                      autoFocus
                    />
                 </div>
              )}

              {modal.type === 'move' && (
                 <div>
                    <select className="input" value={modalInput} onChange={e => setModalInput(e.target.value)} style={{ width: '100%', padding: '10px' }}>
                       {getSubfoldersList().map(path => (
                          <option key={path} value={path}>{path}</option>
                       ))}
                    </select>
                 </div>
              )}

              {modal.type === 'delete' && !modalError && (
                 <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>
                    Bạn có chắc chắn muốn xóa {modal.data?.length} mục đã chọn? Hành động này không thể hoàn tác.
                 </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                 <button className="btn btn-outline" onClick={() => setModal(null)}>Hủy bỏ</button>
                 {!modalError && (
                    <button className="btn btn-primary" onClick={executeModalAction}>
                       Xác nhận
                    </button>
                 )}
              </div>
           </div>
        </div>
      )}



    </div>
  );
};

export default Drive;
