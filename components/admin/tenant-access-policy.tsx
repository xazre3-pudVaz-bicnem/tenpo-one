'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import type { AllowedNetwork } from '@/lib/store-access';
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
 * 契約の内容（運営だけが設定）。
 * - レジ（iPad）とハンディの台数
 * - レジ用パスワード（企業番号・店舗ユーザー名と合わせてレジのログインに使う。運営だけが作り直せる）
 *
 * お店の回線（IP）による制限は、現場の手間が大きいので画面から外している（2026-09-23）。
 * 仕組み自体は残してあるので、必要になったらこの画面に戻すだけで使える。
 */
export function TenantAccessPolicy({
  storeId,
  orgCode,
  storeUser,
  networks,
  networkEnforced,
  registerLimit,
  handyLimit,
  handyCount,
  note,
  devices,
  saveAction,
  revokeAction,
  reissueAction,
  revealAction,
  renameAction,
}: {
  storeId: string;
  orgCode: string | null;
  storeUser: string | null;
  networks: AllowedNetwork[];
  networkEnforced: boolean;
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
    networkEnforced: boolean;
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
  renameAction: (input: { storeId: string; username: string }) => Promise<{ username?: string; error?: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [limit, setLimit] = useState(String(registerLimit));
  const [handy, setHandy] = useState(String(handyLimit));
  const [memo, setMemo] = useState(note);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const r = await saveAction({
        storeId,
        // 回線（IP）の制限はいま使っていない。保存時に今の値をそのまま送る
        ips: networks.map((n) => ({ ip: n.key, label: n.label })),
        registerLimit: Number(limit) || 0,
        handyLimit: Number(handy) || 0,
        networkEnforced,
        note: memo,
      });
      if (r.error) toast(r.error, 'error');
      else {
        toast('契約の内容を保存しました');
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
        契約時に、レジ（iPad）とハンディの台数を決めます。レジは 企業番号 ＋ 店舗ユーザー名 ＋ レジ用パスワード で開きます。
        台数の制限は、この画面で保存した店舗に効きます（0 にすると数えません）。
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="register-limit">レジ端末（iPad）の台数</Label>
          <Input id="register-limit" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))} className="w-24 text-right" inputMode="numeric" />
          <p className="mt-1 text-xs text-gray-500">0 にすると台数を数えません</p>
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
          <span className="ml-2 text-xs text-gray-500">＋ 店舗ユーザー名 ＋ 店舗ごとのレジ用パスワード</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          パスワードは運営だけが作り直せます（店舗・オーナーは変更できません）。
        </p>
        <div className="mt-2">
          <StoreRegisterPassword
            storeId={storeId}
            storeUser={storeUser}
            revealAction={revealAction}
            reissueAction={reissueAction}
            renameAction={renameAction}
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
