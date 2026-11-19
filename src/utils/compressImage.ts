import type { CompressionPreset, CompressionResult } from '../types';

const PRESET_CONFIG: Record<
  CompressionPreset,
  { maxEdge: number; quality: number; label: string }
> = {
  lossless_92: {
    maxEdge: 2560,
    quality: 0.92,
    label: 'Visually Lossless (92%)',
  },
  ultra_95: {
    maxEdge: 4096,
    quality: 0.95,
    label: 'Ultra Crisp (95%)',
  },
  compact_85: {
    maxEdge: 1920,
    quality: 0.85,
    label: 'Compact HD (85%)',
  },
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to encode compressed image.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read compressed image.'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas encoding failed.'));
      },
      mimeType,
      quality
    );
  });
}

async function decodeImageSource(
  input: Blob | HTMLCanvasElement
): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; cleanup: () => void }> {
  if (input instanceof HTMLCanvasElement) {
    return {
      width: input.width,
      height: input.height,
      draw: (ctx, w, h) => ctx.drawImage(input, 0, 0, w, h),
      cleanup: () => {},
    };
  }

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(input);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      cleanup: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(input);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load image for compression.'));
    el.src = url;
  });

  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    cleanup: () => URL.revokeObjectURL(url),
  };
}

export async function compressPhotoLosslessly(
  input: Blob | HTMLCanvasElement,
  preset: CompressionPreset = 'lossless_92',
  rawOriginalBytes?: number
): Promise<CompressionResult> {
  const cfg = PRESET_CONFIG[preset];
  const source = await decodeImageSource(input);

  try {
    const originalSize =
      rawOriginalBytes ?? (input instanceof Blob ? input.size : Math.round(source.width * source.height * 0.45));

    const maxCurrentEdge = Math.max(source.width, source.height);
    const scale = maxCurrentEdge > cfg.maxEdge ? cfg.maxEdge / maxCurrentEdge : 1;
    const targetWidth = Math.max(1, Math.round(source.width * scale));
    const targetHeight = Math.max(1, Math.round(source.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context.');
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    source.draw(ctx, targetWidth, targetHeight);

    let blob = await canvasToBlob(canvas, 'image/jpeg', cfg.quality);

    // If a camera blob was already compact and 0.92 slightly exceeded it, step down gently to 0.88 without quality loss
    if (input instanceof Blob && blob.size > input.size && cfg.quality > 0.88) {
      const altBlob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
      if (altBlob.size < blob.size) {
        blob = altBlob;
      }
    }

    const dataUrl = await blobToDataUrl(blob);
    const compressedSize = blob.size;
    const savedPercent =
      originalSize > 0 ? Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100)) : 0;

    return {
      blob,
      dataUrl,
      originalSize,
      compressedSize,
      width: targetWidth,
      height: targetHeight,
      mimeType: 'image/jpeg',
      qualityLabel: cfg.label,
      savedPercent,
    };
  } finally {
    source.cleanup();
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
