'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { addHardware, updateHardware, removeHardware } from '@/app/admin/tenants/actions';
import {
  HARDWARE_CATEGORIES, HARDWARE_CATEGORY_LABELS, HARDWARE_STATUSES, HARDWARE_STATUS_LABELS,
  PAYMENT_PROVIDERS, type HardwareCategory, type HardwareStatus,
} from '@/lib/tenant-onboarding';

interface HardwareItem {
  id: string; category: string; provider: string | null; model: string | null;
  connection: string | null; ipAddress: string | null; status: string; note: string | null;
}

export function TenantHardware({ storeId, hardware }: { storeId: string; hardware: HardwareItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    category: 'payment_terminal' as HardwareCategory, provider: '', model: '',
    connection: '', ipAddress: '', status: 'planned' as HardwareStatus, note: '',
  });
  const setF = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const run = (fn: () => Promise<unknown>, ok: string) =>
    startTransition(async () => {
      try { await fn(); toast(ok); router.refresh(); }
      catch (e) { toast(e instanceof Error ? e.message : '操作に失敗しました', 'error'); }
    });

  const submit = () =>
    startTransition(async () => {
      try {
        await addHardware({ storeId, ...form });
        toast('機器を登録しました');
        setForm({ category: 'payment_terminal', provider: '', model: '', connection: '', ipAddress: '', status: 'planned', note: '' });
        setAdding(false);
        router.refresh();
      } catch (e) { toast(e instanceof Error ? e.message : '登録に失敗しました', 'error'); }
    });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>ハードウェア</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}><Plus className="h-4 w-4" />機器を追加</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <Label htmlFor="hw-cat">種別</Label>
                <Select id="hw-cat" value={form.category} onChange={(e) => setF('category', e.target.value as HardwareCategory)}>
                  {HARDWARE_CATEGORIES.map((c) => (<option key={c} value={c}>{HARDWARE_CATEGORY_LABELS[c]}</option>))}
                </Select>
              </div>
              <div>
                <Label htmlFor="hw-provider">{form.category === 'payment_terminal' ? 'プロバイダ' : 'メーカー'}</Label>
                {form.category === 'payment_terminal' ? (
                  <Select id="hw-provider" value={form.provider} onChange={(e) => setF('provider', e.target.value)}>
                    <option value="">選択</option>
                    {PAYMENT_PROVIDERS.map((p) => (<option key={p} value={p}>{p}</option>))}
                  </Select>
                ) : (
                  <Input id="hw-provider" value={form.provider} onChange={(e) => setF('provider', e.target.value)} />
                )}
              </div>
              <div><Label htmlFor="hw-model">型番</Label><Input id="hw-model" value={form.model} onChange={(e) => setF('model', e.target.value)} /></div>
              <div><Label htmlFor="hw-conn">接続</Label><Input id="hw-conn" value={form.connection} onChange={(e) => setF('connection', e.target.value)} placeholder="LAN/Bluetooth/USB" /></div>
              <div><Label htmlFor="hw-ip">IP（任意）</Label><Input id="hw-ip" value={form.ipAddress} onChange={(e) => setF('ipAddress', e.target.value)} /></div>
              <div>
                <Label htmlFor="hw-status">状態</Label>
                <Select id="hw-status" value={form.status} onChange={(e) => setF('status', e.target.value as HardwareStatus)}>
                  {HARDWARE_STATUSES.map((s) => (<option key={s} value={s}>{HARDWARE_STATUS_LABELS[s]}</option>))}
                </Select>
              </div>
            </div>
            <div className="mt-2"><Label htmlFor="hw-note">メモ（任意・秘密情報は書かない）</Label><Input id="hw-note" value={form.note} onChange={(e) => setF('note', e.target.value)} /></div>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)} disabled={pending}>キャンセル</Button>
              <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}登録</Button>
            </div>
          </div>
        )}

        {hardware.length === 0 ? (
          <p className="text-sm text-gray-500">機器は未登録です。決済端末・プリンター・ドロア・KDS等を追加できます（未登録の項目はチェックリストで「未設定」表示になります）。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {hardware.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-navy">
                    {HARDWARE_CATEGORY_LABELS[h.category as HardwareCategory] ?? h.category}
                    {h.provider && `／${h.provider}`}{h.model && ` ${h.model}`}
                  </p>
                  <p className="text-xs text-gray-500">
                    {[h.connection, h.ipAddress, h.note].filter(Boolean).join('・') || '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={h.status}
                    onChange={(e) => run(() => updateHardware({ storeId, hardwareId: h.id, status: e.target.value as HardwareStatus }), '状態を更新しました')}
                    className="h-8 w-24 text-xs"
                  >
                    {HARDWARE_STATUSES.map((s) => (<option key={s} value={s}>{HARDWARE_STATUS_LABELS[s]}</option>))}
                  </Select>
                  <button type="button" disabled={pending} onClick={() => run(() => removeHardware({ storeId, hardwareId: h.id }), '削除しました')} title="削除" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-danger disabled:opacity-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-400">※ 端末のパスワード・APIキー・認証情報は保存しません（型番・接続・状態のみ）。</p>
      </CardContent>
    </Card>
  );
}
