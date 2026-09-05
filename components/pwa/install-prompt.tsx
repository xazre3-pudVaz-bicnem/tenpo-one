'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, X } from 'lucide-react';

/** Chromium系が発火する beforeinstallprompt イベント（型定義が標準にないため最小限で定義） */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * ホーム画面へのインストールを促すバナー。
 * Chrome/Edge（Android・PC）は beforeinstallprompt を捕捉してワンタップでインストールできる。
 * iOS Safari はこのイベントが無いためバナーは出ず、手順は /install ページで案内する。
 * 既にインストール済み（standalone起動）ではイベント自体が発火しないので表示されない。
 */
export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // 既定のミニバーを抑止し、任意のタイミングで出す
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!promptEvent || hidden) return null;

  const install = async () => {
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } finally {
      setPromptEvent(null);
    }
  };

  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 lg:mx-6">
      <Download className="h-5 w-5 shrink-0 text-primary-deep" />
      <p className="min-w-0 flex-1 text-sm text-primary-deep">
        この端末に <strong>TENPO ONE</strong> をアプリとして追加できます（全画面で起動・ホーム画面にアイコン）。
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={install}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-deep"
        >
          インストール
        </button>
        <Link href="/install" className="text-xs text-primary-deep underline">
          他の端末
        </Link>
        <button type="button" onClick={() => setHidden(true)} aria-label="閉じる" className="rounded p-1 text-primary-deep hover:bg-white/60">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
