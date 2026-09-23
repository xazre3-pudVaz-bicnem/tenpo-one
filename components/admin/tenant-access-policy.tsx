'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { MAX_ALLOWED_NETWORKS, type AllowedNetwork } from '@/lib/store-access';
import { StoreRegisterPassword } from '@/components/admin/store-register-password';

export interface RegisterDeviceRow {
  id: string;
  name: string;
  userAgent: string | null;
  firstIp: string | null;
  lastSeenAt: string | null;
  status: string;
}

/**
 * 契約時のアクセス制限（運営だけが設定）。
 * - お店の回線（IP）を入れると、レジ（iPad）とハンディはその回線からだけ使える
 * - レジ（iPad）とハンディの台数
 * - レジ用パスワード（企業番号と合わせてiPadのログインに使う。運営だけが作り直せる）
 * 回線を1つも入れない＝制限なし（今まで通り）。
 */
export function TenantAccessPolicy({
  storeId,
  orgCode,
  networks,
  registerLimit,
  handyLimit,
  handyCount,
  note,
  devices,
  saveAction,
  revokeAction,
  reissueAction,
  revealAction,
}: {
  storeId: string;
  orgCode: string | null;
  networks: AllowedNetwork[];
  registerLimit: number;
  handyLimit: number;
  handyCount: number;
  note: string;
  devices: RegisterDeviceRow[];
  saveAction: (input: {
    storeId: string;
    ips: { ip: string; label: string }[];
    registerLimit: number;
    handyLimit: number;
    note: string;
  }) => Promise<{ error?: string }>;
  revokeAction: (input: { storeId: string; deviceId: string }) => Promise<{ error?: string }>;
  reissueAction: (input: { storeId: string }) => Promise<{ password?: string; error?: string }>;
  revealAction: (input: { storeId: string }) => Promise<{
    password?: string;
    updatedAt?: string | null;
    notSet?: boolean;
    error?: string;
  }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<{ ip: string; label: string }[]>(
    networks.length > 0 ? networks.map((n) => ({ ip: n.key, label: n.label })) : [{ ip: '', label: '' }]
  );
  const [limit, setLimit] = useState(String(registerLimit));
  const [handy, setHandy] = useState(String(handyLimit));
  const [memo, setMemo] = useState(note);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const r = await saveAction({
        storeId,
        ips: rows.filter((x) => x.ip.trim()),
        registerLimit: Number(limit) || 0,
        handyLimit: Number(handy) || 0,
        note: memo,
      });
      if (r.error) toast(r.error, 'error');
      else {
        toast('アクセス制限を保存しました');
        router.refresh();
      }
    });

  const revoke = (deviceId: string) =>
    startTransition(async () => {
      const r = await revokeAction({ storeId, deviceId });
      if (r.error) toast(r.error, 'error');
      else {
        toast('レジ端末を解除しました');
        router.refresh();
      }
    });

  const activeCount = devices.filter((d) => d.status === 'active').length;

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-gray-500">
        契約時に、この店舗の回線（グローバルIP）とレジ端末の台数を決めます。回線を入れると、レジ（/app/pos・フロア）とハンディは
        その回線からだけ使えます（注文・厨房への送信・会計も止まります）。会計・帳票・設定などの画面は制限しません。
        回線を1件も入れない場合は制限なし（回線・台数のどちらも効きません＝今まで通り）。IPv6 は上位64ビットで判定します。
      </p>

      <div className="space-y-2">
        <Label>お店の回線（IPアドレス）</Label>
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input
              value={row.ip}
              onChange={(e) => setRows((list) => list.map((x, j) => (j === i ? { ...x, ip: e.target.value } : x)))}
              placeholder="203.0.113.5 または 2001:db8:1:2::"
              className="w-64 font-mono"
            />
            <Input
              value={row.label}
              onChange={(e) => setRows((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              placeholder="メモ（例: 店舗光回線）"
              className="w-56"
            />
            <button
              type="button"
              aria-label="削除"
              onClick={() => setRows((list) => (list.length === 1 ? [{ ip: '', label: '' }] : list.filter((_, j) => j !== i)))}
              className="rounded p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setRows((list) => (list.length >= MAX_ALLOWED_NETWORKS ? list : [...list, { ip: '', label: '' }]))}
          disabled={pending}
        >
          <Plus className="h-4 w-4" />
          回線を追加
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="register-limit">レジ端末（iPad）の台数</Label>
          <Input id="register-limit" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))} className="w-24 text-right" inputMode="numeric" />
          <p className="mt-1 text-xs text-gray-500">台数の制限は、回線を1件以上入れてから効きます</p>
        </div>
        <div>
          <Label htmlFor="handy-limit">ハンディの台数</Label>
          <Input id="handy-limit" value={handy} onChange={(e) => setHandy(e.target.value.replace(/[^0-9]/g, ''))} className="w-24 text-right" inputMode="numeric" />
          <p className="mt-1 text-xs text-gray-500">
            いま <span className="tabular-nums">{handyCount}</span> 台つながっています
          </p>
        </div>
        <div className="flex-1">
          <Label htmlFor="access-note">メモ（契約内容など）</Label>
          <Input id="access-note" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: 2026-09 契約。固定IP。増設は要相談" />
        </div>
        <Button onClick={save} disabled={pending}>
          {pending ? '保存中…' : '保存する'}
        </Button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-surface px-4 py-3">
        <p className="text-sm font-semibold text-navy">レジ（iPad）のログイン</p>
        <p className="mt-1 text-sm text-gray-600">
          企業番号 <span className="font-mono text-base text-navy">{orgCode ?? '（未発行）'}</span>
          <span className="ml-2 text-xs text-gray-500">＋ 店舗ごとのレジ用パスワード</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          どの店舗のレジかは、上で登録したお店の回線で決まります。パスワードは運営だけが作り直せます（店舗・オーナーは変更できません）。
        </p>
        <div className="mt-2">
          <StoreRegisterPassword
            storeId={storeId}
            revealAction={revealAction}
            reissueAction={reissueAction}
            compact
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-navy">
          登録済みのレジ端末 <span className="tabular-nums">{activeCount}</span> / {registerLimit}台
        </p>
        <ul className="space-y-1.5">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <span className="min-w-0">
                {d.name}
                <span className="ml-2 font-mono text-xs text-gray-500">{d.firstIp ?? '—'}</span>
                <span className="ml-2 text-xs text-gray-400">{d.lastSeenAt ? `最終 ${d.lastSeenAt}` : '未使用'}</span>
                <span className="ml-2 text-xs text-gray-400">{(d.userAgent ?? '').slice(0, 40)}</span>
              </span>
              {d.status === 'active' ? (
                <Button size="sm" variant="ghost" onClick={() => revoke(d.id)} disabled={pending}>
                  解除
                </Button>
              ) : (
                <Badge tone="gray">解除済み</Badge>
              )}
            </li>
          ))}
          {devices.length === 0 && <li className="text-xs text-gray-400">まだレジ端末は登録されていません</li>}
        </ul>
      </div>
    </div>
  );
}
