'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, KeyRound, Ban, RotateCcw, Copy, Loader2, Store } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { issueStoreOwner, resetUserPassword, setMembershipStatus, setMemberRole, setMemberStores } from '@/app/admin/tenants/actions';
import { ROLES, ROLE_LABELS, HQ_ROLES, type Role } from '@/lib/permissions';

interface Member {
  membershipId: string;
  profileId: string;
  displayName: string;
  role: string;
  status: string;
  email: string | null;
  lastSignInAt: string | null;
  storeIds: string[];
  storeNames: string[];
}

interface StoreOption { id: string; name: string }

export function TenantAccounts({ storeId, members, orgStores }: { storeId: string; members: Member[]; orgStores: StoreOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [issueOpen, setIssueOpen] = useState(false);
  const [form, setForm] = useState({ email: '', displayName: '', role: 'org_owner' as string, password: '' });
  const [error, setError] = useState<string | null>(null);
  const [oneTime, setOneTime] = useState<{ label: string; email?: string; password: string } | null>(null);
  const [assignFor, setAssignFor] = useState<Member | null>(null);
  const [assignIds, setAssignIds] = useState<string[]>([]);

  const run = (fn: () => Promise<unknown>, ok: string) =>
    startTransition(async () => {
      try { await fn(); toast(ok); router.refresh(); }
      catch (e) { toast(e instanceof Error ? e.message : '操作に失敗しました', 'error'); }
    });

  const issue = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await issueStoreOwner({ storeId, email: form.email, displayName: form.displayName, role: form.role, password: form.password || undefined });
        setOneTime({ label: 'アカウントを発行しました', email: res.email, password: res.password });
        setIssueOpen(false);
        setForm({ email: '', displayName: '', role: 'org_owner', password: '' });
        router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : '発行に失敗しました'); }
    });
  };

  const reset = (profileId: string) =>
    startTransition(async () => {
      try {
        const res = await resetUserPassword({ storeId, profileId });
        setOneTime({ label: 'パスワードを再発行しました', password: res.password });
      } catch (e) { toast(e instanceof Error ? e.message : '再発行に失敗しました', 'error'); }
    });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>アカウント</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => { setError(null); setIssueOpen(true); }}>
          <UserPlus className="h-4 w-4" />アカウント発行
        </Button>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-amber-600">Ownerアカウント未設定。「アカウント発行」からOwnerを作成してください。</p>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <Tr><Th>氏名</Th><Th>メール</Th><Th>ロール</Th><Th>所属店舗</Th><Th>状態</Th><Th>最終ログイン</Th><Th className="text-right">操作</Th></Tr>
              </THead>
              <TBody>
                {members.map((m) => (
                  <Tr key={m.membershipId}>
                    <Td className="font-medium text-navy">{m.displayName}</Td>
                    <Td className="text-gray-600">{m.email ?? '—'}</Td>
                    <Td>
                      <Select
                        value={m.role}
                        disabled={pending}
                        onChange={(e) => run(() => setMemberRole({ storeId, membershipId: m.membershipId, role: e.target.value }), 'ロールを変更しました')}
                        className="h-8 text-xs"
                      >
                        {ROLES.map((r) => (<option key={r} value={r}>{ROLE_LABELS[r]}</option>))}
                      </Select>
                    </Td>
                    <Td>
                      {HQ_ROLES.includes(m.role as Role) ? (
                        <span className="text-xs text-gray-500">全店舗</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-navy">{m.storeNames.length > 0 ? m.storeNames.join('、') : '未割当'}</span>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => { setAssignFor(m); setAssignIds(m.storeIds); }}
                            title="所属店舗を割当"
                            className="rounded p-0.5 text-gray-400 hover:text-primary disabled:opacity-50"
                          >
                            <Store className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={m.status === 'active' ? 'success' : m.status === 'invited' ? 'primary' : 'danger'}>
                        {m.status === 'active' ? '有効' : m.status === 'invited' ? '招待中' : '停止'}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-gray-500">{m.lastSignInAt ? new Date(m.lastSignInAt).toLocaleString('ja-JP') : '未ログイン'}</Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" disabled={pending} onClick={() => reset(m.profileId)} title="パスワード再発行" className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                          <KeyRound className="h-4 w-4" />
                        </button>
                        {m.status === 'suspended' ? (
                          <button type="button" disabled={pending} onClick={() => run(() => setMembershipStatus({ storeId, membershipId: m.membershipId, status: 'active' }), '再開しました')} title="再開" className="rounded p-1 text-emerald-600 hover:bg-gray-100 disabled:opacity-50">
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        ) : (
                          <button type="button" disabled={pending} onClick={() => run(() => setMembershipStatus({ storeId, membershipId: m.membershipId, status: 'suspended' }), '停止しました')} title="停止" className="rounded p-1 text-danger hover:bg-gray-100 disabled:opacity-50">
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </CardContent>

      {/* 発行ダイアログ */}
      <Dialog open={issueOpen} onClose={() => setIssueOpen(false)} title="アカウント発行">
        <div className="space-y-3">
          <div><Label htmlFor="ta-email">メールアドレス</Label><Input id="ta-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
          <div><Label htmlFor="ta-name">氏名</Label><Input id="ta-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} /></div>
          <div>
            <Label htmlFor="ta-role">ロール</Label>
            <Select id="ta-role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {ROLES.map((r) => (<option key={r} value={r}>{ROLE_LABELS[r]}</option>))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ta-pw">パスワード（任意・8文字以上）</Label>
            <Input id="ta-pw" type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="空欄の場合は自動生成" />
            <p className="mt-1 text-xs text-gray-500">IDはメール、パスワードはここで指定できます（空欄なら強力なパスワードを自動生成）。発行後にこの画面で一度だけ表示します。</p>
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIssueOpen(false)} disabled={pending}>キャンセル</Button>
            <Button onClick={issue} disabled={pending || !form.email.trim()}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}発行する</Button>
          </div>
        </div>
      </Dialog>

      {/* 一度だけ表示するパスワード */}
      <Dialog open={!!oneTime} onClose={() => setOneTime(null)} title="初期パスワード">
        {oneTime && (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-navy">{oneTime.label}</p>
            {oneTime.email && <p>メール：<span className="font-mono">{oneTime.email}</span></p>}
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <code className="font-mono text-amber-900">{oneTime.password}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(oneTime.password)} className="inline-flex items-center gap-1 text-xs text-amber-700 hover:underline">
                <Copy className="h-3.5 w-3.5" />コピー
              </button>
            </div>
            <p className="text-xs text-gray-500">この画面でしか表示されません。安全な方法で共有し、初回ログイン後の変更を案内してください。</p>
            <div className="flex justify-end"><Button onClick={() => setOneTime(null)}>閉じる</Button></div>
          </div>
        )}
      </Dialog>

      {/* 所属店舗の割当 */}
      <Dialog open={!!assignFor} onClose={() => setAssignFor(null)} title="所属店舗の割当">
        {assignFor && (
          <div className="space-y-3">
            <p className="text-sm text-navy">{assignFor.displayName}（{ROLE_LABELS[assignFor.role as Role] ?? assignFor.role}）の所属店舗</p>
            <div className="flex flex-wrap gap-1.5">
              {orgStores.map((s) => {
                const on = assignIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setAssignIds((ids) => (on ? ids.filter((x) => x !== s.id) : [...ids, s.id]))}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${on ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-navy'}`}
                  >
                    {s.name}
                  </button>
                );
              })}
              {orgStores.length === 0 && <p className="text-xs text-gray-500">この会社に店舗がありません。</p>}
            </div>
            <p className="text-xs text-gray-500">店舗スコープのロール（店長等）向け。本社系ロールは全店舗にアクセスできます。</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAssignFor(null)} disabled={pending}>キャンセル</Button>
              <Button
                onClick={() => {
                  const target = assignFor;
                  if (!target) return;
                  run(() => setMemberStores({ storeId, membershipId: target.membershipId, storeIds: assignIds }), '所属店舗を更新しました');
                  setAssignFor(null);
                }}
                disabled={pending}
              >
                保存
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
