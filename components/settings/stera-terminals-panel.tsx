'use client';

import { useState, useTransition } from 'react';
import { KeyRound, Plus, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatLinkCode } from '@/lib/stera';
import {
  addSteraTerminal,
  deleteSteraTerminal,
  regenerateSteraLinkCode,
  updateSteraTerminal,
} from '@/app/app/settings/payments/stera-actions';

export interface SteraTerminalView {
  id: string;
  name: string;
  terminalNo: string | null;
  linkCode: string;
  active: boolean;
  online: boolean;
  lastSeenLabel: string | null;
  appVersion: string | null;
}

/**
 * stera 端末の登録（設定 > 決済・端末）。2026-09-29 Ronnie「stera を押したら金額が端末へ行って会計・ドロアまで」。
 * 端末の「TENPO ONE 連携」アプリにリンクコードを入れるとつながる（LAN・IP アドレスは使わない）。
 */
export function SteraTerminalsPanel({
  storeId,
  terminals,
  canEdit,
  serverUrl,
}: {
  storeId: string;
  terminals: SteraTerminalView[];
  /** 管理画面だけ（レジの iPad では見るだけ） */
  canEdit: boolean;
  /** アプリに出るサーバー（確認用） */
  serverUrl: string;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  const [terminalNo, setTerminalNo] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'regen' | 'delete'; id: string; name: string } | null>(null);

  const run = (fn: () => Promise<{ error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast(r.error, 'error');
      else toast(done);
    });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle en="stera terminal">stera 連携（金額を端末へ自動で送る）</CardTitle>
        <Badge tone={terminals.some((t) => t.online) ? 'success' : 'gray'}>
          {terminals.some((t) => t.online) ? 'つながっています' : '未接続'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
          <li>下で端末を追加すると「リンクコード」が出ます。</li>
          <li>
            stera 端末に「TENPO ONE 連携」アプリを入れて開き、リンクコードを入れます（サーバー：
            <span className="font-mono">{serverUrl}</span>）。
          </li>
          <li>アプリに「つながりました」と出れば完了。レジの会計で「stera で決済」を押すと、金額が端末に出ます。</li>
        </ol>

        {terminals.length === 0 ? (
          <p className="rounded-lg bg-lilac-soft px-3 py-2.5 text-sm text-ink-2">まだ stera 端末がありません。</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {terminals.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold text-navy">
                    {t.online ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-ink-3" />}
                    {t.name}
                    {!t.active && <Badge tone="gray">停止中</Badge>}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {t.terminalNo ? `端末番号 ${t.terminalNo}・` : ''}
                    {t.online ? 'つながっています' : t.lastSeenLabel ? `最後の接続 ${t.lastSeenLabel}` : 'まだ接続がありません'}
                    {t.appVersion ? `・アプリ ${t.appVersion}` : ''}
                  </p>
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-lilac px-2.5 py-1 font-mono text-[15px] font-bold tracking-wider text-royal">
                    <KeyRound className="h-4 w-4" aria-hidden />
                    {formatLinkCode(t.linkCode)}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        run(() => updateSteraTerminal(t.id, storeId, { active: !t.active }), t.active ? '停止しました' : '再開しました')
                      }
                    >
                      {t.active ? '停止' : '再開'}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({ kind: 'regen', id: t.id, name: t.name })}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      コードを作り直す
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm({ kind: 'delete', id: t.id, name: t.name })}>
                      <Trash2 className="h-3.5 w-3.5" />
                      削除
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await addSteraTerminal(storeId, name, terminalNo);
                if (!r.error) {
                  setName('');
                  setTerminalNo('');
                }
                return r;
              }, '追加しました。リンクコードを端末のアプリに入れてください');
            }}
          >
            <div>
              <Label htmlFor="stera-name">端末の名前</Label>
              <Input id="stera-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：レジ横 stera" maxLength={40} />
            </div>
            <div>
              <Label htmlFor="stera-no">端末番号（任意）</Label>
              <Input id="stera-no" value={terminalNo} onChange={(e) => setTerminalNo(e.target.value)} placeholder="端末契約番号など" maxLength={40} />
            </div>
            <Button type="submit" disabled={pending || !name.trim()}>
              <Plus className="h-4 w-4" />
              追加
            </Button>
          </form>
        ) : (
          <p className="text-xs text-ink-3">stera 端末の追加・変更は管理画面（パソコン・店長以上のアカウント）で行ってください。</p>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'delete' ? 'stera 端末を削除' : 'リンクコードを作り直す'}
        message={
          confirm?.kind === 'delete'
            ? `「${confirm?.name}」を削除します。この端末はつながらなくなります（これまでの決済の記録は残ります）。`
            : `「${confirm?.name}」のリンクコードを作り直します。端末のアプリに新しいコードを入れ直すまで、つながりません。`
        }
        confirmLabel={confirm?.kind === 'delete' ? '削除する' : '作り直す'}
        onConfirm={async () => {
          if (!confirm) return;
          const r =
            confirm.kind === 'delete'
              ? await deleteSteraTerminal(confirm.id, storeId)
              : await regenerateSteraLinkCode(confirm.id, storeId);
          if (r.error) toast(r.error, 'error');
          else toast(confirm.kind === 'delete' ? '削除しました' : '作り直しました。新しいコードを端末に入れてください');
        }}
      />
    </Card>
  );
}
