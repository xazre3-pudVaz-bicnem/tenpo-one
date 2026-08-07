'use client';

import { useState } from 'react';
import { ScanText } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { triageDocument, runDocumentOcr } from '@/app/app/invoices/actions';
import { OCR_NOT_CONNECTED_NOTE } from './extraction';
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
  const [docDate, setDocDate] = useState('');
  const [amount, setAmount] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  if (!doc) return null;

  const handleOcr = async () => {
    setOcrBusy(true);
    setError(null);
    try {
      const extraction = await runDocumentOcr(doc.id);
      if (extraction.issuedDate) setDocDate(extraction.issuedDate);
      if (extraction.total != null) setAmount(String(extraction.total));
      if (extraction.tax != null) setTaxAmount(String(extraction.tax));
      if (extraction.vendor) setVendorName(extraction.vendor);
      setOcrNote(OCR_NOT_CONNECTED_NOTE);
      toast('OCR（モック）を実行しました');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'OCRの実行に失敗しました', 'error');
    } finally {
      setOcrBusy(false);
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await triageDocument({
        documentId: doc.id,
        docType,
        storeId: storeId || null,
        vendorId: vendorId || null,
        vendorName: vendorId ? vendors.find((v) => v.id === vendorId)?.name ?? null : vendorName.trim() || null,
        docDate: docDate || null,
        amount: amount ? Math.round(Number(amount)) : null,
        taxAmount: taxAmount ? Math.round(Number(taxAmount)) : null,
        memo: memo || null,
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
        action={() => {
          void handleSubmit();
        }}
        className="space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleOcr()} disabled={ocrBusy}>
            <ScanText className="h-4 w-4" />
            {ocrBusy ? '読み取り中…' : 'OCRで読み取り（未接続）'}
          </Button>
        </div>
        {ocrNote && <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{ocrNote}</p>}
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
            <Input id="triage-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="triage-amount">金額（円）</Label>
            <Input
              id="triage-amount"
              type="number"
              min={0}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="triage-tax">税額（円）</Label>
            <Input
              id="triage-tax"
              type="number"
              min={0}
              step={1}
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="triage-memo">メモ</Label>
          <Input id="triage-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
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
