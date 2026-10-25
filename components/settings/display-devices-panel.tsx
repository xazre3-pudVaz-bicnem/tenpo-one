'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { CircleAlert, Monitor, Wifi } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import {
  isDisplayOnline,
  type DisplayDeviceListRow,
  type DisplayDevicesPayload,
  type DisplayKind,
  type DisplayStation,
} from '@/lib/display-monitor';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });

type IssueAction = (
  storeId: string,
  input: { deviceName: string; kind: DisplayKind; stations: string[] }
) => Promise<{ error?: string; code?: string; expiresAt?: string }>;

/**
 * 設定 › デバイス管理 › ディスプレイ端末（2026-10-24 Ronnie）。
 * 店のモニター・タブレットをQRでつなぎ、キッチンディスプレイ（持ち場を絞れる）か呼び出しモニターを出す。
 * つないだ端末はログアウトしない（お店の回線の外では画面に案内を出して待つ）。解除はここから。
 */
export function DisplayDevicesPanel({
  payload,
  now: initialNow,
  issueAction,
  revokeAction,
  renameAction,
  updateAction,
}: {
  payload: DisplayDevicesPayload;
  /** サーバーで描いた時刻（「使用中」の判定の初期値） */
  now: number;
  issueAction: IssueAction;
  revokeAction: (deviceId: string) => Promise<{ error?: string }>;
  renameAction: (deviceId: string, name: string) => Promise<{ error?: string }>;
  updateAction: (deviceId: string, input: { kind: DisplayKind; stations: string[] }) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [deviceName, setDeviceName] = useState('キッチンモニター');
  const [kind, setKind] = useState<DisplayKind>('kitchen');
  const [stations, setStations] = useState<DisplayStation[]>([]);
  const [qr, setQr] = useState<{ dataUrl: string; expiresAt: string } | null>(null);
  const [revoking, setRevoking] = useState<DisplayDeviceListRow | null>(null);
  const [editing, setEditing] = useState<{ id: string; kind: DisplayKind; stations: DisplayStation[] } | null>(null);
  const [now, setNow] = useState(initialNow);

  // 「使用中」（3分以内に通信）を進める
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // QRは5分で切れる。切れたら自動で消す
  useEffect(() => {
    if (!qr) return;
    const left = Math.max(0, new Date(qr.expiresAt).getTime() - Date.now());
    const timer = setTimeout(() => setQr(null), left);
    return () => clearTimeout(timer);
  }, [qr]);

  const toggle = (list: DisplayStation[], s: DisplayStation) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]);

  const handleIssue = () => {
    startTransition(async () => {
      const result = await issueAction(payload.store.id, { deviceName, kind, stations });
      if (result.error || !result.code || !result.expiresAt || !payload.pairBase) {
        toast(result.error ?? 'QRコードを発行できませんでした', 'error');
        return;
      }
      // 登録画面は認証の外。コードは # 以降に置きサーバーへ送らない（ハンディと同じ）
      const url = `${payload.pairBase}${result.code}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 1 });
      setQr({ dataUrl, expiresAt: result.expiresAt });
    });
  };

  const handleRevoke = (device: DisplayDeviceListRow) => {
    startTransition(async () => {
      const result = await revokeAction(device.id);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(`${device.name} を解除しました`);
      setRevoking(null);
      router.refresh();
    });
  };

  const handleRename = (device: DisplayDeviceListRow, name: string) => {
    if (!name || name === device.name) return;
    startTransition(async () => {
      const result = await renameAction(device.id, name);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      router.refresh();
    });
  };

  const handleUpdate = () => {
    if (!editing) return;
    startTransition(async () => {
      const result = await updateAction(editing.id, { kind: editing.kind, stations: editing.stations });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('種類・持ち場を変えました（端末の画面は自動で切り替わります）');
      setEditing(null);
      router.refresh();
    });
  };

  const active = payload.devices.filter((d) => d.status === 'active');
  const revoked = payload.devices.filter((d) => d.status === 'revoked');
  const canIssue = payload.canEdit && payload.flagOn && !!payload.pairBase;

  return (
    <div className="space-y-5">
      {!payload.flagOn && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {payload.flagMessage ?? 'この機能は使えません（運営にお問い合わせください）'}
            {payload.devices.length > 0 && '（つないである端末の解除はできます）'}
          </span>
        </div>
      )}

      {payload.canEdit && payload.flagOn && (
        <Card>
          <CardHeader>
            <CardTitle en="Pair a display">ディスプレイをつなぐ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              お店のモニター・タブレットでQRコードを読み取ると、その端末が {payload.store.name} のキッチンディスプレイか呼び出しモニターになります。つないだ端末は自動でログアウトしません。
            </p>
            <p className="flex items-start gap-1.5 rounded-lg bg-primary-soft/40 px-3 py-2 text-xs text-gray-700">
              <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span>
                端末を<strong>お店の回線（このレジと同じWi-Fi・有線）</strong>につないだ状態で読み取ってください。お店の回線の外では画面に「お店の回線につないでください」と出ます（ログアウトはしません）。
              </span>
            </p>

            {!payload.pairBase && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                公開URL（環境変数 <code className="font-mono">NEXT_PUBLIC_SITE_URL</code>）が未設定のため、QRコードを作れません。
              </div>
            )}

            <div className="space-y-3">
              <div className="max-w-sm">
                <Label htmlFor="display-device-name">端末の名前</Label>
                <Input
                  id="display-device-name"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="キッチンモニター"
                  maxLength={40}
                />
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-gray-700">種類</p>
                <ChipRow
                  options={payload.kinds}
                  isOn={(id) => kind === id}
                  onPick={(id) => setKind(id as DisplayKind)}
                />
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-gray-700">
                  {kind === 'kitchen' ? '出す持ち場' : '呼び出しの対象の持ち場'}
                  <span className="ml-2 text-xs font-normal text-gray-500">何も選ばない＝すべて</span>
                </p>
                <ChipRow
                  options={payload.stations}
                  isOn={(id) => stations.includes(id as DisplayStation)}
                  onPick={(id) => setStations((cur) => toggle(cur, id as DisplayStation))}
                />
              </div>
              <Button type="button" onClick={handleIssue} disabled={pending || !canIssue}>
                {pending ? '発行中…' : 'QRコードを表示'}
              </Button>
            </div>

            {qr && (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr.dataUrl} alt="ディスプレイ端末の登録用QRコード" className="h-[280px] w-[280px]" />
                <p className="text-center text-xs text-gray-500">
                  モニター・タブレットのカメラで読み取ってください
                  <br />
                  有効期限 {dateTime(qr.expiresAt)}（5分・1回限り）
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle en="Displays">つないでいる端末</CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <EmptyState
              title="つないでいる端末はありません"
              description={payload.flagOn ? '上の「QRコードを表示」からモニター・タブレットをつないでください' : undefined}
            />
          ) : (
            <ul className="space-y-3">
              {active.map((d) => {
                const online = isDisplayOnline(d.lastSeenAt, now);
                const isEditing = editing?.id === d.id;
                return (
                  <li key={d.id} className="rounded-xl border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Monitor className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                        {payload.canEdit ? (
                          <Input
                            defaultValue={d.name}
                            maxLength={40}
                            className="h-9 w-44"
                            onBlur={(e) => handleRename(d, e.target.value.trim())}
                            aria-label="端末の名前"
                          />
                        ) : (
                          <span className="font-semibold text-navy">{d.name}</span>
                        )}
                        <Badge tone="navy">{d.kindLabel}</Badge>
                        <Badge tone={online ? 'success' : 'gray'}>{online ? '使用中' : '未使用'}</Badge>
                      </div>
                      {payload.canEdit && (
                        <div className="flex gap-2">
                          {payload.flagOn && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={pending}
                              onClick={() => setEditing(isEditing ? null : { id: d.id, kind: d.kind, stations: d.stations })}
                            >
                              種類・持ち場
                            </Button>
                          )}
                          <Button variant="danger" size="sm" disabled={pending} onClick={() => setRevoking(d)}>
                            解除
                          </Button>
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      持ち場 {d.stationsLabel}・{d.deviceModel}・登録 {dateTime(d.pairedAt)}
                      {d.lastSeenAt && `・最終通信 ${dateTime(d.lastSeenAt)}`}
                      {(d.lastIp ?? d.pairedIp) && `・IP ${d.lastIp ?? d.pairedIp}`}
                    </p>
                    {isEditing && editing && (
                      <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-3">
                        <ChipRow
                          options={payload.kinds}
                          isOn={(id) => editing.kind === id}
                          onPick={(id) => setEditing({ ...editing, kind: id as DisplayKind })}
                        />
                        <ChipRow
                          options={payload.stations}
                          isOn={(id) => editing.stations.includes(id as DisplayStation)}
                          onPick={(id) => setEditing({ ...editing, stations: toggle(editing.stations, id as DisplayStation) })}
                        />
                        <p className="text-xs text-gray-500">持ち場を何も選ばない＝すべて</p>
                        <div className="flex gap-2">
                          <Button size="sm" disabled={pending} onClick={handleUpdate}>
                            保存する
                          </Button>
                          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(null)}>
                            やめる
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
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
                  <span>
                    {d.name}
                    <span className="ml-2 text-xs text-gray-400">{d.kindLabel}</span>
                  </span>
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
          title={`${revoking.name} を解除しますか？`}
          message="この端末では画面が出なくなります（「この端末は解除されました」と表示）。もう一度使うにはQRコードでつなぎ直してください。"
          confirmLabel="解除する"
          onClose={() => setRevoking(null)}
          onConfirm={() => handleRevoke(revoking)}
        />
      )}
    </div>
  );
}

function ChipRow({
  options,
  isOn,
  onPick,
}: {
  options: { id: string; label: string }[];
  isOn: (id: string) => boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onPick(o.id)}
          aria-pressed={isOn(o.id)}
          className={cn(
            'h-10 rounded-lg border px-4 text-sm font-bold transition-colors',
            isOn(o.id) ? 'border-navy bg-navy text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
