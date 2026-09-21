'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Smartphone, Wifi } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface HandyDeviceRow {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  pairedAt: string;
  lastSeenAt: string | null;
  pairedIp: string | null;
  userAgent: string | null;
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });

/** スマホの機種名までは出さず、OSだけ分かれば十分（見分け用） */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return '端末';
  if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iPhone / iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  return '端末';
}

export function HandyDevicesPanel({
  storeId,
  storeName,
  siteUrl,
  devices,
  issueAction,
  revokeAction,
  renameAction,
}: {
  storeId: string;
  storeName: string;
  siteUrl: string;
  devices: HandyDeviceRow[];
  issueAction: (storeId: string, name: string) => Promise<{ error?: string; code?: string; expiresAt?: string }>;
  revokeAction: (deviceId: string) => Promise<{ error?: string }>;
  renameAction: (deviceId: string, name: string) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [deviceName, setDeviceName] = useState('ホール1');
  const [qr, setQr] = useState<{ dataUrl: string; expiresAt: string } | null>(null);
  const [revoking, setRevoking] = useState<HandyDeviceRow | null>(null);

  // QRは5分で切れる。切れたら自動で消して「もう一度表示」に戻す
  useEffect(() => {
    if (!qr) return;
    const left = Math.max(0, new Date(qr.expiresAt).getTime() - Date.now());
    const timer = setTimeout(() => setQr(null), left);
    return () => clearTimeout(timer);
  }, [qr]);

  const handleIssue = () => {
    startTransition(async () => {
      const result = await issueAction(storeId, deviceName);
      if (result.error || !result.code || !result.expiresAt) {
        toast(result.error ?? 'QRコードを発行できませんでした', 'error');
        return;
      }
      // 登録画面は認証の外（/handy はログイン必須のため）。コードは # 以降に置きサーバーへ送らない
      const url = `${siteUrl}/handy-pair#${result.code}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 260, margin: 1 });
      setQr({ dataUrl, expiresAt: result.expiresAt });
    });
  };

  const handleRevoke = (device: HandyDeviceRow) => {
    startTransition(async () => {
      const result = await revokeAction(device.id);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(`${device.name} の接続を解除しました`);
      setRevoking(null);
      router.refresh();
    });
  };

  const handleRename = (device: HandyDeviceRow, name: string) => {
    if (name === device.name) return;
    startTransition(async () => {
      const result = await renameAction(device.id, name);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      router.refresh();
    });
  };

  const active = devices.filter((d) => d.status === 'active');
  const revoked = devices.filter((d) => d.status === 'revoked');

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle en="Pair a device">端末をつなぐ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            スマホでQRコードを読み取ると、その端末が {storeName} のハンディになります。パスワードの入力は要りません。
          </p>
          <p className="flex items-start gap-1.5 rounded-lg bg-primary-soft/40 px-3 py-2 text-xs text-gray-700">
            <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>
              スマホを<strong>お店のWi-Fiにつないだ状態</strong>で読み取ってください。同じ回線でないと登録できません（持ち出した端末から勝手につながらないようにするためです）。
            </span>
          </p>

          {!siteUrl && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              公開URL（環境変数 <code className="font-mono">NEXT_PUBLIC_SITE_URL</code>）が未設定のため、QRコードを作れません。
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <Label htmlFor="handy-device-name">端末の名前</Label>
              <Input
                id="handy-device-name"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="ホール1"
                maxLength={40}
              />
            </div>
            <Button type="button" onClick={handleIssue} disabled={pending || !siteUrl}>
              {pending ? '発行中…' : 'QRコードを表示'}
            </Button>
          </div>

          {qr && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.dataUrl} alt="ハンディ端末の登録用QRコード" className="h-[260px] w-[260px]" />
              <p className="text-center text-xs text-gray-500">
                スマホのカメラで読み取ってください
                <br />
                有効期限 {dateTime(qr.expiresAt)}（5分・1回限り）
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle en="Paired devices">接続中の端末</CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <EmptyState
              title="接続中の端末はありません"
              description="上の「QRコードを表示」からスマホを登録してください"
            />
          ) : (
            <ul className="space-y-3">
              {active.map((d) => (
                <li key={d.id} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Smartphone className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                      <Input
                        defaultValue={d.name}
                        maxLength={40}
                        className="h-9 w-40"
                        onBlur={(e) => handleRename(d, e.target.value.trim())}
                        aria-label="端末の名前"
                      />
                      <Badge tone="success">接続中</Badge>
                    </div>
                    <Button variant="danger" size="sm" disabled={pending} onClick={() => setRevoking(d)}>
                      接続を解除
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {deviceLabel(d.userAgent)}・登録 {dateTime(d.pairedAt)}
                    {d.lastSeenAt && `・最終利用 ${dateTime(d.lastSeenAt)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {revoked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle en="Revoked">解除した端末</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600">
              {revoked.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{d.name}</span>
                  <span className="text-xs text-gray-400">登録 {dateTime(d.pairedAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {revoking && (
        <ConfirmDialog
          open
          title={`${revoking.name} の接続を解除しますか？`}
          message="この端末からはハンディを開けなくなります。もう一度使うにはQRコードで登録し直してください。"
          confirmLabel="解除する"
          onClose={() => setRevoking(null)}
          onConfirm={() => handleRevoke(revoking)}
        />
      )}
    </div>
  );
}
