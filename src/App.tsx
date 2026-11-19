import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  Copy,
  Download,
  Folder,
  FolderPlus,
  ImagePlus,
  LogOut,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { CameraModal } from './components/CameraModal';
import { LoginScreen } from './components/LoginScreen';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PhotoCard } from './components/PhotoCard';
import { PhotoLightbox } from './components/PhotoLightbox';
import { PWAInstallButton } from './components/PWAInstallButton';
import type { FolderSummary, PhotoItem } from './types';
import {
  clearStoredToken,
  createFolder,
  deleteFolder,
  deletePhoto,
  fetchFolderPhotos,
  fetchFolders,
  getFolderZipDownloadUrl,
  getPhotoViewUrl,
  getStoredToken,
  renameFolder,
  setStoredToken,
  uploadCompressedPhoto,
  verifySession,
} from './utils/api';
import { compressPhotoLosslessly, formatBytes } from './utils/compressImage';

export default function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [authChecking, setAuthChecking] = useState<boolean>(() => Boolean(getStoredToken()));
  const [loginId, setLoginId] = useState<string>('STORES');

  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);

  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderSearch, setFolderSearch] = useState('');

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [downloadingFolderId, setDownloadingFolderId] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const directUploadRef = useRef<HTMLInputElement | null>(null);
  const selectedFolderIdRef = useRef<string | null>(selectedFolderId);
  selectedFolderIdRef.current = selectedFolderId;

  const activeFolder = useMemo(
    () => folders.find((f) => f.id === selectedFolderId) ?? null,
    [folders, selectedFolderId]
  );

  const filteredFolders = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, folderSearch]);

  const handleSignOut = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setFolders([]);
    setPhotos([]);
    setSelectedFolderId(null);
    setCameraOpen(false);
    setLightboxIndex(null);
  }, []);

  // Verify existing stored token on initial load
  useEffect(() => {
    if (!token) {
      setAuthChecking(false);
      return;
    }
    let active = true;
    verifySession(token)
      .then((res) => {
        if (!active) return;
        setLoginId(res.loginId || 'STORES');
        setAuthChecking(false);
      })
      .catch(() => {
        if (!active) return;
        clearStoredToken();
        setToken(null);
        setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const loadFolders = useCallback(
    async (silent = false) => {
      if (!token) return;
      if (!silent) setFoldersLoading(true);
      try {
        const list = await fetchFolders(token);
        setFolders(list);
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          handleSignOut();
          return;
        }
        setBannerError(err instanceof Error ? err.message : 'Unable to load folders.');
      } finally {
        if (!silent) setFoldersLoading(false);
      }
    },
    [token, handleSignOut]
  );

  const loadPhotos = useCallback(
    async (folderId: string, silent = false) => {
      if (!token) return;
      if (!silent) setPhotosLoading(true);
      try {
        const list = await fetchFolderPhotos(token, folderId);
        setPhotos(list);
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          handleSignOut();
          return;
        }
        setBannerError(err instanceof Error ? err.message : 'Unable to load photos.');
      } finally {
        if (!silent) setPhotosLoading(false);
      }
    },
    [token, handleSignOut]
  );

  // Initial folder fetch after authentication
  useEffect(() => {
    if (!token || authChecking) return;
    void loadFolders(false);
  }, [token, authChecking, loadFolders]);

  // Fetch photos whenever active folder changes
  useEffect(() => {
    if (!token || !selectedFolderId) {
      setPhotos([]);
      return;
    }
    void loadPhotos(selectedFolderId, false);
  }, [token, selectedFolderId, loadPhotos]);

  // Real-time SSE sync so Mobile captures appear immediately on PC
  useEffect(() => {
    if (!token || authChecking) return;
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);

    const handleSync = (evt: MessageEvent) => {
      void loadFolders(true);
      try {
        const payload = JSON.parse(evt.data) as { folderId?: string; type?: string };
        const current = selectedFolderIdRef.current;
        if (current && payload.folderId === current) {
          if (payload.type === 'folder_deleted') {
            setSelectedFolderId(null);
            setPhotos([]);
          } else {
            void loadPhotos(current, true);
          }
        }
      } catch {
        // Ignore parse error
      }
    };

    es.addEventListener('sync', handleSync);
    return () => {
      es.removeEventListener('sync', handleSync);
      es.close();
    };
  }, [token, authChecking, loadFolders, loadPhotos]);

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const trimmed = newFolderName.trim();
    if (!trimmed) return;

    setCreatingFolder(true);
    setBannerError(null);
    try {
      const created = await createFolder(token, trimmed);
      setNewFolderName('');
      setFolders((prev) => [created, ...prev]);
      setSelectedFolderId(created.id);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Could not create folder.');
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleSaveRename(folderId: string) {
    if (!token) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingFolderId(null);
      return;
    }
    setBannerError(null);
    try {
      const updated = await renameFolder(token, folderId, trimmed);
      setFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
      setRenamingFolderId(null);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Could not rename folder.');
    }
  }

  async function handleDeleteFolder(folderId: string) {
    if (!token) return;
    setBannerError(null);
    try {
      await deleteFolder(token, folderId);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
        setPhotos([]);
      }
      setConfirmDeleteFolderId(null);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Could not delete folder.');
    }
  }

  async function handleDirectFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !token || !selectedFolderId) return;

    setUploadingFiles(true);
    setBannerError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const compressed = await compressPhotoLosslessly(file, 'lossless_92', file.size);
        const saved = await uploadCompressedPhoto(token, selectedFolderId, {
          dataUrl: compressed.dataUrl,
          fileName: file.name,
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          width: compressed.width,
          height: compressed.height,
          mimeType: compressed.mimeType,
          qualityLabel: compressed.qualityLabel,
        });
        setPhotos((prev) => (prev.some((p) => p.id === saved.id) ? prev : [saved, ...prev]));
      }
      void loadFolders(true);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploadingFiles(false);
      e.target.value = '';
    }
  }

  async function handleDeletePhoto(photo: PhotoItem) {
    if (!token) return;
    setBannerError(null);
    try {
      await deletePhoto(token, photo.id);
      setPhotos((prev) => {
        const next = prev.filter((p) => p.id !== photo.id);
        if (lightboxIndex !== null) {
          if (next.length === 0) setLightboxIndex(null);
          else if (lightboxIndex >= next.length) setLightboxIndex(next.length - 1);
        }
        return next;
      });
      void loadFolders(true);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Could not delete photo.');
    }
  }

  async function handleCopyShareUrl() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setBannerError('Copy failed. Share the address bar URL directly.');
    }
  }

  async function handleDownloadFolderZip(folder: FolderSummary) {
    if (!token || folder.photoCount === 0) return;
    setDownloadingFolderId(folder.id);
    setBannerError(null);
    try {
      const res = await fetch(getFolderZipDownloadUrl(folder.id, token), {
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
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = folder.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'folder';
      link.href = blobUrl;
      link.download = `${safeName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Could not download folder ZIP.');
    } finally {
      setDownloadingFolderId(null);
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4">
        <p className="text-sm text-slate-500">Verifying store session...</p>
      </div>
    );
  }

  if (!token) {
    return (
      <LoginScreen
        onSuccess={(newToken, id) => {
          setStoredToken(newToken);
          setToken(newToken);
          setLoginId(id);
        }}
      />
    );
  }

  const totalPhotosCount = folders.reduce((sum, f) => sum + f.photoCount, 0);
  const totalSavedBytes = folders.reduce(
    (sum, f) => sum + Math.max(0, f.totalOriginalBytes - f.totalCompressedBytes),
    0
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      {/* Desktop & Mobile Top Bar (3-zone contract on desktop) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 lg:px-6 h-14 flex items-center justify-between gap-4 lg:gap-8 shrink-0">
        {/* Zone 1: Brand or Mobile Back */}
        <div className="flex items-center gap-2.5 min-w-0">
          {selectedFolderId && (
            <button
              type="button"
              onClick={() => setSelectedFolderId(null)}
              aria-label="Back to folders"
              className="lg:hidden min-h-[40px] min-w-[40px] -ml-2 flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedFolderId(null)}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer font-display"
          >
            {selectedFolderId && activeFolder ? (
              <>
                <span className="hidden lg:inline">StoreLens</span>
                <span className="lg:hidden truncate max-w-[180px] inline-block align-bottom">
                  {activeFolder.name}
                </span>
              </>
            ) : (
              'StoreLens'
            )}
          </button>
        </div>

        {/* Zone 2: Concise Navigation / Breadcrumb (Desktop) */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600 min-w-0">
          <button
            type="button"
            onClick={() => setSelectedFolderId(null)}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              !selectedFolderId ? 'text-slate-900 font-semibold' : ''
            }`}
          >
            All Folders
          </button>
          {activeFolder && (
            <span className="text-slate-900 font-semibold truncate max-w-[240px]">
              {activeFolder.name}
            </span>
          )}
          <span className="text-slate-400 tabular-nums whitespace-nowrap shrink-0">
            {folders.length} folders · {totalPhotosCount} photos
          </span>
          <span className="text-slate-400 whitespace-nowrap shrink-0">Account: {loginId}</span>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          {selectedFolderId && activeFolder && activeFolder.photoCount > 0 && (
            <button
              type="button"
              onClick={() => void handleDownloadFolderZip(activeFolder)}
              disabled={downloadingFolderId === activeFolder.id}
              aria-label="Download folder ZIP"
              className="lg:hidden min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{downloadingFolderId === activeFolder.id ? 'Saving...' : 'ZIP'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1440px] w-full mx-auto">
        {/* Sidebar / Mobile Folder List */}
        <aside
          className={`w-full lg:w-[300px] lg:border-r lg:border-slate-200 bg-white lg:bg-[#F8FAFC] flex flex-col shrink-0 ${
            selectedFolderId ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="p-4 border-b border-slate-200 bg-white">
            <form onSubmit={handleCreateFolder} className="flex items-center gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name..."
                maxLength={80}
                className="flex-1 min-w-0 min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />
              <button
                type="submit"
                disabled={creatingFolder || !newFolderName.trim()}
                className="min-h-[44px] px-3.5 py-2 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" />
                <span>Create</span>
              </button>
            </form>

            {folders.length > 3 && (
              <div className="relative mt-3">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="Filter folders..."
                  className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            )}
          </div>

          {/* Folder List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {foldersLoading ? (
              <div className="p-4 space-y-3">
                <div className="h-14 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-14 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-14 rounded-xl bg-slate-100 animate-pulse" />
              </div>
            ) : filteredFolders.length === 0 ? (
              <div className="p-6 text-center">
                <Folder className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-700">
                  {folders.length === 0 ? 'No folders yet' : 'No matching folders'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {folders.length === 0
                    ? 'Create a folder above to open the camera and store photos.'
                    : 'Try another search term.'}
                </p>
              </div>
            ) : (
              filteredFolders.map((folder) => {
                const isSelected = folder.id === selectedFolderId;
                const isDownloading = downloadingFolderId === folder.id;
                return (
                  <div
                    key={folder.id}
                    className={`w-full min-h-[64px] px-3 py-2 flex items-center gap-2 transition-colors ${
                      isSelected
                        ? 'bg-blue-50/80 text-slate-900'
                        : 'bg-white lg:bg-transparent hover:bg-slate-100/80 text-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedFolderId(folder.id)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left py-1 pl-1 cursor-pointer"
                    >
                      {folder.coverPhotoId ? (
                        <img
                          src={getPhotoViewUrl(folder.coverPhotoId, token)}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div
                          className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Folder className="w-5 h-5" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{folder.name}</p>
                        <p className="text-xs text-slate-500 tabular-nums truncate mt-0.5">
                          {folder.photoCount} {folder.photoCount === 1 ? 'photo' : 'photos'} ·{' '}
                          {formatBytes(folder.totalCompressedBytes)}
                        </p>
                      </div>
                    </button>

                    {folder.photoCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleDownloadFolderZip(folder)}
                        disabled={isDownloading}
                        aria-label={`Download ${folder.name} as ZIP`}
                        title="Download folder (.zip)"
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-[#2563EB] hover:bg-blue-100/70 disabled:opacity-50 shrink-0 cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Connect Mobile & PC URL Helper & PWA Install */}
          <div className="p-4 border-t border-slate-200 bg-white space-y-2.5">
            <div>
              <p className="text-xs font-semibold text-slate-900">Install &amp; Sync (Mobile &amp; PC)</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Install this app on Android &amp; PC or copy the URL to connect both devices.
              </p>
            </div>
            <PWAInstallButton variant="primary" fullWidth />
            <button
              type="button"
              onClick={handleCopyShareUrl}
              className="w-full min-h-[40px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedUrl ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>URL Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy App URL</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Main Workspace Viewport */}
        <main
          className={`flex-1 flex flex-col min-w-0 pb-24 lg:pb-8 ${
            !selectedFolderId ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {bannerError && (
            <div
              role="alert"
              className="mx-4 lg:mx-8 mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-3 text-sm text-red-700"
            >
              <span>{bannerError}</span>
              <button
                type="button"
                onClick={() => setBannerError(null)}
                aria-label="Dismiss error"
                className="p-1 hover:bg-red-100 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {!activeFolder ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-4">
                <Camera className="w-7 h-7 text-[#2563EB]" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                {folders.length === 0 ? 'Create a Folder to Get Started' : 'Select a Folder'}
              </h2>
              <p className="text-sm text-slate-500 max-w-md mt-2 leading-relaxed">
                {folders.length === 0
                  ? 'Create your first folder on the left, open it, and tap Open Camera to capture and compress photos without losing quality.'
                  : 'Choose a folder from the left sidebar to capture new photos or download compressed photos to your PC.'}
              </p>

              {totalSavedBytes > 0 && (
                <p className="mt-4 text-xs text-slate-500 tabular-nums">
                  {totalPhotosCount} photos stored · {formatBytes(totalSavedBytes)} saved via visually lossless compression
                </p>
              )}
            </div>
          ) : (
            <div className="p-4 lg:p-8 space-y-6">
              {/* Folder Header & Action Toolbar */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div className="min-w-0">
                  {renamingFolderId === activeFolder.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleSaveRename(activeFolder.id);
                          if (e.key === 'Escape') setRenamingFolderId(null);
                        }}
                        autoFocus
                        maxLength={80}
                        className="min-h-[40px] px-3 py-1.5 text-base font-semibold bg-white border border-[#2563EB] rounded-lg focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveRename(activeFolder.id)}
                        className="min-h-[40px] px-3 py-1.5 bg-[#2563EB] text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingFolderId(null)}
                        className="min-h-[40px] px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">
                        {activeFolder.name}
                      </h1>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingFolderId(activeFolder.id);
                          setRenameValue(activeFolder.name);
                        }}
                        aria-label="Rename folder"
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <p className="text-xs sm:text-sm text-slate-500 tabular-nums mt-1">
                    {activeFolder.photoCount} {activeFolder.photoCount === 1 ? 'photo' : 'photos'} ·{' '}
                    {formatBytes(activeFolder.totalCompressedBytes)} stored
                    {activeFolder.totalOriginalBytes > activeFolder.totalCompressedBytes
                      ? ` (compressed from ${formatBytes(activeFolder.totalOriginalBytes)})`
                      : ''}
                  </p>
                </div>

                {/* Desktop Toolbar Actions */}
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    className="hidden lg:inline-flex min-h-[44px] px-4 py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold rounded-xl items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Open Camera</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => directUploadRef.current?.click()}
                    disabled={uploadingFiles}
                    className="hidden lg:inline-flex min-h-[44px] px-4 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-sm font-medium rounded-xl items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                  >
                    <ImagePlus className="w-4 h-4" />
                    <span>{uploadingFiles ? 'Compressing...' : 'Upload Photos'}</span>
                  </button>

                  {activeFolder.photoCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleDownloadFolderZip(activeFolder)}
                      disabled={downloadingFolderId === activeFolder.id}
                      className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {downloadingFolderId === activeFolder.id
                          ? 'Preparing ZIP...'
                          : 'Download Folder (.zip)'}
                      </span>
                    </button>
                  )}

                  {confirmDeleteFolderId === activeFolder.id ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleDeleteFolder(activeFolder.id)}
                        className="min-h-[44px] px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl whitespace-nowrap cursor-pointer"
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteFolderId(null)}
                        className="min-h-[44px] px-3 py-2 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteFolderId(activeFolder.id)}
                      aria-label="Delete folder"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Hidden Direct Upload Input (accepts camera or gallery) */}
              <input
                ref={directUploadRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleDirectFileUpload}
                className="hidden"
              />

              {/* Photos Grid */}
              {photosLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                  <div className="aspect-[4/3] rounded-xl bg-slate-200/70 animate-pulse" />
                  <div className="aspect-[4/3] rounded-xl bg-slate-200/70 animate-pulse" />
                  <div className="aspect-[4/3] rounded-xl bg-slate-200/70 animate-pulse" />
                  <div className="aspect-[4/3] rounded-xl bg-slate-200/70 animate-pulse" />
                </div>
              ) : photos.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#2563EB] flex items-center justify-center mx-auto mb-4">
                    <Camera className="w-7 h-7" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">This folder is empty</h2>
                  <p className="text-sm text-slate-500 max-w-md mx-auto mt-1.5 leading-relaxed">
                    Tap Open Camera to take a photo. It will be compressed without reducing visual quality and saved directly here for PC download.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setCameraOpen(true)}
                      className="min-h-[46px] px-5 py-2.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Open Camera</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => directUploadRef.current?.click()}
                      disabled={uploadingFiles}
                      className="min-h-[46px] px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-sm font-medium rounded-xl flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <ImagePlus className="w-4 h-4" />
                      <span>{uploadingFiles ? 'Compressing...' : 'Choose Photos'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  {photos.map((photo, index) => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      token={token}
                      onOpen={() => setLightboxIndex(index)}
                      onDelete={() => void handleDeletePhoto(photo)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Mobile Fixed Thumb-Zone Action Bar (only inside an active folder, compact <= 15% viewport height) */}
      {selectedFolderId && activeFolder && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 pt-2.5 pb-safe flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="flex-1 min-h-[48px] px-4 py-2.5 bg-[#2563EB] hover:bg-[#1D4ED8] active:scale-[0.98] text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 whitespace-nowrap transition-transform cursor-pointer"
          >
            <Camera className="w-5 h-5" />
            <span>Open Camera</span>
          </button>

          <button
            type="button"
            onClick={() => directUploadRef.current?.click()}
            disabled={uploadingFiles}
            aria-label="Upload photos from device"
            className="min-h-[48px] px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ImagePlus className="w-4 h-4" />
            <span>{uploadingFiles ? 'Saving...' : 'Gallery'}</span>
          </button>
        </div>
      )}

      {/* Live Camera Modal */}
      {cameraOpen && activeFolder && (
        <CameraModal
          folderId={activeFolder.id}
          folderName={activeFolder.name}
          token={token}
          onClose={() => setCameraOpen(false)}
          onPhotoSaved={(saved) => {
            setPhotos((prev) => (prev.some((p) => p.id === saved.id) ? prev : [saved, ...prev]));
            void loadFolders(true);
          }}
        />
      )}

      {/* Lightbox Inspector */}
      {lightboxIndex !== null && photos.length > 0 && (
        <PhotoLightbox
          photos={photos}
          currentIndex={lightboxIndex}
          token={token}
          onSelectIndex={setLightboxIndex}
          onDelete={(photo) => void handleDeletePhoto(photo)}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
