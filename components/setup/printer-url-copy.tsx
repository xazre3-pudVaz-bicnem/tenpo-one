'use client';

import { useState, useSyncExternalStore } from 'react';
import { Copy, Check } from 'lucide-react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
/** # 以降のトークン（48桁の16進）。無効ならnull。 */
const getToken = () => {
  const token = window.location.hash.slice(1);
  return /^[0-9a-f]{48}$/i.test(token) ? token : '';
};
const getServerToken = () => '';
/** 表示するURLは絶対URLにするため、開いている画面のオリジンを使う（サーバー描画時は空）。 */
const getOrigin = () => window.location.origin;

/** メーカーごとの接続方式と設定手順（プリンタ側の画面名に合わせる）。 */
const GUIDE = {
  star: {
    path: 'cloudprnt',
    steps: [
      'Star Quick Setup Utility でプリンタに接続（Bluetooth）',
      'ネットワーク → IPアドレスを「自動取得（DHCP）」',
      'CloudPRNT → 有効、サーバーURLに貼り付け、間隔5秒',
      'ユーザー名・パスワードは空欄のまま保存 → 再起動',
    ],
  },
  epson: {
    path: 'epson',
    steps: [
      'Epson TM Utility でプリンタに接続し、Wi-Fi（またはLAN）でネットワークにつなぐ',
      'プリンタのIPアドレスをブラウザで開く（Web Config）',
      'Server Direct Print → 有効、サーバー1のURLに貼り付け、間隔3秒',
      'ID・パスワードは空欄のまま設定を保存 → 再起動',
    ],
  },
} as const;

export function PrinterUrlCopy({ maker = 'star' }: { maker?: 'star' | 'epson' }) {
  const token = useSyncExternalStore(subscribe, getToken, getServerToken);
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerToken);
  const guide = GUIDE[maker];
  const url = token && origin ? `${origin}/api/${guide.path}/${token}` : '';
  const [copied, setCopied] = useState(false);

  if (!url) {
    return (
      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        URLを読み取れませんでした。TENPO ONE の「設定 → レジ・プリンター」に表示されているQRコードを、もう一度読み取ってください。
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* 非対応環境では長押しで選択してもらう */
    }
  };

  return (
    <div className="mt-5 space-y-4">
      <div className="break-all rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs text-navy select-all">{url}</div>
      <button
        type="button"
        onClick={copy}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-white active:bg-primary-deep"
      >
        {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
        {copied ? 'コピーしました' : 'URLをコピー'}
      </button>
      <ol className="list-decimal space-y-1.5 rounded-xl bg-gray-50 p-4 pl-8 text-sm text-gray-700">
        {guide.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="text-xs text-gray-500">
        このURLはお店専用です。他の人に共有しないでください。
      </p>
    </div>
  );
}
