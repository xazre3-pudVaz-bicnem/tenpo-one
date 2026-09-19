import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FileText, Inbox, Lock, Package, Receipt } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, formatTime, todayJst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { LinkChips } from '@/components/orders/link-chips';
import { ScanCapture } from '@/components/scan/scan-capture';
import { CHIP, splitPurpose } from '@/components/cash/cash-history';
import { KIND_LABELS, type CashKind } from '@/components/cash/labels';
import { DOC_TYPE_LABELS, type DocType } from '@/components/invoices/labels';
import { loadTodayCashRows, receiptStateOf } from '@/app/app/cash/close/data';

export const metadata: Metadata = { title: 'スキャン' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TYPE_CHIPS: { key: string; label: string }[] = [
  { key: '', label: 'すべて' },
  { key: 'inbox', label: '未仕分け' },
  { key: 'receipt', label: '領収書・レシート' },
  { key: 'invoice', label: '請求書' },
  { key: 'delivery_note', label: '納品書' },
  { key: 'other', label: 'その他' },
];

const TAG_CLASS: Partial<Record<DocType, string>> = {
  receipt: 'bg-saffron',
  register_receipt: 'bg-saffron',
  invoice: 'bg-iris',
  delivery_note: 'bg-success',
};

function DocIcon({ type }: { type: string }) {
  const Icon = type === 'delivery_note' ? Package : type === 'invoice' ? FileText : Receipt;
  return <Icon className="h-5 w-5" />;
}

/** 'YYYY-MM-DDTHH..' → '9/16 18:02'（JST） */
function shortDateTime(value: string) {
  return new Date(value).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; tx?: string }>;
}) {
  const ctx = await requireFeature('accounting');
  const sp = await searchParams;

  if (!can(ctx.role, 'documents.write')) {
    return (
      <div>
        <PageHeader title="スキャン" en="Snap & file" />
        <EmptyState title="書類をアップロードする権限がありません" description="店長・経理担当者に依頼してください。" />
      </div>
    );
  }

  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0] ?? null;
  const today = todayJst();
  const canLink = can(ctx.role, 'cash.write');
  const filter = TYPE_CHIPS.some((c) => c.key === sp.type) ? (sp.type ?? '') : '';
  const txId = sp.tx && UUID_RE.test(sp.tx) ? sp.tx : null;
  const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00+09:00`).toISOString();

  let docsQuery = supabase
    .from('documents')
    .select('id, created_at, file_name, doc_type, status, amount, title')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(40);
  let monthQuery = supabase
    .from('documents')
    .select('doc_type, status')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .gte('created_at', monthStart)
    .limit(2000);
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
    txId
      ? supabase
          .from('cash_transactions')
          .select('id, store_id, kind, amount, purpose, occurred_at, business_date, status, receipt_document_id')
          .eq('id', txId)
          .eq('organization_id', ctx.organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const target = tx && ctx.stores.some((s) => s.id === tx.store_id) && tx.status === 'active' ? tx : null;

  // 一覧の書類のうち出金に紐付いているもの
  const docIds = (docs ?? []).map((d) => d.id);
  const { data: linkedRows } = docIds.length
    ? await supabase.from('cash_transactions').select('receipt_document_id').in('receipt_document_id', docIds)
    : { data: [] as { receipt_document_id: string | null }[] };
  const linkedIds = new Set((linkedRows ?? []).map((r) => r.receipt_document_id));

  const needsReceipt = cashRows.filter((r) => {
    const s = receiptStateOf(r);
    return s === 'scan' || s === 'advance';
  });
  const needsTotal = needsReceipt.reduce((a, r) => a + r.amount, 0);
  const month = monthDocs ?? [];
  const monthInbox = month.filter((d) => d.status === 'inbox').length;
  const monthReceipts = month.filter((d) => d.doc_type === 'receipt' || d.doc_type === 'register_receipt').length;

  return (
    <div>
      <PageHeader
        title="スキャン"
        en="Snap & file"
        description="レシート・請求書を撮るだけで保存ボックスへ。出金のレシートはその場で紐付けできます"
        actions={
          <>
            {can(ctx.role, 'register.operate') && (
              <Link href="/app/cash/close" className={cn(buttonVariants({ variant: 'secondary' }))}>
                <Lock className="h-4 w-4" />
                レジクローズ
              </Link>
            )}
            <Link href="/app/invoices?tab=inbox" className={cn(buttonVariants({ variant: 'secondary' }))}>
              <Inbox className="h-4 w-4" />
              保存ボックス<span className="en-inline">Inbox</span>
            </Link>
          </>
        }
      />

      {txId && !target && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          指定された出金が見つかりません（取消済み・他店舗の可能性があります）。通常のスキャンとして保存できます。
        </div>
      )}

      {target && (
        <Card className="mb-4 border-iris/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="text-xs font-bold text-royal">
                この出金のレシートを撮影<span className="en-inline">Receipt for this payout</span>
              </p>
              <p className="mt-1 truncate text-base font-bold text-ink">
                {splitPurpose(target.purpose, target.kind as CashKind).main}
                {splitPurpose(target.purpose, target.kind as CashKind).sub && (
                  <span className="ml-2 text-sm font-medium text-ink-3">{splitPurpose(target.purpose, target.kind as CashKind).sub}</span>
                )}
              </p>
              <p className="text-xs text-ink-3 tabular-nums">
                {target.business_date.replaceAll('-', '/')} {formatTime(target.occurred_at)} ・ {KIND_LABELS[target.kind as CashKind]}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {target.receipt_document_id ? (
                <span className={CHIP.ok}>✓ レシート登録済み（撮り直すと差し替え）</span>
              ) : (
                <span className={CHIP.muted}>レシート未添付</span>
              )}
              <b className="text-2xl font-extrabold text-ink tabular-nums">{yen(target.amount)}</b>
            </div>
            {!canLink && <p className="w-full text-xs text-danger">出金への紐付けには小口現金の登録権限が必要です（書類の保存のみ行えます）。</p>}
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle en="Capture">撮影・取り込み</CardTitle>
              <span className="text-xs text-ink-3">{target ? '1枚ずつ' : '複数枚OK'} ・ PDFも可</span>
            </CardHeader>
            <CardContent>
              <ScanCapture
                organizationId={ctx.organizationId}
                storeId={target?.store_id ?? ctx.currentStore?.id ?? null}
                txId={target && canLink ? target.id : null}
              />
              <p className="mt-3 text-[11.5px] text-ink-3">
                PDF・JPEG・PNG・WebP（20MBまで）。保存した書類は「保存ボックス」で種別・金額を仕分けできます（自動読み取りは行いません）。
              </p>
            </CardContent>
          </Card>

          {store && (
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle en="Needs receipt">レシート未添付の出金</CardTitle>
                <span className={cn('text-[13px] font-bold', needsReceipt.length > 0 ? 'text-ink-2' : 'text-success')}>
                  本日 <span className="tabular-nums">{needsReceipt.length}</span>件
                  {needsReceipt.length > 0 && <span className="tabular-nums">（{yen(needsTotal)}）</span>}
                </span>
              </CardHeader>
              {needsReceipt.length === 0 ? (
                <p className="flex items-center gap-1.5 px-5 py-4 text-sm text-ink-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  本日の出金はすべてレシートがあります
                </p>
              ) : (
                <ul>
                  {needsReceipt.map((r) => {
                    const { main, sub } = splitPurpose(r.purpose, r.kind);
                    const isAdvance = r.kind === 'petty_advance';
                    const active = target?.id === r.id;
                    return (
                      <li
                        key={r.id}
                        className={cn(
                          'grid grid-cols-[48px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b border-line px-5 py-2.5 text-[13px] last:border-b-0',
                          active ? 'bg-iris-soft' : 'bg-danger-soft/60'
                        )}
                      >
                        <time className="text-xs font-bold text-ink-3 tabular-nums">{formatTime(r.occurredAt)}</time>
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{main}</span>
                          <small className="block truncate text-[11px] text-ink-3">{sub ?? KIND_LABELS[r.kind]}</small>
                        </span>
                        <b className="tabular-nums">{yen(r.amount)}</b>
                        {active ? (
                          <span className={CHIP.muted}>撮影中</span>
                        ) : isAdvance ? (
                          <Link href="/app/cash?tab=petty" className={cn(buttonVariants({ size: 'sm' }), 'h-8 px-3 text-[12.5px]')}>
                            精算へ
                          </Link>
                        ) : (
                          <Link href={`/app/scan?tx=${r.id}`} className={cn(buttonVariants({ size: 'sm' }), 'h-8 px-3 text-[12.5px]')}>
                            撮る
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex justify-end border-t border-line px-5 py-2.5">
                <Link href="/app/cash/close" className="text-xs font-bold text-royal hover:underline">
                  レジクローズで出金レシートを確認 →
                </Link>
              </div>
            </Card>
          )}
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="space-y-3">
            <CardTitle en="Receipt box">レシートボックス</CardTitle>
            <LinkChips
              chips={TYPE_CHIPS.map((c) => ({
                key: c.key,
                label: c.label,
                href: `/app/scan?${new URLSearchParams({ ...(c.key ? { type: c.key } : {}), ...(target ? { tx: target.id } : {}) }).toString()}`,
              }))}
              active={filter}
              size="sm"
            />
          </CardHeader>
          <p className="border-b border-line px-5 py-2.5 text-[13px] text-ink-2">
            今月 <b className="tabular-nums">{month.length}</b>件スキャン ・ 領収書 <b className="tabular-nums">{monthReceipts}</b> ・ 未仕分け{' '}
            <b className={cn('tabular-nums', monthInbox > 0 && 'text-saffron')}>{monthInbox}</b>
          </p>
          {(docs ?? []).length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-ink-3">
              {filter ? 'この条件の書類はありません' : 'まだスキャンした書類はありません。左の「撮影する」から始めましょう'}
            </p>
          ) : (
            <ul>
              {(docs ?? []).map((d) => {
                const type = d.doc_type as DocType;
                return (
                  <li key={d.id} className="border-b border-line last:border-b-0">
                    <Link
                      href={`/app/invoices?tab=${d.status === 'inbox' ? 'inbox' : 'documents'}`}
                      className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-lilac-soft sm:px-5"
                    >
                      <span className="grid h-[42px] w-[42px] place-items-center rounded-[9px] bg-lilac text-royal">
                        <DocIcon type={type} />
                      </span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn(
                              'shrink-0 rounded-[5px] px-1.5 text-[10px] leading-[1.6] font-extrabold text-white',
                              TAG_CLASS[type] ?? 'bg-ink-3'
                            )}
                          >
                            {DOC_TYPE_LABELS[type] ?? d.doc_type}
                          </span>
                          <b className="truncate text-[13px] text-ink">{d.title || d.file_name}</b>
                        </span>
                        <small className="block truncate text-[11px] text-ink-3 tabular-nums">
                          {shortDateTime(d.created_at)} ・ {d.title ? d.file_name : 'スキャン'}
                          {linkedIds.has(d.id) && <span className="ml-1 font-bold text-success">✓ 出金に紐付け済</span>}
                        </small>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <b className="text-sm font-extrabold text-ink tabular-nums">{d.amount != null ? yen(d.amount) : '—'}</b>
                        <span className={cn(d.status === 'inbox' ? CHIP.wait : CHIP.ok, 'px-2 text-[10.5px]')}>
                          {d.status === 'inbox' ? '未仕分け' : '仕分け済'}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
