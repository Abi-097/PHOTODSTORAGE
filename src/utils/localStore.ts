import JSZip from 'jszip';
import type { FolderSummary, PhotoItem } from '../types';

const DB_NAME = 'storelens_local_db';
const DB_VERSION = 1;
const FOLDERS_STORE = 'folders';
const PHOTOS_STORE = 'photos';
export const LOCAL_SESSION_TOKEN = 'local-device-session-stores';

interface LocalFolderRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface LocalPhotoRecord {
  id: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
  qualityLabel: string;
  createdAt: string;
  dataUrl: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
        db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        const photosStore = db.createObjectStore(PHOTOS_STORE, { keyPath: 'id' });
        photosStore.createIndex('folderId', 'folderId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open local storage.'));
  });
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error('Failed to read local storage.'));
  });
}

async function putInStore<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write local storage.'));
  });
}

async function deleteFromStore(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete from local storage.'));
  });
}

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function localFetchFolders(): Promise<FolderSummary[]> {
  const [folders, photos] = await Promise.all([
    getAllFromStore<LocalFolderRecord>(FOLDERS_STORE),
    getAllFromStore<LocalPhotoRecord>(PHOTOS_STORE),
  ]);

  return folders
    .map((folder) => {
      const folderPhotos = photos
        .filter((p) => p.folderId === folder.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return {
        id: folder.id,
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        photoCount: folderPhotos.length,
        totalCompressedBytes: folderPhotos.reduce((acc, p) => acc + (p.compressedSize || 0), 0),
        totalOriginalBytes: folderPhotos.reduce((acc, p) => acc + (p.originalSize || 0), 0),
        coverPhotoId: folderPhotos[0]?.id ?? null,
        coverLocalUrl: folderPhotos[0]?.dataUrl ?? null,
      };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function localCreateFolder(name: string): Promise<FolderSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required.');
  const existing = await getAllFromStore<LocalFolderRecord>(FOLDERS_STORE);
  if (existing.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A folder with this name already exists.');
  }

  const now = new Date().toISOString();
  const folder: LocalFolderRecord = {
    id: makeUuid(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
  };
  await putInStore(FOLDERS_STORE, folder);
  return {
    ...folder,
    photoCount: 0,
    totalCompressedBytes: 0,
    totalOriginalBytes: 0,
    coverPhotoId: null,
    coverLocalUrl: null,
  };
}

export async function localRenameFolder(folderId: string, name: string): Promise<FolderSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required.');
  const existing = await getAllFromStore<LocalFolderRecord>(FOLDERS_STORE);
  const target = existing.find((f) => f.id === folderId);
  if (!target) throw new Error('Folder not found.');
  if (existing.some((f) => f.id !== folderId && f.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('Another folder already uses that name.');
  }

  target.name = trimmed;
  target.updatedAt = new Date().toISOString();
  await putInStore(FOLDERS_STORE, target);
  const summaries = await localFetchFolders();
  const updated = summaries.find((f) => f.id === folderId);
  if (!updated) throw new Error('Folder not found.');
  return updated;
}

export async function localDeleteFolder(folderId: string): Promise<void> {
  await deleteFromStore(FOLDERS_STORE, folderId);
  const photos = await getAllFromStore<LocalPhotoRecord>(PHOTOS_STORE);
  for (const photo of photos) {
    if (photo.folderId === folderId) {
      await deleteFromStore(PHOTOS_STORE, photo.id);
    }
  }
}

export async function localFetchFolderPhotos(folderId: string): Promise<PhotoItem[]> {
  const photos = await getAllFromStore<LocalPhotoRecord>(PHOTOS_STORE);
  return photos
    .filter((p) => p.folderId === folderId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((p) => ({
      id: p.id,
      folderId: p.folderId,
      fileName: p.fileName,
      mimeType: p.mimeType,
      originalSize: p.originalSize,
      compressedSize: p.compressedSize,
      width: p.width,
      height: p.height,
      qualityLabel: p.qualityLabel,
      createdAt: p.createdAt,
      localUrl: p.dataUrl,
    }));
}

export async function localUploadCompressedPhoto(
  folderId: string,
  payload: {
    dataUrl: string;
    fileName: string;
    originalSize: number;
    compressedSize: number;
    width: number;
    height: number;
    mimeType: string;
    qualityLabel: string;
  }
): Promise<PhotoItem> {
  const folders = await getAllFromStore<LocalFolderRecord>(FOLDERS_STORE);
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) throw new Error('Folder not found.');

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = payload.mimeType === 'image/webp' ? '.webp' : '.jpg';
  const rawName = payload.fileName?.trim() || `IMG_${stamp}${ext}`;
  const cleanName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = /\.[a-z0-9]+$/i.test(cleanName) ? cleanName : `${cleanName}${ext}`;

  const record: LocalPhotoRecord = {
    id: makeUuid(),
    folderId,
    fileName,
    mimeType: payload.mimeType || 'image/jpeg',
    originalSize: payload.originalSize,
    compressedSize: payload.compressedSize,
    width: payload.width,
    height: payload.height,
    qualityLabel: payload.qualityLabel,
    createdAt: now.toISOString(),
    dataUrl: payload.dataUrl,
  };

  await putInStore(PHOTOS_STORE, record);
  folder.updatedAt = now.toISOString();
  await putInStore(FOLDERS_STORE, folder);

  return {
    id: record.id,
    folderId: record.folderId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    originalSize: record.originalSize,
    compressedSize: record.compressedSize,
    width: record.width,
    height: record.height,
    qualityLabel: record.qualityLabel,
    createdAt: record.createdAt,
    localUrl: record.dataUrl,
  };
}

export async function localDeletePhoto(photoId: string): Promise<void> {
  await deleteFromStore(PHOTOS_STORE, photoId);
}

export async function localBuildFolderZipBlob(folderId: string): Promise<Blob> {
  const photos = await getAllFromStore<LocalPhotoRecord>(PHOTOS_STORE);
  const folderPhotos = photos
    .filter((p) => p.folderId === folderId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (folderPhotos.length === 0) {
    throw new Error('Folder has no photos to download.');
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (let i = 0; i < folderPhotos.length; i++) {
    const p = folderPhotos[i];
    let entryName = p.fileName;
    if (usedNames.has(entryName)) {
      const dot = entryName.lastIndexOf('.');
      if (dot > 0) {
        entryName = `${entryName.slice(0, dot)}_${i + 1}${entryName.slice(dot)}`;
      } else {
        entryName = `${entryName}_${i + 1}`;
      }
    }
    usedNames.add(entryName);
    const base64Part = p.dataUrl.split(',')[1] || '';
    zip.file(entryName, base64Part, { base64: true });
  }

  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
