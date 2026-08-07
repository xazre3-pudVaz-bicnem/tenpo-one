'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate, formatDateTime, todayJst } from '@/lib/format';
import {
  addDocumentComment,
  changeInvoiceStatus,
  getDocumentSignedUrl,
  getInvoiceDetail,
  updateInvoice,
} from '@/app/app/invoices/actions';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  type InvoiceStatus,
  type PaymentMethod,
} from './labels';

interface ExpenseAccountOption {
  id: string;
  name: string;
}

interface InvoiceDetail {
  id: string;
  status: InvoiceStatus;
  vendor_name: string;
  invoice_no: string | null;
  issue_date: string | null;
  due_date: string | null;
  amount: number;
  tax_amount: number;
  registration_number: string | null;
  payment_method: string | null;
  expense_account_id: string | null;
  paid_at: string | null;
  note: string | null;
  document_id: string | null;
  store_id: string | null;
  stores: { name: string } | null;
  expense_accounts: { id: string; name: string } | null;
  documents: { id: string; file_name: string; mime_type: string; doc_type: string } | null;
}

const today = () => todayJst();

export function InvoiceDetailDialog({
  invoiceId,
  onClose,
  accounts,
  canWrite,
  canApprove,
}: {
  invoiceId: string | null;
  onClose: () => void;
  accounts: ExpenseAccountOption[];
  canWrite: boolean;
  canApprove: boolean;
}) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [comments, setComments] = useState<{ id: string; body: string; createdAt: string; author: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ url: string; mimeType: string } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [paidAt, setPaidAt] = useState(today());
  const [showPay, setShowPay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editVendorName, setEditVendorName] = useState('');
  const [editInvoiceNo, setEditInvoiceNo] = useState('');
  const [editIssueDate, setEditIssueDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editAmount, setEditAmount] = useState('0');
  const [editTaxAmount, setEditTaxAmount] = useState('0');
  const [editRegistrationNumber, setEditRegistrationNumber] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState('');
  const [editExpenseAccountId, setEditExpenseAccountId] = useState('');
  const [editNote, setEditNote] = useState('');

  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!invoiceId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await getInvoiceDetail(invoiceId);
        const inv = res.invoice as unknown as InvoiceDetail;
        setDetail(inv);
        setComments(res.comments);
        if (inv.documents) {
          try {
            const signed = await getDocumentSignedUrl(inv.documents.id);
            setPreview({ url: signed.url, mimeType: signed.mimeType });
          } catch {
            setPreview(null);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    })();
  }, [invoiceId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      if (invoiceId) {
        const res = await getInvoiceDetail(invoiceId);
        setDetail(res.invoice as unknown as InvoiceDetail);
        setComments(res.comments);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const handleAddComment = () =>
    run(async () => {
      if (!detail?.document_id || !commentBody.trim()) return;
      await addDocumentComment(detail.document_id, commentBody.trim());
      setCommentBody('');
      toast('コメントを追加しました');
    });

  const handleReview = () =>
    run(async () => {
      if (!detail) return;
      await changeInvoiceStatus(detail.id, 'review');
      toast('確認待ちにしました');
    });

  const handleSubmitForApproval = () =>
    run(async () => {
      if (!detail) return;
      await changeInvoiceStatus(detail.id, 'submit');
      toast('承認へ回しました');
    });

  const handleApprove = () =>
    run(async () => {
      if (!detail) return;
      await changeInvoiceStatus(detail.id, 'approve');
      toast('承認しました');
    });

  const handleSchedule = () =>
    run(async () => {
      if (!detail) return;
      await changeInvoiceStatus(detail.id, 'schedule');
      toast('支払予定にしました');
    });

  const handlePay = () =>
    run(async () => {
      if (!detail) return;
      await changeInvoiceStatus(detail.id, 'pay', { paidAt });
      setShowPay(false);
      toast('支払済みにしました');
    });

  const handleReject = () =>
    run(async () => {
      if (!detail || !rejectReason.trim()) return;
      await changeInvoiceStatus(detail.id, 'reject', { reason: rejectReason.trim() });
      setShowReject(false);
      setRejectReason('');
      toast('差戻しました');
    });

  const startEdit = () => {
    if (!detail) return;
    setEditVendorName(detail.vendor_name);
    setEditInvoiceNo(detail.invoice_no ?? '');
    setEditIssueDate(detail.issue_date ?? '');
    setEditDueDate(detail.due_date ?? '');
    setEditAmount(String(detail.amount));
    setEditTaxAmount(String(detail.tax_amount));
    setEditRegistrationNumber(detail.registration_number ?? '');
    setEditPaymentMethod(detail.payment_method ?? '');
    setEditExpenseAccountId(detail.expense_account_id ?? '');
    setEditNote(detail.note ?? '');
    setEditing(true);
  };

  const handleSaveEdit = () =>
    run(async () => {
      if (!detail) return;
      if (!editVendorName.trim()) {
        setError('取引先を入力してください');
        return;
      }
      const amountValue = Number(editAmount);
      const taxValue = Number(editTaxAmount);
      if (!Number.isFinite(amountValue) || amountValue < 0) {
        setError('金額を正しく入力してください');
        return;
      }
      await updateInvoice(detail.id, {
        vendorName: editVendorName.trim(),
        invoiceNo: editInvoiceNo.trim() || null,
        issueDate: editIssueDate || null,
        dueDate: editDueDate || null,
        amount: Math.round(amountValue),
        taxAmount: Math.round(taxValue || 0),
        registrationNumber: editRegistrationNumber.trim() || null,
        paymentMethod: (editPaymentMethod as PaymentMethod) || null,
        expenseAccountId: editExpenseAccountId || null,
        note: editNote.trim() || null,
      });
      setEditing(false);
      toast('請求書を更新しました');
    });

  if (!invoiceId) return null;

  const canEdit = canWrite && !!detail && detail.status !== 'paid';

  return (
    <Dialog open={!!invoiceId} onClose={onClose} title="請求書の詳細" wide>
      {loading || !detail ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : editing ? (
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-vendor">取引先</Label>
            <Input id="edit-vendor" value={editVendorName} onChange={(e) => setEditVendorName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-invoiceNo">請求書番号</Label>
              <Input id="edit-invoiceNo" value={editInvoiceNo} onChange={(e) => setEditInvoiceNo(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-paymentMethod">支払方法</Label>
              <Select id="edit-paymentMethod" value={editPaymentMethod} onChange={(e) => setEditPaymentMethod(e.target.value)}>
                <option value="">未設定</option>
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-issueDate">発行日</Label>
              <Input id="edit-issueDate" type="date" value={editIssueDate} onChange={(e) => setEditIssueDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-dueDate">支払期限</Label>
              <Input id="edit-dueDate" type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-amount">金額（円）</Label>
              <Input id="edit-amount" type="number" min={0} step={1} value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-taxAmount">税額（円）</Label>
              <Input id="edit-taxAmount" type="number" min={0} step={1} value={editTaxAmount} onChange={(e) => setEditTaxAmount(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="edit-registrationNumber">インボイス登録番号</Label>
              <Input id="edit-registrationNumber" value={editRegistrationNumber} onChange={(e) => setEditRegistrationNumber(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="edit-expenseAccount">費目</Label>
              <Select id="edit-expenseAccount" value={editExpenseAccountId} onChange={(e) => setEditExpenseAccountId(e.target.value)}>
                <option value="">未設定</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="edit-note">メモ</Label>
              <Textarea id="edit-note" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </div>
          </div>

          <FieldError message={error ?? undefined} />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
              キャンセル
            </Button>
            <Button type="button" onClick={handleSaveEdit} disabled={busy}>
              {busy ? '保存中…' : '保存する'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone={INVOICE_STATUS_TONES[detail.status]}>{INVOICE_STATUS_LABELS[detail.status]}</Badge>
            <div className="flex items-center gap-3">
              <p className="text-2xl font-bold tabular-nums text-navy">{yen(detail.amount)}</p>
              {canEdit && (
                <Button size="sm" variant="secondary" onClick={startEdit} disabled={busy}>
                  編集する
                </Button>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-gray-500">取引先</dt>
              <dd className="font-medium text-navy">{detail.vendor_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">店舗</dt>
              <dd>{detail.stores?.name ?? '全店舗'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">請求書番号</dt>
              <dd>{detail.invoice_no ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">支払方法</dt>
              <dd>{detail.payment_method ? PAYMENT_METHOD_LABELS[detail.payment_method as keyof typeof PAYMENT_METHOD_LABELS] : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">発行日</dt>
              <dd>{formatDate(detail.issue_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">支払期限</dt>
              <dd>{formatDate(detail.due_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">税額</dt>
              <dd className="tabular-nums">{yen(detail.tax_amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">支払日</dt>
              <dd>{formatDate(detail.paid_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">費目</dt>
              <dd>{detail.expense_accounts?.name ?? '未設定'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">インボイス登録番号</dt>
              <dd>{detail.registration_number ?? '—'}</dd>
            </div>
            {detail.note && (
              <div className="col-span-2">
                <dt className="text-xs text-gray-500">メモ</dt>
                <dd className="whitespace-pre-wrap text-gray-700">{detail.note}</dd>
              </div>
            )}
          </dl>

          <div>
            <p className="mb-2 text-xs font-medium text-gray-500">添付ファイル</p>
            {detail.documents && preview ? (
              preview.mimeType === 'application/pdf' ? (
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {detail.documents.file_name} を新しいタブで開く
                </a>
              ) : (
                <a href={preview.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.url}
                    alt={detail.documents.file_name}
                    className="max-h-64 rounded-lg border border-gray-200 object-contain"
                  />
                </a>
              )
            ) : (
              <p className="text-sm text-gray-400">添付なし</p>
            )}
          </div>

          {detail.document_id && (
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500">コメント</p>
              <div className="space-y-2">
                {comments.length === 0 && <p className="text-sm text-gray-400">コメントはまだありません</p>}
                {comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap text-gray-800">{c.body}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {c.author}・{formatDateTime(c.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="コメントを入力"
                  rows={2}
                />
              </div>
              <div className="mt-1 flex justify-end">
                <Button size="sm" variant="secondary" onClick={handleAddComment} disabled={busy || !commentBody.trim()}>
                  コメントを追加
                </Button>
              </div>
            </div>
          )}

          <FieldError message={error ?? undefined} />

          <div className="border-t border-gray-100 pt-4">
            <p className="mb-2 text-xs font-medium text-gray-500">状態を変更</p>
            <div className="flex flex-wrap gap-2">
              {detail.status === 'open' && canWrite && (
                <Button size="sm" onClick={handleReview} disabled={busy}>
                  確認待ちへ
                </Button>
              )}
              {detail.status === 'review' && canWrite && (
                <Button size="sm" onClick={handleSubmitForApproval} disabled={busy}>
                  承認へ回す
                </Button>
              )}
              {detail.status === 'pending_approval' && canApprove && (
                <Button size="sm" variant="success" onClick={handleApprove} disabled={busy}>
                  承認する
                </Button>
              )}
              {detail.status === 'approved' && canApprove && (
                <Button size="sm" onClick={handleSchedule} disabled={busy}>
                  支払予定にする
                </Button>
              )}
              {(detail.status === 'scheduled' || detail.status === 'approved') && canApprove && !showPay && (
                <Button size="sm" variant="success" onClick={() => setShowPay(true)} disabled={busy}>
                  支払済みにする
                </Button>
              )}
              {['open', 'review', 'pending_approval', 'approved', 'scheduled'].includes(detail.status) &&
                canApprove &&
                !showReject && (
                  <Button size="sm" variant="danger" onClick={() => setShowReject(true)} disabled={busy}>
                    差戻す
                  </Button>
                )}
              {!canWrite && !canApprove && (
                <p className="text-xs text-gray-400">状態を変更する権限がありません</p>
              )}
            </div>

            {showPay && (
              <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
                <div>
                  <Label htmlFor="paidAt">支払日</Label>
                  <Input id="paidAt" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                </div>
                <Button size="sm" variant="success" onClick={handlePay} disabled={busy || !paidAt}>
                  確定する
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setShowPay(false)} disabled={busy}>
                  キャンセル
                </Button>
              </div>
            )}

            {showReject && (
              <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3">
                <Label htmlFor="rejectReason">差戻し理由（必須）</Label>
                <Textarea
                  id="rejectReason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="差戻す理由を入力してください"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setShowReject(false)} disabled={busy}>
                    キャンセル
                  </Button>
                  <Button size="sm" variant="danger" onClick={handleReject} disabled={busy || !rejectReason.trim()}>
                    差戻す
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
