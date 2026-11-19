import type { FolderSummary, PhotoItem } from '../types';

const TOKEN_STORAGE_KEY = 'storelens_auth_token';

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
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Fallback to status message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export async function loginWithCredentials(
  loginId: string,
  password: string
): Promise<{ token: string; loginId: string }> {
  return apiFetch('/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ loginId, password }),
  });
}

export async function verifySession(token: string): Promise<{ authenticated: boolean; loginId: string }> {
  return apiFetch('/api/auth/me', token);
}

export async function fetchFolders(token: string): Promise<FolderSummary[]> {
  const data = await apiFetch<{ folders: FolderSummary[] }>('/api/folders', token);
  return data.folders;
}

export async function createFolder(token: string, name: string): Promise<FolderSummary> {
  const data = await apiFetch<{ folder: FolderSummary }>('/api/folders', token, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return data.folder;
}

export async function renameFolder(token: string, folderId: string, name: string): Promise<FolderSummary> {
  const data = await apiFetch<{ folder: FolderSummary }>(`/api/folders/${encodeURIComponent(folderId)}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return data.folder;
}

export async function deleteFolder(token: string, folderId: string): Promise<void> {
  await apiFetch(`/api/folders/${encodeURIComponent(folderId)}`, token, {
    method: 'DELETE',
  });
}

export async function fetchFolderPhotos(token: string, folderId: string): Promise<PhotoItem[]> {
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
  await apiFetch(`/api/photos/${encodeURIComponent(photoId)}`, token, {
    method: 'DELETE',
  });
}

export function getPhotoViewUrl(photoId: string, token: string): string {
  return `/api/photos/${encodeURIComponent(photoId)}/file?token=${encodeURIComponent(token)}`;
}

export function getPhotoDownloadUrl(photoId: string, token: string): string {
  return `/api/photos/${encodeURIComponent(photoId)}/file?download=1&token=${encodeURIComponent(token)}`;
}

export function getFolderZipDownloadUrl(folderId: string, token: string): string {
  return `/api/folders/${encodeURIComponent(folderId)}/download?token=${encodeURIComponent(token)}`;
}
