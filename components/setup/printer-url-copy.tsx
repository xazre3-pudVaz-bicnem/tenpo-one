'use client';

import { useState, useSyncExternalStore } from 'react';
import { Copy, Check } from 'lucide-react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
/** # 以降のトークンから接続用URLを組み立てる（トークンは48桁の16進） */
const getUrl = () => {
  const token = window.location.hash.slice(1);
  return /^[0-9a-f]{48}$/i.test(token) ? `${window.location.origin}/api/cloudprnt/${token}` : '';
};
const getServerUrl = () => '';

export function PrinterUrlCopy() {
  const url = useSyncExternalStore(subscribe, getUrl, getServerUrl);
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
        <li>Star Quick Setup Utility でプリンタに接続（Bluetooth）</li>
        <li>ネットワーク → IPアドレスを「自動取得（DHCP）」</li>
        <li>CloudPRNT → 有効、サーバーURLに貼り付け、間隔5秒</li>
        <li>ユーザー名・パスワードは空欄のまま保存 → 再起動</li>
      </ol>
      <p className="text-xs text-gray-500">
        このURLはお店専用です。他の人に共有しないでください。
      </p>
    </div>
  );
}
