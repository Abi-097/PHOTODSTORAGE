import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, Trash2, X } from 'lucide-react';
import type { PhotoItem } from '../types';
import { getPhotoDownloadUrl, getPhotoViewUrl } from '../utils/api';
import { formatBytes } from '../utils/compressImage';

interface PhotoLightboxProps {
  photos: PhotoItem[];
  currentIndex: number;
  token: string;
  onSelectIndex: (index: number) => void;
  onDelete: (photo: PhotoItem) => void;
  onClose: () => void;
}

export function PhotoLightbox({
  photos,
  currentIndex,
  token,
  onSelectIndex,
  onDelete,
  onClose,
}: PhotoLightboxProps) {
  const photo = photos[currentIndex];

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onSelectIndex(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) onSelectIndex(currentIndex + 1);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentIndex, photos.length, onClose, onSelectIndex]);

  if (!photo) return null;

  const savedPct =
    photo.originalSize > 0
      ? Math.max(0, Math.round(((photo.originalSize - photo.compressedSize) / photo.originalSize) * 100))
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/95 text-white flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={photo.fileName}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-white/10 shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{photo.fileName}</h3>
          <p className="text-xs text-slate-400 tabular-nums truncate">
            {photo.width > 0 ? `${photo.width} × ${photo.height} · ` : ''}
            {formatBytes(photo.compressedSize)}
            {savedPct > 0 ? ` (${savedPct}% compressed from ${formatBytes(photo.originalSize)})` : ''}
            {` · ${photo.qualityLabel}`}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={getPhotoDownloadUrl(photo.id, token, photo.localUrl)}
            download={photo.fileName}
            className="min-h-[40px] px-3.5 py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Download</span>
          </a>

          <button
            type="button"
            onClick={() => onDelete(photo)}
            aria-label="Delete photo"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-red-600 text-slate-200 hover:text-white transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div className="relative flex-1 flex items-center justify-center p-4 overflow-hidden">
        <img
          src={getPhotoViewUrl(photo.id, token, photo.localUrl)}
          alt={photo.fileName}
          referrerPolicy="no-referrer"
          className="max-w-full max-h-full object-contain rounded-lg"
        />

        {currentIndex > 0 && (
          <button
            type="button"
            onClick={() => onSelectIndex(currentIndex - 1)}
            aria-label="Previous photo"
            className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] rounded-full bg-black/60 hover:bg-black/80 border border-white/15 flex items-center justify-center text-white cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {currentIndex < photos.length - 1 && (
          <button
            type="button"
            onClick={() => onSelectIndex(currentIndex + 1)}
            aria-label="Next photo"
            className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] rounded-full bg-black/60 hover:bg-black/80 border border-white/15 flex items-center justify-center text-white cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Footer Counter */}
      <div className="px-4 py-3 text-center text-xs text-slate-400 tabular-nums border-t border-white/10 shrink-0">
        Photo {currentIndex + 1} of {photos.length} · Captured{' '}
        {new Date(photo.createdAt).toLocaleString()}
      </div>
    </div>
  );
}
