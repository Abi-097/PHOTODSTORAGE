import React, { useState } from 'react';
import { Download, ImageOff, Trash2 } from 'lucide-react';
import type { PhotoItem } from '../types';
import { getPhotoDownloadUrl, getPhotoViewUrl } from '../utils/api';
import { formatBytes } from '../utils/compressImage';

interface PhotoCardProps {
  photo: PhotoItem;
  token: string;
  onOpen: () => void;
  onDelete: () => void;
}

export function PhotoCard({ photo, token, onOpen, onDelete }: PhotoCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const savedPercent =
    photo.originalSize > 0
      ? Math.max(0, Math.round(((photo.originalSize - photo.compressedSize) / photo.originalSize) * 100))
      : 0;

  return (
    <article className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col group">
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[4/3] w-full bg-slate-100 overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] cursor-pointer"
      >
        {!imgFailed ? (
          <img
            src={getPhotoViewUrl(photo.id, token)}
            alt={photo.fileName}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-slate-100 text-slate-400 p-3 text-center">
            <ImageOff className="w-6 h-6" />
            <span className="text-xs font-medium text-slate-500 truncate max-w-full">
              {photo.fileName}
            </span>
          </div>
        )}
      </button>

      <div className="p-3 flex items-center justify-between gap-2 border-t border-slate-100">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-900 truncate">{photo.fileName}</p>
          <p className="text-[11px] text-slate-500 tabular-nums truncate mt-0.5">
            {formatBytes(photo.compressedSize)}
            {savedPercent > 0 ? ` · -${savedPercent}%` : ''}
            {photo.width > 0 ? ` · ${photo.width}×${photo.height}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <a
            href={getPhotoDownloadUrl(photo.id, token)}
            download={photo.fileName}
            aria-label={`Download ${photo.fileName}`}
            title="Download photo to device"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-600 hover:text-[#2563EB] hover:bg-blue-50 transition-colors"
          >
            <Download className="w-4 h-4" />
          </a>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete ${photo.fileName}`}
              title="Delete photo"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onDelete}
              onBlur={() => setConfirmDelete(false)}
              className="min-h-[36px] px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
