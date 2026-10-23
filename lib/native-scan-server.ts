import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { loadTodayCashRows, receiptStateOf } from '@/app/app/cash/close/data';
import { splitPurpose } from '@/components/cash/cash-history';
import { KIND_LABELS, type CashKind } from '@/components/cash/labels';
import { DOC_TYPE_LABELS, type DocType } from '@/components/invoices/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

const FOLDER_DAYS = 45;
const TYPE_KEYS = ['', 'inbox', 'receipt', 'invoice', 'delivery_note', 'other'];
const dayOf = (v: string) => new Date(v).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

/** スキャン（GET ?part=scan&type&tx）。Web の /app/scan と同じ取得・並び */
export interface NativeScanPayload {
  canUpload: boolean;
  canLink: boolean;
  canClose: boolean;
  today: string;
  filter: string;
  /** ?tx= の出金（見つからなければ txMissing） */
  target: { id: string; main: string; sub: string | null; date: string; occurredAt: string; kindLabel: string; amount: number; hasReceipt: boolean } | null;
  txMissing: boolean;
  needsReceipt: { id: string; occurredAt: string; main: string; sub: string; amount: number; isAdvance: boolean }[];
  needsTotal: number;
  month: { count: number; receipts: number; inbox: number };
  folders: { day: string; docs: { id: string; createdAt: string; fileName: string; title: string | null; docType: string; typeLabel: string; status: string; amount: number | null; linked: boolean }[] }[];
}

export async function loadNativeScan(ctx: SessionContext, supabase: Supabase, today: string, q: { type: string; tx: string | null }): Promise<NativeScanPayload> {
  const store = ctx.currentStore ?? ctx.stores[0] ?? null;
  const filter = TYPE_KEYS.includes(q.type) ? q.type : '';
  const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00+09:00`).toISOString();
  let docsQuery = supabase
    .from('documents')
    .select('id, created_at, file_name, doc_type, status, amount, title')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .gte('created_at', new Date(Date.now() - FOLDER_DAYS * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(400);
  let monthQuery = supabase.from('documents').select('doc_type, status').eq('organization_id', ctx.organizationId).neq('status', 'deleted').gte('created_at', monthStart).limit(2000);
  if (ctx.currentStore) {
    const orStore = `store_id.eq.${ctx.currentStore.id},store_id.is.null`;
    docsQuery = docsQuery.or(orStore);
    monthQuery = monthQuery.or(orStore);
  }
  if (filter === 'inbox') docsQuery = docsQuery.eq('status', 'inbox');
  else if (filter === 'receipt') docsQuery = docsQuery.in('doc_type', ['receipt', 'register_receipt']);
  else if (filter === 'other') docsQuery = docsQuery.not('doc_type', 'in', '(receipt,register_receipt,invoice,delivery_note)');
  else if (filter) docsQuery = docsQuery.eq('doc_type', filter);

  const [{ data: docs }, { data: monthDocs }, cashRows, { data: tx }] = await Promise.all([
    docsQuery,
    monthQuery,
    store ? loadTodayCashRows(store.id, today) : Promise.resolve([]),
    q.tx
      ? supabase
          .from('cash_transactions')
          .select('id, store_id, kind, amount, purpose, occurred_at, business_date, status, receipt_document_id')
          .eq('id', q.tx)
          .eq('organization_id', ctx.organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const target = tx && ctx.stores.some((s) => s.id === tx.store_id) && tx.status === 'active' ? tx : null;

  const ids = (docs ?? []).map((d) => d.id as string);
  const { data: linkedRows } = ids.length
    ? await supabase.from('cash_transactions').select('receipt_document_id').in('receipt_document_id', ids)
    : { data: [] as { receipt_document_id: string | null }[] };
  const linked = new Set((linkedRows ?? []).map((r) => r.receipt_document_id));

  const folders: NativeScanPayload['folders'] = [];
  for (const d of docs ?? []) {
    const day = dayOf(d.created_at as string);
    const row = {
      id: d.id as string,
      createdAt: d.created_at as string,
      fileName: d.file_name as string,
      title: d.title as string | null,
      docType: d.doc_type as string,
      typeLabel: DOC_TYPE_LABELS[d.doc_type as DocType] ?? (d.doc_type as string),
      status: d.status as string,
      amount: d.amount as number | null,
      linked: linked.has(d.id as string),
    };
    const last = folders[folders.length - 1];
    if (last && last.day === day) last.docs.push(row);
    else folders.push({ day, docs: [row] });
  }

  const needs = cashRows.filter((r) => {
    const s = receiptStateOf(r);
    return s === 'scan' || s === 'advance';
  });
  const month = monthDocs ?? [];
  const tp = target ? splitPurpose(target.purpose as string | null, target.kind as CashKind) : null;

  return {
    canUpload: can(ctx.role, 'documents.write'),
    canLink: can(ctx.role, 'cash.write'),
    canClose: can(ctx.role, 'register.operate'),
    today,
    filter,
    target:
      target && tp
        ? {
            id: target.id as string,
            main: tp.main,
            sub: tp.sub,
            date: target.business_date as string,
            occurredAt: target.occurred_at as string,
            kindLabel: KIND_LABELS[target.kind as CashKind],
            amount: target.amount as number,
            hasReceipt: !!target.receipt_document_id,
          }
        : null,
    txMissing: !!q.tx && !target,
    needsReceipt: needs.map((r) => {
      const { main, sub } = splitPurpose(r.purpose, r.kind);
      return { id: r.id, occurredAt: r.occurredAt, main, sub: sub ?? KIND_LABELS[r.kind], amount: r.amount, isAdvance: r.kind === 'petty_advance' };
    }),
    needsTotal: needs.reduce((a, r) => a + r.amount, 0),
    month: {
      count: month.length,
      receipts: month.filter((d) => d.doc_type === 'receipt' || d.doc_type === 'register_receipt').length,
      inbox: month.filter((d) => d.status === 'inbox').length,
    },
    folders,
  };
}
