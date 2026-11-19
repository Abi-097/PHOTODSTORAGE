export interface FolderSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
  totalCompressedBytes: number;
  totalOriginalBytes: number;
  coverPhotoId: string | null;
  coverLocalUrl?: string | null;
}

export interface PhotoItem {
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
  localUrl?: string;
}

export type CompressionPreset = 'lossless_92' | 'ultra_95' | 'compact_85';

export interface CompressionResult {
  blob: Blob;
  dataUrl: string;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
  mimeType: string;
  qualityLabel: string;
  savedPercent: number;
}
