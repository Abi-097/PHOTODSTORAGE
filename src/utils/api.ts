import type { FolderSummary, PhotoItem } from '../types';
import {
  LOCAL_SESSION_TOKEN,
  localBuildFolderZipBlob,
  localCreateFolder,
  localDeleteFolder,
  localDeletePhoto,
  localFetchFolderPhotos,
  localFetchFolders,
  localRenameFolder,
  localUploadCompressedPhoto,
} from './localStore';

const TOKEN_STORAGE_KEY = 'storelens_auth_token';

export function isLocalSessionToken(token: string | null): boolean {
  return token === LOCAL_SESSION_TOKEN;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage quota errors
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

class StaticHostError extends Error {
  constructor() {
    super('Backend API route not hosted on this origin.');
  }
}

async function apiFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    let parsedError: string | null = null;
    if (contentType.includes('application/json')) {
      try {
        const data = (await res.json()) as { error?: string };
        if (data?.error) parsedError = data.error;
      } catch {
        // Ignore parse failure
      }
    }

    // If static host returns a non-JSON 404/405 for /api/*, signal static fallback
    if ((res.status === 404 || res.status === 405) && !parsedError) {
      throw new StaticHostError();
    }

    const err = new Error(parsedError || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export async function loginWithCredentials(
  loginId: string,
  password: string
): Promise<{ token: string; loginId: string; localMode?: boolean }> {
  try {
    return await apiFetch('/api/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ loginId, password }),
    });
  } catch (err) {
    if (err instanceof StaticHostError) {
      if (loginId.trim().toUpperCase() === 'STORES' && password.trim() === '1234') {
        return { token: LOCAL_SESSION_TOKEN, loginId: 'STORES', localMode: true };
      }
      throw new Error('Invalid Login ID or Password.');
    }
    throw err;
  }
}

export async function verifySession(token: string): Promise<{ authenticated: boolean; loginId: string }> {
  if (isLocalSessionToken(token)) {
    return { authenticated: true, loginId: 'STORES' };
  }
  try {
    return await apiFetch('/api/auth/me', token);
  } catch (err) {
    if (err instanceof StaticHostError) {
      return { authenticated: true, loginId: 'STORES' };
    }
    throw err;
  }
}

export async function fetchFolders(token: string): Promise<FolderSummary[]> {
  if (isLocalSessionToken(token)) {
    return localFetchFolders();
  }
  const data = await apiFetch<{ folders: FolderSummary[] }>('/api/folders', token);
  return data.folders;
}

export async function createFolder(token: string, name: string): Promise<FolderSummary> {
  if (isLocalSessionToken(token)) {
    return localCreateFolder(name);
  }
  const data = await apiFetch<{ folder: FolderSummary }>('/api/folders', token, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return data.folder;
}

export async function renameFolder(token: string, folderId: string, name: string): Promise<FolderSummary> {
  if (isLocalSessionToken(token)) {
    return localRenameFolder(folderId, name);
  }
  const data = await apiFetch<{ folder: FolderSummary }>(`/api/folders/${encodeURIComponent(folderId)}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return data.folder;
}

export async function deleteFolder(token: string, folderId: string): Promise<void> {
  if (isLocalSessionToken(token)) {
    return localDeleteFolder(folderId);
  }
  await apiFetch(`/api/folders/${encodeURIComponent(folderId)}`, token, {
    method: 'DELETE',
  });
}

export async function fetchFolderPhotos(token: string, folderId: string): Promise<PhotoItem[]> {
  if (isLocalSessionToken(token)) {
    return localFetchFolderPhotos(folderId);
  }
  const data = await apiFetch<{ photos: PhotoItem[] }>(
    `/api/folders/${encodeURIComponent(folderId)}/photos`,
    token
  );
  return data.photos;
}

export async function uploadCompressedPhoto(
  token: string,
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
  if (isLocalSessionToken(token)) {
    return localUploadCompressedPhoto(folderId, payload);
  }
  const data = await apiFetch<{ photo: PhotoItem }>(
    `/api/folders/${encodeURIComponent(folderId)}/photos`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  return data.photo;
}

export async function deletePhoto(token: string, photoId: string): Promise<void> {
  if (isLocalSessionToken(token)) {
    return localDeletePhoto(photoId);
  }
  await apiFetch(`/api/photos/${encodeURIComponent(photoId)}`, token, {
    method: 'DELETE',
  });
}

export async function downloadFolderZipBlob(token: string, folderId: string): Promise<Blob> {
  if (isLocalSessionToken(token)) {
    return localBuildFolderZipBlob(folderId);
  }
  const res = await fetch(getFolderZipDownloadUrl(folderId, token), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.blob();
}

export function getPhotoViewUrl(photoId: string, token: string, localUrl?: string): string {
  if (localUrl) return localUrl;
  return `/api/photos/${encodeURIComponent(photoId)}/file?token=${encodeURIComponent(token)}`;
}

export function getPhotoDownloadUrl(photoId: string, token: string, localUrl?: string): string {
  if (localUrl) return localUrl;
  return `/api/photos/${encodeURIComponent(photoId)}/file?download=1&token=${encodeURIComponent(token)}`;
}

export function getFolderZipDownloadUrl(folderId: string, token: string): string {
  return `/api/folders/${encodeURIComponent(folderId)}/download?token=${encodeURIComponent(token)}`;
}
