'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { triageDocument } from '@/app/app/invoices/actions';
import { TRIAGE_DOC_TYPE_OPTIONS, DOC_TYPE_LABELS, type DocType } from './labels';
import type { InboxDoc } from './inbox-list';

interface Option {
  id: string;
  name: string;
}

export function TriageDialog({
  doc,
  stores,
  vendors,
  currentStoreId,
  onClose,
  onDone,
}: {
  doc: InboxDoc | null;
  stores: Option[];
  vendors: Option[];
  currentStoreId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [docType, setDocType] = useState<DocType>('invoice');
  const [storeId, setStoreId] = useState(currentStoreId ?? '');
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  if (!doc) return null;

  const handleSubmit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    try {
      await triageDocument({
        documentId: doc.id,
        docType,
        storeId: storeId || null,
        vendorId: vendorId || null,
        vendorName: vendorId ? vendors.find((v) => v.id === vendorId)?.name ?? null : vendorName.trim() || null,
        docDate: (formData.get('docDate') as string) || null,
        amount: formData.get('amount') ? Math.round(Number(formData.get('amount'))) : null,
        taxAmount: formData.get('taxAmount') ? Math.round(Number(formData.get('taxAmount'))) : null,
        memo: (formData.get('memo') as string) || null,
      });
      toast('仕分けしました');
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '仕分けに失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!doc} onClose={onClose} title={`仕分け：${doc.fileName}`}>
      <form
        action={(fd) => {
          void handleSubmit(fd);
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="triage-docType">種別</Label>
          <Select id="triage-docType" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {TRIAGE_DOC_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="triage-store">店舗</Label>
          <Select id="triage-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">全店舗（本社共通）</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>取引先</Label>
          <div className="grid grid-cols-2 gap-2">
            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">（登録済みから選択しない）</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
            <Input
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="自由入力（任意）"
              disabled={!!vendorId}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="triage-date">日付</Label>
            <Input id="triage-date" name="docDate" type="date" />
          </div>
          <div>
            <Label htmlFor="triage-amount">金額（円）</Label>
            <Input id="triage-amount" name="amount" type="number" min={0} step={1} />
          </div>
          <div>
            <Label htmlFor="triage-tax">税額（円）</Label>
            <Input id="triage-tax" name="taxAmount" type="number" min={0} step={1} />
          </div>
        </div>
        <div>
          <Label htmlFor="triage-memo">メモ</Label>
          <Input id="triage-memo" name="memo" />
        </div>
        <FieldError message={error ?? undefined} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? '保存中…' : 'この内容で仕分ける'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
