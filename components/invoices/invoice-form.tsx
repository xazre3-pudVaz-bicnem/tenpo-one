'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { createInvoice } from '@/app/app/invoices/actions';
import {
  ACCEPTED_FILE_ACCEPT,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  extFromFile,
  validateAttachedFile,
  type PaymentMethod,
} from './labels';

interface VendorOption {
  id: string;
  name: string;
}

interface StoreOption {
  id: string;
  name: string;
}

interface ExpenseAccountOption {
  id: string;
  name: string;
}

/** 「請求書を登録」ダイアログ。ファイル添付は任意で、Storageへ直接アップロードしてからserver actionを呼ぶ */
export function InvoiceForm({
  organizationId,
  currentStoreId,
  stores,
  vendors,
  accounts,
}: {
  organizationId: string;
  currentStoreId: string | null;
  stores: StoreOption[];
  vendors: VendorOption[];
  accounts: ExpenseAccountOption[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendorMode, setVendorMode] = useState<'select' | 'free'>(vendors.length > 0 ? 'select' : 'free');
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [storeId, setStoreId] = useState(currentStoreId ?? '');
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setError(null);
    const resolvedVendorName =
      vendorMode === 'select' ? vendors.find((v) => v.id === vendorId)?.name ?? '' : vendorName.trim();
    if (!resolvedVendorName) {
      setError('取引先を選択または入力してください');
      return;
    }
    const amount = Number(formData.get('amount') ?? 0);
    const taxAmount = Number(formData.get('taxAmount') ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('金額を正しく入力してください');
      return;
    }

    setBusy(true);
    try {
      const file = fileRef.current?.files?.[0] ?? null;
      let fileRef_: { filePath: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;

      if (file) {
        const validationError = validateAttachedFile(file);
        if (validationError) throw new Error(validationError);
        const now = new Date();
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const ext = extFromFile(file);
        const path = `${organizationId}/${storeId || 'hq'}/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage.from('documents').upload(path, file, {
          contentType: file.type,
        });
        if (uploadError) throw new Error('ファイルのアップロードに失敗しました');
        fileRef_ = { filePath: path, fileName: file.name, mimeType: file.type, sizeBytes: file.size };
      }

      await createInvoice({
        storeId: storeId || null,
        vendorId: vendorMode === 'select' && vendorId ? vendorId : null,
        vendorName: resolvedVendorName,
        invoiceNo: (formData.get('invoiceNo') as string) || null,
        issueDate: (formData.get('issueDate') as string) || null,
        dueDate: (formData.get('dueDate') as string) || null,
        amount: Math.round(amount),
        taxAmount: Math.round(taxAmount),
        registrationNumber: (formData.get('registrationNumber') as string) || null,
        paymentMethod: (formData.get('paymentMethod') as PaymentMethod) || null,
        expenseAccountId: expenseAccountId || null,
        note: null,
        file: fileRef_,
      });

      toast('請求書を登録しました');
      setOpen(false);
      setVendorId('');
      setVendorName('');
      setExpenseAccountId('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        請求書を登録
      </Button>
      <Dialog open={open} onClose={close} title="請求書を登録">
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label>添付ファイル（任意）</Label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_FILE_ACCEPT}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-200"
            />
          </div>

          {stores.length > 0 && (
            <div>
              <Label htmlFor="inv-store">店舗</Label>
              <Select id="inv-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">全店舗（本社共通）</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label>取引先</Label>
            {vendors.length > 0 && (
              <div className="mb-2 flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={vendorMode === 'select'}
                    onChange={() => setVendorMode('select')}
                  />
                  登録済みから選択
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={vendorMode === 'free'} onChange={() => setVendorMode('free')} />
                  自由入力
                </label>
              </div>
            )}
            {vendorMode === 'select' && vendors.length > 0 ? (
              <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">選択してください</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="取引先名を入力" />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="invoiceNo">請求書番号</Label>
              <Input id="invoiceNo" name="invoiceNo" />
            </div>
            <div>
              <Label htmlFor="paymentMethod">支払方法</Label>
              <Select id="paymentMethod" name="paymentMethod" defaultValue="">
                <option value="">未設定</option>
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="issueDate">発行日</Label>
              <Input id="issueDate" name="issueDate" type="date" />
            </div>
            <div>
              <Label htmlFor="dueDate">支払期限</Label>
              <Input id="dueDate" name="dueDate" type="date" />
            </div>
            <div>
              <Label htmlFor="amount">金額（円）</Label>
              <Input id="amount" name="amount" type="number" min={0} step={1} required defaultValue={0} />
            </div>
            <div>
              <Label htmlFor="taxAmount">税額（円）</Label>
              <Input id="taxAmount" name="taxAmount" type="number" min={0} step={1} defaultValue={0} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="registrationNumber">インボイス登録番号</Label>
              <Input id="registrationNumber" name="registrationNumber" placeholder="T1234567890123" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="expenseAccount">費目</Label>
              <Select id="expenseAccount" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
                <option value="">未設定</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <FieldError message={error ?? undefined} />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '登録中…' : '登録する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
