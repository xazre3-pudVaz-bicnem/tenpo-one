'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, Copy, ArrowRight } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { createTenantStore, type CreateTenantStoreResult } from '@/app/admin/tenants/actions';
import { ENVIRONMENTS, ENVIRONMENT_LABELS } from '@/lib/tenant-onboarding';

interface OrgOption { id: string; name: string }
interface PlanOption { code: string; name: string }

/**
 * 新規店舗追加ウィザード（最小項目で開始）。
 * 新規会社を作る / 既存会社へ店舗を追加 の両対応。Ownerは任意（後から発行も可）。
 */
export function CreateTenantTrigger({ organizations, plans }: { organizations: OrgOption[]; plans: PlanOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'new_org' | 'existing_org'>('new_org');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateTenantStoreResult | null>(null);
  const [form, setForm] = useState({
    organizationId: organizations[0]?.id ?? '',
    companyName: '',
    companyNameKana: '',
    planCode: plans.find((p) => p.code === 'standard')?.code ?? plans[0]?.code ?? 'standard',
    storeName: '',
    slug: '',
    environment: 'production' as (typeof ENVIRONMENTS)[number],
    ownerEmail: '',
    ownerName: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const reset = () => {
    setResult(null);
    setError(null);
    setForm((f) => ({ ...f, companyName: '', companyNameKana: '', storeName: '', slug: '', ownerEmail: '', ownerName: '' }));
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await createTenantStore({
          mode,
          organizationId: mode === 'existing_org' ? form.organizationId : undefined,
          companyName: mode === 'new_org' ? form.companyName : undefined,
          companyNameKana: form.companyNameKana || undefined,
          planCode: form.planCode,
          storeName: form.storeName,
          slug: form.slug || undefined,
          environment: form.environment,
          ownerEmail: form.ownerEmail || undefined,
          ownerName: form.ownerName || undefined,
        });
        setResult(res);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : '作成に失敗しました');
      }
    });
  };

  const canSubmit =
    !!form.storeName.trim() &&
    (mode === 'new_org' ? !!form.companyName.trim() : !!form.organizationId);

  return (
    <>
      <Button size="sm" onClick={() => { reset(); setOpen(true); }}>
        <Plus className="h-4 w-4" />
        新規店舗を追加
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="新規店舗を追加">
        {result ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
              <p className="font-semibold text-emerald-800">店舗を作成しました</p>
              <p className="mt-1 text-emerald-700">公開予約URLのslug：<span className="font-mono">{result.slug}</span></p>
            </div>
            {result.ownerPassword && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                <p className="font-semibold text-amber-800">オーナーの初期パスワード（この画面でしか表示されません）</p>
                <p className="mt-1">メール：<span className="font-mono">{result.ownerEmail}</span></p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="rounded bg-white px-2 py-1 font-mono text-amber-900">{result.ownerPassword}</code>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(result.ownerPassword ?? '')}
                    className="inline-flex items-center gap-1 text-xs text-amber-700 hover:underline"
                  >
                    <Copy className="h-3.5 w-3.5" />コピー
                  </button>
                </div>
                <p className="mt-1 text-xs text-amber-600">安全な方法でオーナーへ共有し、初回ログイン後の変更を案内してください。</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>閉じる</Button>
              <Button onClick={() => router.push(`/admin/tenants/${result.storeId}`)}>
                導入管理を開く <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('new_org')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${mode === 'new_org' ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-navy'}`}
              >
                新規会社
              </button>
              <button
                type="button"
                onClick={() => setMode('existing_org')}
                disabled={organizations.length === 0}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-40 ${mode === 'existing_org' ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-navy'}`}
              >
                既存会社へ追加
              </button>
            </div>

            {mode === 'new_org' ? (
              <>
                <div>
                  <Label htmlFor="ct-company">会社名</Label>
                  <Input id="ct-company" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="株式会社◯◯" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="ct-kana">会社名カナ（任意）</Label>
                    <Input id="ct-kana" value={form.companyNameKana} onChange={(e) => set('companyNameKana', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="ct-plan">プラン</Label>
                    <Select id="ct-plan" value={form.planCode} onChange={(e) => set('planCode', e.target.value)}>
                      {plans.map((p) => (<option key={p.code} value={p.code}>{p.name}</option>))}
                    </Select>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <Label htmlFor="ct-org">会社</Label>
                <Select id="ct-org" value={form.organizationId} onChange={(e) => set('organizationId', e.target.value)}>
                  {organizations.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ct-store">店舗名</Label>
                <Input id="ct-store" value={form.storeName} onChange={(e) => set('storeName', e.target.value)} placeholder="◯◯店" />
              </div>
              <div>
                <Label htmlFor="ct-env">環境</Label>
                <Select id="ct-env" value={form.environment} onChange={(e) => set('environment', e.target.value as (typeof ENVIRONMENTS)[number])}>
                  {ENVIRONMENTS.map((e) => (<option key={e} value={e}>{ENVIRONMENT_LABELS[e]}</option>))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="ct-slug">slug（任意・未指定なら店舗名から生成）</Label>
              <Input id="ct-slug" value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="fogo-de-brasia-shinjuku" className="font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
              <div>
                <Label htmlFor="ct-oemail">オーナー email（任意）</Label>
                <Input id="ct-oemail" type="email" value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ct-oname">オーナー氏名（任意）</Label>
                <Input id="ct-oname" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-gray-500">最小項目で作成し、続けて導入管理画面で詳細設定できます。オーナーは後から発行も可能です。</p>

            <FieldError message={error ?? undefined} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>キャンセル</Button>
              <Button onClick={submit} disabled={pending || !canSubmit}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                作成する
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
