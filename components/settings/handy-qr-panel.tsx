'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Printer, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { handyQrUrl, type ShopNetwork } from '@/lib/handy-qr';

type Action<A extends unknown[]> = (...args: A) => Promise<{ error?: string }>;

/**
 * iPhone用ハンディの設定（固定QRコード・お店のWi-Fi）。
 * QRは毎日変わらない。印刷してレジ横などに貼っておき、スタッフは iPhone のカメラで読むだけ。
 */
export function HandyQrPanel({
  storeId,
  storeName,
  token,
  networks,
  currentNetwork,
  currentIsShop,
  activeDevices,
  setupAction,
  regenerateAction,
  addNetworkAction,
  removeNetworkAction,
}: {
  storeId: string;
  storeName: string;
  token: string | null;
  networks: ShopNetwork[];
  currentNetwork: string | null;
  currentIsShop: boolean;
  activeDevices: number;
  setupAction: Action<[string, string[]]>;
  regenerateAction: Action<[string]>;
  addNetworkAction: Action<[string, string, string[]]>;
  removeNetworkAction: Action<[string, string]>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!token) return;
    let alive = true;
    QRCode.toDataURL(handyQrUrl(window.location.origin, token), { width: 320, margin: 1 })
      .then((u) => alive && setQrDataUrl(u))
      .catch(() => alive && setQrDataUrl(null));
    return () => {
      alive = false;
    };
  }, [token]);

  /** この回線の IPv4 / IPv6 を調べる（お店の回線が両方あるとき、iPhone が IPv6 でつながっても開けるように） */
  const lookupIps = async (): Promise<string[]> => {
    const get = async (url: string) => {
      try {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), 3000);
        const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        window.clearTimeout(t);
        const j = (await r.json()) as { ip?: string };
        return typeof j.ip === 'string' ? j.ip : null;
      } catch {
        return null;
      }
    };
    const found = await Promise.all([get('https://api.ipify.org?format=json'), get('https://api6.ipify.org?format=json')]);
    return found.filter((x): x is string => !!x);
  };

  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.error) toast(r.error, 'error');
      else {
        toast(ok);
        router.refresh();
      }
    });

  const printQr = () => {
    if (!qrDataUrl) return;
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    w.document.write(
      `<html><head><title>ハンディ QR</title></head><body style="font-family:sans-serif;text-align:center;padding:24px">` +
        `<h2 style="margin:0 0 4px">${storeName.replace(/</g, '&lt;')}</h2><p style="margin:0 0 16px">ハンディ（iPhone のカメラで読み取り）</p>` +
        `<img src="${qrDataUrl}" style="width:280px;height:280px"/>` +
        `<p style="font-size:12px;color:#555">お店のWi-Fiにつないでから読み取ってください</p>` +
        `<script>window.onload=()=>{window.print()}</script></body></html>`
    );
    w.document.close();
  };

  if (!token) {
    return (
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-700">
          お店に1つだけの「ハンディのQRコード」を作ります。スタッフはお店のWi-Fiにつないだ iPhone のカメラでこのQRを読むだけで、ハンディが開きます（パスワードなし）。
          お店のWi-Fiの外に出て3分たつと、自動でログアウトします。
        </p>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          いまお使いの端末の回線を「お店のWi-Fi」として登録します。必ず<strong>お店のWi-Fiにつないだレジ</strong>で押してください。
        </p>
        <Button onClick={() => run(async () => setupAction(storeId, await lookupIps()), 'QRコードを作りました')} disabled={pending}>
          QRコードを作る
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-center">
        <p className="text-sm font-semibold text-navy">ハンディのQRコード（{storeName}）</p>
        <p className="mt-1 text-xs text-gray-500">毎日同じQRです。印刷してレジ横やバックヤードに貼ってください。</p>
        <div className="mx-auto mt-4 flex h-[280px] w-[280px] items-center justify-center rounded-lg border border-gray-100 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL の QR 画像 */}
          {qrDataUrl ? <img src={qrDataUrl} alt="ハンディのQRコード" className="h-[270px] w-[270px]" /> : <span className="text-xs text-gray-400">表示中…</span>}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={printQr} disabled={!qrDataUrl}>
            <Printer className="h-4 w-4" />
            印刷する
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(true)} disabled={pending}>
            <RefreshCw className="h-4 w-4" />
            QRを作り直す
          </Button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          いまログインしているハンディ: <strong className="tabular-nums">{activeDevices}</strong>台
        </p>
        <ol className="mt-4 space-y-1 text-left text-xs leading-relaxed text-gray-600">
          <li>1. iPhone をお店のWi-Fiにつなぐ</li>
          <li>2. カメラでこのQRを読む → ハンディがそのまま開く</li>
          <li>3. 初回は Safari の共有ボタン →「ホーム画面に追加」で、次からアイコンで開ける</li>
          <li>4. お店のWi-Fiの外に3分いると自動でログアウト。戻ったらQRを読み直す</li>
        </ol>
      </div>

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <p className="text-sm font-semibold text-navy">お店のWi-Fi（インターネット回線）</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            ブラウザからはWi-Fiの名前が読めないため、お店のインターネット回線で「お店のWi-Fiか」を判定します。
            ここに登録した回線からだけQRで開け、それ以外（スマホの回線・ほかのWi-Fi）に3分いるとログアウトします。
            ルーターの再起動などで回線が変わったら、お店のWi-Fiにつないだレジで「この回線を追加」を押してください。
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
          {currentIsShop ? <Wifi className="h-4 w-4 text-green-600" /> : <WifiOff className="h-4 w-4 text-amber-600" />}
          <span>
            この端末の回線: <span className="font-mono">{currentNetwork ?? '不明'}</span>
          </span>
          {currentIsShop ? <Badge tone="success">登録済み</Badge> : <Badge tone="warning">未登録</Badge>}
        </div>
        <ul className="space-y-2">
          {networks.map((n) => (
            <li key={n.key} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <span>
                {n.label || 'お店のWi-Fi'} <span className="ml-1 font-mono text-xs text-gray-500">{n.key}</span>
              </span>
              <button
                type="button"
                aria-label="外す"
                disabled={pending}
                onClick={() => run(() => removeNetworkAction(storeId, n.key), '回線を外しました')}
                className="rounded p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
          {networks.length === 0 && (
            <li className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">回線が登録されていないため、QRでは開けません。</li>
          )}
        </ul>
        {!currentIsShop && (
          <div className="flex flex-wrap items-center gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="名前（例: 3F Wi-Fi）" className="h-9 w-48" />
            <Button size="sm" onClick={() => run(async () => addNetworkAction(storeId, label, await lookupIps()), '回線を追加しました')} disabled={pending}>
              この回線を追加
            </Button>
          </div>
        )}
      </div>

      {confirmRegen && (
        <ConfirmDialog
          open
          onClose={() => setConfirmRegen(false)}
          title="QRコードを作り直す"
          message="古いQRコードでは開けなくなり、いまログインしているハンディもすべてログアウトします。新しいQRを印刷して貼り替えてください。"
          confirmLabel="作り直す"
          onConfirm={async () => {
            const r = await regenerateAction(storeId);
            if (r.error) toast(r.error, 'error');
            else {
              toast('QRコードを作り直しました');
              router.refresh();
            }
          }}
        />
      )}
    </div>
  );
}
