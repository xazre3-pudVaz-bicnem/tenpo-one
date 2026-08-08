import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ROLE_LABELS } from '@/lib/permissions';
import { resolveApprovalRule, type ApprovalRuleLike } from '@/lib/approvals';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { yen, formatDate } from '@/lib/format';
import { PO_STATUS_LABELS, PO_STATUS_TONES, type PoStatus } from '@/components/inventory/labels';
import { ReceiveForm } from '@/components/inventory/receive-form';
import { PoStatusActions } from './po-status-actions';
import { PoPrintButton } from './po-print-button';

export const metadata: Metadata = { title: '発注詳細' };

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const { id } = await params;
  const supabase = await createClient();

  const { data: po } = await supabase
    .from('purchase_orders')
    .select('*, vendors(name), stores(name, address, phone)')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!po) notFound();

  const { data: itemsData } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('purchase_order_id', id)
    .order('created_at');
  const items = itemsData ?? [];

  // 在庫連動明細の変換情報（仕入単位・在庫単位・変換係数）を入荷プレビュー用に取得
  const invItemIds = [...new Set(items.map((i) => i.inventory_item_id).filter((v): v is string => !!v))];
  let conversionMap = new Map<string, { stockUnit: string; purchaseUnit: string | null; factor: number }>();
  if (invItemIds.length > 0) {
    const { data: invItems } = await supabase
      .from('inventory_items')
      .select('id, unit, purchase_unit, purchase_to_stock_factor')
      .in('id', invItemIds);
    conversionMap = new Map(
      (invItems ?? []).map((i) => [
        i.id as string,
        { stockUnit: i.unit as string, purchaseUnit: i.purchase_unit as string | null, factor: Number(i.purchase_to_stock_factor) || 1 },
      ])
    );
  }

  const status = po.status as PoStatus;
  const vendorName = (po.vendors as unknown as { name: string } | null)?.name ?? '';
  const storeInfo = po.stores as unknown as { name: string; address: string | null; phone: string | null } | null;
  const storeName = storeInfo?.name ?? '';
  const subtotal = po.total - po.tax_total;

  // 承認待ち（requested）の場合、金額から必要承認ロールを解決してヒント表示する
  let requiredApprovalRoleLabel: string | null = null;
  if (status === 'requested') {
    const { data: rulesData } = await supabase
      .from('approval_rules')
      .select('target, min_amount, max_amount, approver_role, allow_self_approve')
      .eq('organization_id', ctx.organizationId)
      .eq('target', 'purchase_order');
    const rules: ApprovalRuleLike[] = (rulesData ?? []).map((r) => ({
      target: r.target as ApprovalRuleLike['target'],
      minAmount: r.min_amount as number,
      maxAmount: r.max_amount as number | null,
      approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
      allowSelfApprove: r.allow_self_approve as boolean,
    }));
    const rule = resolveApprovalRule(rules, 'purchase_order', po.total);
    requiredApprovalRoleLabel = rule ? ROLE_LABELS[rule.approverRole] : null;
  }

  return (
    <div>
      <PageHeader
        title={`発注書 #${po.po_no}`}
        description={`${vendorName}／${storeName}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {(status === 'ordered' || status === 'partially_received') && (
              <ReceiveForm
                poId={po.id}
                items={items.map((i) => {
                  const conv = i.inventory_item_id ? conversionMap.get(i.inventory_item_id) : undefined;
                  return {
                    id: i.id,
                    name: i.name,
                    unit: i.unit,
                    quantity: Number(i.quantity),
                    receivedQuantity: Number(i.received_quantity),
                    unitCost: i.unit_cost,
                    stockUnit: conv?.stockUnit ?? i.unit,
                    factor: conv?.factor ?? 1,
                  };
                })}
              />
            )}
            <PoStatusActions poId={po.id} status={status} />
            <PoPrintButton />
            {/*
              発注書と仕入請求書（会計連動元）は別データのため、この発注に1対1で対応する仕訳は存在しない。
              誤解を避けるため「この発注の仕訳」ではなく、店舗の仕入仕訳一覧への案内として控えめに提示する。
            */}
            <Link
              href={`/app/accounting?source_type=purchase&store=${po.store_id}`}
              className={cn(buttonVariants({ variant: 'secondary' }))}
              title="この店舗の仕入（請求書）仕訳の一覧を開きます（この発注専用ではありません）"
            >
              <FileText className="h-4 w-4" />
              仕入仕訳一覧（店舗）
            </Link>
          </div>
        }
      />

      {status === 'requested' && requiredApprovalRoleLabel && (
        <p className="mb-3 text-xs text-primary-deep print:hidden">
          この金額の承認には「{requiredApprovalRoleLabel}」以上のロールが必要です
        </p>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-5 print:hidden">
        <Card className="p-4">
          <p className="text-xs text-gray-500">状態</p>
          <div className="mt-1">
            <Badge tone={PO_STATUS_TONES[status]}>{PO_STATUS_LABELS[status]}</Badge>
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">小計（税抜）</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-navy">{yen(subtotal)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">消費税</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-navy">{yen(po.tax_total)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">合計（税込）</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-primary-deep">{yen(po.total)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">入荷予定日</p>
          <p className="mt-1 text-sm text-navy">{formatDate(po.expected_at)}</p>
        </Card>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>明細</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>品目</Th>
                  <Th className="text-right">数量</Th>
                  <Th>単位</Th>
                  <Th className="text-right">単価（税抜）</Th>
                  <Th className="text-right">税率</Th>
                  <Th className="text-right">金額（税抜）</Th>
                  <Th className="text-right">入荷済み</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map((i) => (
                  <Tr key={i.id}>
                    <Td className="font-medium text-navy">{i.name}</Td>
                    <Td className="text-right tabular-nums">{i.quantity}</Td>
                    <Td>{i.unit}</Td>
                    <Td className="text-right tabular-nums">{yen(i.unit_cost)}</Td>
                    <Td className="text-right tabular-nums">{Number(i.tax_rate)}%</Td>
                    <Td className="text-right tabular-nums">{yen(Math.round(i.quantity * i.unit_cost))}</Td>
                    <Td className="text-right tabular-nums">
                      {i.received_quantity} / {i.quantity}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>

      {po.note && (
        <Card className="mt-5 p-4 print:hidden">
          <p className="text-xs text-gray-500">メモ</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{po.note}</p>
        </Card>
      )}

      {/* 発注書の印刷ビュー（画面上は「印刷」ボタンから使用。印刷時はここのみ出力される） */}
      <div className="print-area mx-auto mt-8 max-w-2xl rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-900 print:mt-0 print:max-w-none print:border-0">
        <h1 className="text-xl font-bold">発注書</h1>
        <p className="mt-1 text-xs text-gray-500">
          発注番号 #{po.po_no}　発注日 {formatDate(po.ordered_at ?? po.created_at)}
        </p>
        <div className="mt-6 flex items-start justify-between">
          <div>
            <p className="text-base font-semibold">{vendorName} 御中</p>
            <p className="mt-4">下記の通り発注いたします。</p>
            <p className="mt-1">希望納期：{formatDate(po.expected_at)}</p>
          </div>
          <div className="text-right text-xs text-gray-600">
            <p className="text-sm font-semibold text-navy">{storeName}</p>
            {storeInfo?.address && <p>{storeInfo.address}</p>}
            {storeInfo?.phone && <p>TEL {storeInfo.phone}</p>}
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-400 text-left">
              <th className="py-1.5">品目</th>
              <th className="py-1.5 text-right">数量</th>
              <th className="py-1.5 text-center">単位</th>
              <th className="py-1.5 text-right">単価</th>
              <th className="py-1.5 text-right">税率</th>
              <th className="py-1.5 text-right">金額</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-gray-200">
                <td className="py-1.5">{i.name}</td>
                <td className="py-1.5 text-right tabular-nums">{i.quantity}</td>
                <td className="py-1.5 text-center">{i.unit}</td>
                <td className="py-1.5 text-right tabular-nums">{yen(i.unit_cost)}</td>
                <td className="py-1.5 text-right tabular-nums">{Number(i.tax_rate)}%</td>
                <td className="py-1.5 text-right tabular-nums">{yen(Math.round(i.quantity * i.unit_cost))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-4 w-64 space-y-1">
          <div className="flex justify-between">
            <span>小計（税抜）</span>
            <span className="tabular-nums">{yen(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>消費税</span>
            <span className="tabular-nums">{yen(po.tax_total)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-300 pt-1 text-base font-bold">
            <span>合計（税込）</span>
            <span className="tabular-nums">{yen(po.total)}</span>
          </div>
        </div>

        {po.note && (
          <p className="mt-6 whitespace-pre-wrap text-xs text-gray-600">備考：{po.note}</p>
        )}
      </div>
    </div>
  );
}
