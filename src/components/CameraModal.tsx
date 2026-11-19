import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Grid3X3,
  ImagePlus,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import type { CompressionPreset, PhotoItem } from '../types';
import { compressPhotoLosslessly, formatBytes } from '../utils/compressImage';
import { getPhotoViewUrl, uploadCompressedPhoto } from '../utils/api';

interface CameraModalProps {
  folderId: string;
  folderName: string;
  token: string;
  onClose: () => void;
  onPhotoSaved: (photo: PhotoItem) => void;
}

interface CapturedSessionItem {
  id: string;
  fileName: string;
  originalSize: number;
  compressedSize: number;
  savedPercent: number;
  localUrl?: string;
}

export function CameraModal({
  folderId,
  folderName,
  token,
  onClose,
  onPhotoSaved,
}: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [preset, setPreset] = useState<CompressionPreset>('lossless_92');
  const [showGrid, setShowGrid] = useState(true);
  const [cameraStatus, setCameraStatus] = useState<'starting' | 'ready' | 'unavailable'>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [sessionPhotos, setSessionPhotos] = useState<CapturedSessionItem[]>([]);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopStream();
      setCameraStatus('starting');
      setCameraError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraStatus('unavailable');
        setCameraError('Live browser camera is unavailable here. Use Native Camera / Choose Image below.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraStatus('ready');
      } catch {
        setCameraStatus('unavailable');
        setCameraError(
          'Camera permission was denied or no live webcam was found. Use the Native Camera / Choose Image button below.'
        );
      }
    },
    [stopStream]
  );

  useEffect(() => {
    void startCamera(facingMode);
    return () => {
      stopStream();
    };
  }, [facingMode, startCamera, stopStream]);

  async function saveCompressedResult(
    source: Blob | HTMLCanvasElement,
    baseName: string,
    estimatedRawBytes?: number
  ) {
    const compressed = await compressPhotoLosslessly(source, preset, estimatedRawBytes);
    const saved = await uploadCompressedPhoto(token, folderId, {
      dataUrl: compressed.dataUrl,
      fileName: baseName,
      originalSize: compressed.originalSize,
      compressedSize: compressed.compressedSize,
      width: compressed.width,
      height: compressed.height,
      mimeType: compressed.mimeType,
      qualityLabel: compressed.qualityLabel,
    });

    setSessionPhotos((prev) => [
      {
        id: saved.id,
        fileName: saved.fileName,
        originalSize: saved.originalSize,
        compressedSize: saved.compressedSize,
        savedPercent: compressed.savedPercent,
        localUrl: saved.localUrl,
      },
      ...prev,
    ]);
    onPhotoSaved(saved);
    setUploadNotice(
      `Saved ${formatBytes(saved.compressedSize)} (${compressed.savedPercent}% smaller)`
    );
  }

  async function handleCaptureSnap() {
    const video = videoRef.current;
    if (!video || cameraStatus !== 'ready' || isProcessing) return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    setIsProcessing(true);
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 160);

    try {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;
      const ctx = frameCanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable.');
      ctx.drawImage(video, 0, 0, width, height);

      // Typical uncompressed/camera-sensor JPEG equivalent size for accurate savings reporting
      const estimatedRawSize = Math.round(width * height * 0.9);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await saveCompressedResult(frameCanvas, `IMG_${stamp}.jpg`, estimatedRawSize);
    } catch (err) {
      setUploadNotice(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleFileSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setUploadNotice(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await saveCompressedResult(file, file.name, file.size);
      }
    } catch (err) {
      setUploadNotice(err instanceof Error ? err.message : 'Failed to process photo.');
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  }

  const lastPhoto = sessionPhotos[0];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`Camera for ${folderName}`}
    >
      {/* Top Camera Bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-950/90 border-b border-white/10 shrink-0">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 truncate">Saving into folder</p>
          <h2 className="text-sm font-semibold text-white truncate">{folderName}</h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <select
            aria-label="Compression quality"
            value={preset}
            onChange={(e) => setPreset(e.target.value as CompressionPreset)}
            className="min-h-[40px] px-2.5 py-1.5 text-xs font-medium bg-slate-900 border border-white/15 rounded-lg text-slate-100 focus:outline-none focus:border-[#2563EB]"
          >
            <option value="lossless_92">Visually Lossless (92%)</option>
            <option value="ultra_95">Ultra Crisp (95%)</option>
            <option value="compact_85">Compact HD (85%)</option>
          </select>

          <button
            type="button"
            onClick={() => setShowGrid((g) => !g)}
            aria-label="Toggle framing grid"
            className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
              showGrid
                ? 'bg-white/15 border-white/25 text-white'
                : 'bg-transparent border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            <Grid3X3 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Viewfinder Area */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-contain ${
            cameraStatus === 'ready' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Framing Grid Overlay */}
        {cameraStatus === 'ready' && showGrid && (
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            <div className="border-r border-b border-white/15" />
            <div className="border-r border-b border-white/15" />
            <div className="border-b border-white/15" />
            <div className="border-r border-b border-white/15" />
            <div className="border-r border-b border-white/15" />
            <div className="border-b border-white/15" />
            <div className="border-r border-white/15" />
            <div className="border-r border-white/15" />
            <div />
          </div>
        )}

        {/* Shutter Flash */}
        {flashActive && (
          <div className="pointer-events-none absolute inset-0 bg-white/75 transition-opacity duration-150" />
        )}

        {/* Starting State */}
        {cameraStatus === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Camera className="w-10 h-10 text-slate-400 animate-pulse" />
            <p className="text-sm text-slate-300">Starting camera viewfinder...</p>
          </div>
        )}

        {/* Unavailable / Native Camera Fallback */}
        {cameraStatus === 'unavailable' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mb-4">
              <Camera className="w-7 h-7 text-slate-200" />
            </div>
            <h3 className="text-base font-semibold text-white mb-2">Use Device Camera or Photos</h3>
            <p className="text-sm text-slate-300 mb-6 leading-relaxed">{cameraError}</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="min-h-[48px] px-6 py-3 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold rounded-xl flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ImagePlus className="w-4 h-4" />
              <span>{isProcessing ? 'Compressing & Saving...' : 'Open Native Camera / Gallery'}</span>
            </button>
          </div>
        )}

        {/* Instant Save Confirmation Banner */}
        {uploadNotice && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 max-w-[90%] bg-slate-900/90 backdrop-blur-md border border-white/15 px-3.5 py-2 rounded-xl flex items-center gap-2 text-xs text-white shadow-lg">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate tabular-nums">{uploadNotice}</span>
          </div>
        )}
      </div>

      {/* Hidden native camera / multi-file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFileSelection}
        className="hidden"
      />

      {/* Bottom Thumb-Zone Controls */}
      <div className="bg-slate-950 border-t border-white/10 px-4 py-4 pb-safe shrink-0">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
          {/* Left: Last captured thumbnail or Native upload */}
          <div className="flex items-center gap-2.5 min-w-[100px]">
            {lastPhoto ? (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-2 text-left group cursor-pointer"
              >
                <img
                  src={getPhotoViewUrl(lastPhoto.id, token, lastPhoto.localUrl)}
                  alt={lastPhoto.fileName}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-lg object-cover border border-white/25 shrink-0"
                />
                <div className="text-xs leading-tight">
                  <div className="font-semibold text-white tabular-nums">{sessionPhotos.length} saved</div>
                  <div className="text-slate-400 group-hover:text-white">View folder</div>
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Upload</span>
              </button>
            )}
          </div>

          {/* Center: Primary Shutter Button */}
          <button
            type="button"
            onClick={cameraStatus === 'ready' ? handleCaptureSnap : () => fileInputRef.current?.click()}
            disabled={isProcessing}
            aria-label="Take photo and save to folder"
            className="w-[68px] h-[68px] rounded-full border-4 border-white flex items-center justify-center p-1 active:scale-95 transition-transform disabled:opacity-50 cursor-pointer shrink-0"
          >
            <span
              className={`w-full h-full rounded-full transition-colors ${
                isProcessing ? 'bg-[#2563EB]' : 'bg-white hover:bg-slate-100'
              }`}
            />
          </button>

          {/* Right: Flip camera / Done */}
          <div className="flex items-center justify-end gap-2 min-w-[100px]">
            {cameraStatus === 'ready' && (
              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
                aria-label="Switch camera"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/15 text-white cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
