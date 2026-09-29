'use client';

import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';

/**
 * リンクの「コピー」と「共有」ボタン（リンクそのものは変えられない）。
 * 共有は端末の共有メニュー（LINE・メール・AirDrop など）。使えない端末ではコピーになる。
 * 2026-09-29 Ronnie「店舗情報に店舗ご予約のリンクを。コピーと共有のボタンも。リンクは編集できないように」
 */
export function ShareLinkButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない端末は何もしない
    }
  };

  const share = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        // 閉じただけ（AbortError）は何もしない
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await copy();
  };

  const btn =
    'inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-bold text-royal transition-colors hover:bg-lilac-soft';
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={copy} className={btn}>
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        <span className="flex flex-col items-start leading-tight">
          {copied ? 'コピーしました' : 'コピー'}
          <span className="text-[9.5px] font-semibold text-ink-3">{copied ? 'Copied' : 'Copy'}</span>
        </span>
      </button>
      <button type="button" onClick={share} className={btn}>
        <Share2 className="h-4 w-4" aria-hidden />
        <span className="flex flex-col items-start leading-tight">
          共有
          <span className="text-[9.5px] font-semibold text-ink-3">Share</span>
        </span>
      </button>
    </span>
  );
}
