import { describe, expect, it } from 'vitest';
import {
  INVOICE_ACTION_PERMISSION,
  documentRowView,
  inboxDocView,
  invoiceActionsFor,
  invoiceDetailView,
  invoiceRowView,
  invoiceUploadPath,
  invoiceYmRange,
  isInvoiceOverdue,
  parseCreateInvoice,
  parseFileRef,
  parseInvoiceStatus,
  parseInvoicesView,
  parseTriage,
  parseUpdateInvoice,
  parseUploadRequest,
} from '@/lib/native-invoices';
import { RECON_STATUS_LABEL, dateOfKey, overallReconStatus, reconciliationScope, salesReconStatus, signedDiff } from '@/lib/reconciliation';

const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '66666666-7777-4888-9999-000000000000';
const ORG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('請求書の年月（発行日）', () => {
  it('その月の 1 日〜翌月 1 日（Web の ymRange と同じ）', () => {
    expect(invoiceYmRange('2026-10')).toEqual({ start: '2026-10-01', end: '2026-11-01' });
    expect(invoiceYmRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });
});

describe('GET の道', () => {
  it('タブと絞り込み（正しい値だけ。空は「すべて」）', () => {
    const v = parseInvoicesView(new URLSearchParams(`tab=invoices&status=paid&vendor=${ID}&ym=2026-10&overdue=1&expense=bad`));
    expect(v).toEqual({ view: 'list', tab: 'invoices', search: { status: 'paid', vendor: ID, ym: '2026-10', overdue: '1' } });
    expect(parseInvoicesView(new URLSearchParams('status=nope'))).toEqual({ view: 'list', tab: 'invoices', search: {} });
  });

  it('書類の店舗は 空＝すべて と 指定なし＝今の店舗 を分ける', () => {
    expect(parseInvoicesView(new URLSearchParams('tab=documents&store='))).toEqual({ view: 'list', tab: 'documents', search: { store: '' } });
    expect(parseInvoicesView(new URLSearchParams('tab=documents&docType=receipt'))).toEqual({ view: 'list', tab: 'documents', search: { docType: 'receipt' } });
    expect(parseInvoicesView(new URLSearchParams('tab=inbox'))).toEqual({ view: 'list', tab: 'inbox', search: {} });
  });

  it('詳細・ファイル', () => {
    expect(parseInvoicesView(new URLSearchParams(`invoice=${ID}`))).toEqual({ view: 'detail', invoiceId: ID });
    expect(parseInvoicesView(new URLSearchParams(`file=${ID}`))).toEqual({ view: 'file', documentId: ID });
    expect(parseInvoicesView(new URLSearchParams('invoice=x'))).toEqual({ error: '内容が正しくありません' });
  });
});

describe('状態の操作（Web の詳細ダイアログと同じボタン）', () => {
  it('書類を扱える人：未処理→確認待ちへ、確認待ち→承認へ回す', () => {
    expect(invoiceActionsFor('open', true, false)).toEqual(['review']);
    expect(invoiceActionsFor('review', true, false)).toEqual(['submit']);
    expect(invoiceActionsFor('pending_approval', true, false)).toEqual([]);
  });

  it('承認できる人：承認・支払予定・支払済み・差戻し', () => {
    expect(invoiceActionsFor('pending_approval', true, true)).toEqual(['approve', 'reject']);
    expect(invoiceActionsFor('approved', true, true)).toEqual(['schedule', 'pay', 'reject']);
    expect(invoiceActionsFor('scheduled', false, true)).toEqual(['pay', 'reject']);
    expect(invoiceActionsFor('paid', true, true)).toEqual([]);
    expect(invoiceActionsFor('rejected', true, true)).toEqual([]);
  });

  it('権限は Server Action の TRANSITIONS と同じ', () => {
    expect(INVOICE_ACTION_PERMISSION.review).toBe('documents.write');
    expect(INVOICE_ACTION_PERMISSION.submit).toBe('documents.write');
    expect(INVOICE_ACTION_PERMISSION.approve).toBe('invoices.approve');
    expect(INVOICE_ACTION_PERMISSION.pay).toBe('invoices.approve');
    expect(INVOICE_ACTION_PERMISSION.reject).toBe('invoices.approve');
  });

  it('差戻しは理由、支払済みは支払日が要る', () => {
    expect(parseInvoiceStatus({ invoiceId: ID, action: 'reject', reason: ' ' })).toEqual({ ok: false, error: '差戻し理由を入力してください' });
    expect(parseInvoiceStatus({ invoiceId: ID, action: 'pay' })).toEqual({ ok: false, error: '支払日を入力してください' });
    expect(parseInvoiceStatus({ invoiceId: ID, action: 'pay', paidAt: '2026-10-24' })).toEqual({ ok: true, value: { invoiceId: ID, action: 'pay', paidAt: '2026-10-24' } });
    expect(parseInvoiceStatus({ invoiceId: ID, action: 'reject', reason: ' 金額違い ' })).toEqual({ ok: true, value: { invoiceId: ID, action: 'reject', reason: '金額違い' } });
    expect(parseInvoiceStatus({ invoiceId: ID, action: 'approve' })).toEqual({ ok: true, value: { invoiceId: ID, action: 'approve' } });
    expect(parseInvoiceStatus({ invoiceId: ID, action: 'delete' }).ok).toBe(false);
  });
});

describe('一覧の行', () => {
  it('期限超過は未払だけ', () => {
    expect(isInvoiceOverdue('2026-10-01', 'scheduled', '2026-10-24')).toBe(true);
    expect(isInvoiceOverdue('2026-10-01', 'paid', '2026-10-24')).toBe(false);
    expect(isInvoiceOverdue(null, 'open', '2026-10-24')).toBe(false);
    expect(isInvoiceOverdue('2026-10-24', 'open', '2026-10-24')).toBe(false);
  });

  it('請求書の行（店舗なし＝全店舗・仕訳の道）', () => {
    const r = invoiceRowView(
      { id: ID, status: 'open', vendorName: '八百屋', dueDate: '2026-10-01', amount: 1200, storeName: null, expenseAccountName: null, journaled: true },
      '2026-10-24'
    );
    expect(r).toMatchObject({ statusLabel: '未処理', overdue: true, storeLabel: '全店舗', expenseLabel: '—', amount: 1200 });
    expect(r.journalHref).toBe(`/app/accounting?source_type=purchase&source_id=${ID}`);
    expect(invoiceRowView({ id: ID, status: 'paid', vendorName: 'x', dueDate: null, amount: 0, storeName: 'A店', expenseAccountName: '仕入', journaled: false }, '2026-10-24').journalHref).toBeNull();
  });

  it('保存ボックス・書類の行', () => {
    expect(inboxDocView({ id: ID, fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 20480, createdAt: '2026-10-24T01:00:00Z' }).sub).toMatch(/・20KB$/);
    expect(documentRowView({ id: ID, docType: 'receipt', fileName: 'r.jpg', docDate: null, amount: null, vendorName: null, storeName: null, ocrStatus: 'done' })).toMatchObject({
      docTypeLabel: '領収書',
      dateLabel: '—',
      vendorLabel: '—',
      storeLabel: '全店舗',
      amount: null,
      ocrLabel: '読取済（モック）',
    });
  });
});

describe('詳細', () => {
  const invoice = {
    id: ID,
    status: 'pending_approval',
    vendor_name: '酒屋',
    invoice_no: 'INV-1',
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    amount: 55000,
    tax_amount: 5000,
    registration_number: null,
    payment_method: 'bank_transfer',
    expense_account_id: ID2,
    paid_at: null,
    note: null,
    document_id: ID2,
    stores: { name: '新宿店' },
    expense_accounts: { id: ID2, name: '仕入' },
    documents: { id: ID2, file_name: 'inv.pdf', mime_type: 'application/pdf', doc_type: 'invoice', ocr_status: 'none' },
  };

  it('Web と同じ項目・必要な承認ロール・ボタン', () => {
    const d = invoiceDetailView(invoice, [{ id: 'c1', body: 'OK', createdAt: '2026-10-24T01:00:00Z', author: '山田' }], '本社管理者', true, true);
    expect(d).toMatchObject({
      statusLabel: '承認待ち',
      vendorName: '酒屋',
      storeLabel: '新宿店',
      paymentMethodLabel: '銀行振込',
      expenseLabel: '仕入',
      requiredApprovalRoleLabel: '本社管理者',
      canEdit: true,
      canComment: true,
      noPermission: false,
    });
    expect(d.attachment).toEqual({ documentId: ID2, fileName: 'inv.pdf', mimeType: 'application/pdf', ocrStatus: 'none', ocrLabel: '未実行' });
    expect(d.actions.map((a) => a.action)).toEqual(['approve', 'reject']);
    expect(d.comments[0]).toMatchObject({ body: 'OK', author: '山田' });
  });

  it('支払済みは編集できない・権限が無ければその旨', () => {
    const d = invoiceDetailView({ ...invoice, status: 'paid', documents: null, stores: null, expense_accounts: null }, [], '本社管理者', false, false);
    expect(d).toMatchObject({ canEdit: false, attachment: null, storeLabel: '全店舗', expenseLabel: '未設定', requiredApprovalRoleLabel: null, noPermission: true, actions: [] });
  });
});

describe('POST の中身', () => {
  const base = { vendorName: ' 八百屋 ', invoiceNo: '', issueDate: '2026-10-01', dueDate: null, amount: 1200.4, taxAmount: 0, registrationNumber: 'T1', paymentMethod: 'cash', expenseAccountId: '', note: null };

  it('請求書の登録（空は null・金額は整数）', () => {
    const p = parseCreateInvoice({ ...base, storeId: null, vendorId: ID, file: null });
    expect(p).toEqual({
      ok: true,
      value: { vendorName: '八百屋', invoiceNo: null, issueDate: '2026-10-01', dueDate: null, amount: 1200, taxAmount: 0, registrationNumber: 'T1', paymentMethod: 'cash', expenseAccountId: null, note: null, storeId: null, vendorId: ID, file: null },
    });
    expect(parseCreateInvoice({ ...base, amount: -1 })).toEqual({ ok: false, error: '金額を正しく入力してください' });
    expect(parseCreateInvoice({ ...base, paymentMethod: 'bitcoin' }).ok).toBe(false);
    expect(parseCreateInvoice({ ...base, issueDate: '2026/10/01' }).ok).toBe(false);
    expect(parseCreateInvoice({ ...base, file: { filePath: 'x' } })).toEqual({ ok: false, error: '添付ファイルが正しくありません' });
  });

  it('添付の参照', () => {
    expect(parseFileRef({ filePath: `${ORG}/hq/2026/10/a.pdf`, fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 })).toEqual({
      filePath: `${ORG}/hq/2026/10/a.pdf`,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    });
    expect(parseFileRef({ filePath: '', fileName: 'a', mimeType: 'x', sizeBytes: 1 })).toBeNull();
  });

  it('請求書の編集', () => {
    expect(parseUpdateInvoice({ ...base, invoiceId: ID })).toMatchObject({ ok: true, value: { invoiceId: ID, fields: { vendorName: '八百屋', amount: 1200 } } });
    expect(parseUpdateInvoice({ ...base, invoiceId: 'x' }).ok).toBe(false);
  });

  it('仕分け（空の金額は null）', () => {
    expect(parseTriage({ documentId: ID, docType: 'invoice', storeId: '', vendorId: null, vendorName: ' 酒屋 ', docDate: '', amount: '', taxAmount: 100, memo: '' })).toEqual({
      ok: true,
      value: { documentId: ID, docType: 'invoice', storeId: null, vendorId: null, vendorName: '酒屋', docDate: null, amount: null, taxAmount: 100, memo: null },
    });
    expect(parseTriage({ documentId: ID, docType: 'register_receipt' })).toEqual({ ok: false, error: '種別を選んでください' });
  });

  it('アップロード（本文は 3MB まで・ファイル名の / は _ に）', () => {
    expect(parseUploadRequest({ fileName: 'a/b.pdf', mimeType: 'application/pdf', sizeBytes: 10, storeId: null, dataBase64: 'QUJD' })).toEqual({
      ok: true,
      value: { fileName: 'a_b.pdf', mimeType: 'application/pdf', sizeBytes: 10, storeId: null, dataBase64: 'QUJD' },
    });
    expect(parseUploadRequest({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, storeId: null })).toMatchObject({ ok: true, value: { dataBase64: null } });
    expect(parseUploadRequest({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, dataBase64: 'A'.repeat(4_100_000) }).ok).toBe(false);
    expect(parseUploadRequest({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, dataBase64: 'not base64!' }).ok).toBe(false);
    expect(parseUploadRequest({ fileName: '', mimeType: 'application/pdf', sizeBytes: 10 }).ok).toBe(false);
  });

  it('保存先のパス（組織/店舗|hq/年/月/uuid.拡張子。年月は日本時間）', () => {
    const now = new Date('2026-10-31T16:00:00Z'); // 日本時間 11/1 01:00
    expect(invoiceUploadPath(ORG, null, { fileName: 'scan.PDF', mimeType: 'application/pdf' }, 'u1', now)).toBe(`${ORG}/hq/2026/11/u1.pdf`);
    expect(invoiceUploadPath(ORG, ID, { fileName: 'photo.jpg', mimeType: 'image/jpeg' }, 'u2', now)).toBe(`${ORG}/${ID}/2026/11/u2.jpg`);
  });
});

describe('照合（売上・現金・在庫）', () => {
  const ctxHq = { isHq: true, currentStore: { id: ID }, stores: [{ id: ID, name: 'A店' }, { id: ID2, name: 'B店' }] };
  const ctxStore = { isHq: false, currentStore: { id: ID }, stores: [{ id: ID, name: 'A店' }] };

  it('期間・店舗（既定は直近7日、本部は全社、開始＞終了は入れ替え）', () => {
    expect(reconciliationScope(ctxHq, {}, '2026-10-24', '2026-10-18')).toEqual({ from: '2026-10-18', to: '2026-10-24', storeId: '', storeName: null, storeIds: [ID, ID2] });
    expect(reconciliationScope(ctxStore, { from: '2026-10-20', to: '2026-10-10' }, '2026-10-24', '2026-10-18')).toEqual({
      from: '2026-10-10',
      to: '2026-10-20',
      storeId: ID,
      storeName: 'A店',
      storeIds: [ID],
    });
    expect(reconciliationScope(ctxHq, { store: ID2 }, '2026-10-24', '2026-10-18')).toMatchObject({ storeId: ID2, storeName: 'B店', storeIds: [ID2] });
  });

  it('判定と表示', () => {
    expect(dateOfKey(`${ID}:2026-10-24`)).toBe('2026-10-24');
    expect(salesReconStatus(false, 0, 0)).toBe('no_data');
    expect(salesReconStatus(true, 0, 0)).toBe('ok');
    expect(salesReconStatus(true, 0, -10)).toBe('mismatch');
    expect(overallReconStatus(['ok', 'ok', 'ok'])).toBe('ok');
    expect(overallReconStatus(['ok', 'no_data', 'ok'])).toBe('no_data');
    expect(overallReconStatus(['no_data', 'mismatch', 'ok'])).toBe('mismatch');
    expect(RECON_STATUS_LABEL.mismatch).toBe('不一致');
    const yen = (n: number) => `¥${n}`;
    expect(signedDiff(0, yen)).toBe('±0');
    expect(signedDiff(100, yen)).toBe('+¥100');
    expect(signedDiff(-5, yen)).toBe('¥-5');
  });
});
