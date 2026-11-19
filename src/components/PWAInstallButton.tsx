import React, { useState } from 'react';
import { Check, Copy, ExternalLink, MonitorDown, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'primary' | 'subtle';
  fullWidth?: boolean;
}

export function PWAInstallButton({
  variant = 'primary',
  fullWidth = false,
}: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, isAndroid, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  // Suppress button when already running as an installed standalone app
  if (isInstalled) {
    return null;
  }

  async function handleClick() {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) return;
    } else {
      setShowGuide(true);
    }
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  const buttonClasses =
    variant === 'primary'
      ? 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white border border-transparent'
      : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-200';

  const label = isInstallable
    ? 'Install App'
    : isAndroid
      ? 'Install on Android'
      : isIOS
        ? 'Install on iPhone / iPad'
        : 'Install App (Android / PC)';

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={`${fullWidth ? 'w-full' : ''} min-h-[42px] px-3.5 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${buttonClasses}`}
      >
        <MonitorDown className="w-4 h-4 shrink-0" />
        <span>{label}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Install StoreLens App"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-xl text-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Install StoreLens App</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Run StoreLens like a native app on Android mobile and PC desktop.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isInIframe && (
              <div className="mt-4 p-3.5 rounded-xl bg-blue-50 border border-blue-200">
                <p className="text-xs text-slate-700 leading-relaxed">
                  You are viewing the app inside an embedded preview frame. Open the app directly in Chrome or Edge first to enable 1-tap installation.
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <a
                    href={window.location.origin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-h-[40px] px-3 py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Direct App Tab</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl()}
                    className="min-h-[40px] px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 space-y-3 text-xs text-slate-600 leading-relaxed">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="flex items-center gap-2 font-semibold text-slate-900 mb-1">
                  <Smartphone className="w-4 h-4 text-[#2563EB]" />
                  <span>Android Mobile (Chrome)</span>
                </div>
                <p>
                  1. Open this URL in <strong>Google Chrome</strong> on Android.<br />
                  2. Tap the <strong>⋮ Menu</strong> (top right) and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="flex items-center gap-2 font-semibold text-slate-900 mb-1">
                  <MonitorDown className="w-4 h-4 text-[#2563EB]" />
                  <span>PC Desktop (Chrome / Edge)</span>
                </div>
                <p>
                  1. Open this URL in <strong>Chrome</strong> or <strong>Microsoft Edge</strong> on your PC.<br />
                  2. Click the <strong>Install icon</strong> in the right side of the address bar (or open <strong>⋮ Menu → Cast, save, and share → Install StoreLens</strong>).
                </p>
              </div>

              {isIOS && (
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
                  <div className="font-semibold text-slate-900 mb-1">iPhone / iPad (Safari)</div>
                  <p>
                    1. Tap the <strong>Share</strong> button in the Safari toolbar.<br />
                    2. Scroll down and tap <strong>Add to Home Screen</strong>.
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
