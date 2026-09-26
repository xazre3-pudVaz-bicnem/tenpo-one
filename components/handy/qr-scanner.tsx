'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';

/**
 * ハンディのQRコードをブラウザで読む（2026-09-26 Ronnie「ハンディログインはQRコードのボタンで」）。
 * - カメラ（getUserMedia・背面）を開いて jsQR で読み続ける
 * - カメラが使えない端末・許可しなかったときは、写真を撮って読む（input capture）
 * 読めたら onResult(text) を1回だけ呼ぶ。閉じるまでカメラは止めない。
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('このブラウザではカメラが使えません。下の「写真を撮って読む」を使ってください');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        setCameraError('カメラを使えませんでした（許可が必要です）。下の「写真を撮って読む」でも読めます');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const { default: jsQR } = await import('jsqr');
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const tick = () => {
        if (cancelled || doneRef.current) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          const w = Math.min(640, video.videoWidth);
          const h = Math.round((video.videoHeight / video.videoWidth) * w);
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            doneRef.current = true;
            onResult(code.data);
            return;
          }
        }
        timer = window.setTimeout(tick, 150);
      };
      tick();
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  /** 写真から読む（カメラが使えないとき） */
  const readFile = async (file: File) => {
    setBusy(true);
    try {
      const { default: jsQR } = await import('jsqr');
      const bmp = await createImageBitmap(file);
      const w = Math.min(1024, bmp.width);
      const h = Math.round((bmp.height / bmp.width) * w);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(bmp, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h);
      if (code?.data) {
        doneRef.current = true;
        onResult(code.data);
      } else {
        setCameraError('QRコードが読み取れませんでした。QRコード全体が写るように、もう一度撮ってください');
      }
    } catch {
      setCameraError('写真を読み込めませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="QRコードを読み取る">
      <header className="flex items-center justify-between px-3 py-2">
        <span className="flex items-center gap-2 text-[15px] font-bold">
          <Camera className="h-5 w-5" aria-hidden />
          QRコードを読み取る
        </span>
        <button type="button" onClick={onClose} aria-label="閉じる" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-white/10">
          <X className="h-6 w-6" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* カメラ映像（音声なし） */}
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        {/* 読み取り枠 */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-56 w-56 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        {cameraError && (
          <p className="absolute inset-x-4 top-4 rounded-xl bg-black/70 px-4 py-3 text-center text-sm">{cameraError}</p>
        )}
      </div>

      <footer className="space-y-2 px-4 py-4">
        <p className="text-center text-[13px] text-white/80">レジ（iPad）の「iPhoneハンディ」に出ているQRコードを枠に入れてください</p>
        <label className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/60 text-[15px] font-bold">
          <ImagePlus className="h-5 w-5" aria-hidden />
          {busy ? '読み取り中…' : '写真を撮って読む'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </footer>
    </div>
  );
}
