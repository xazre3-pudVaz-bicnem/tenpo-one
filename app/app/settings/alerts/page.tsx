import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { TableWrap, Table, THead, TBody, Tr, Th } from '@/components/ui/table';
import {
  ALERT_RULE_KEYS,
  ALERT_RULE_LABELS,
  ALERT_RULE_UNITS,
  ALERT_RULE_DEFAULTS,
  type AlertRuleKey,
} from '@/components/dashboard/alert-rules';
import { AlertRuleRow, type AlertRuleRowData } from './alert-rule-row';

export const metadata: Metadata = { title: '異常検知の閾値設定' };

export default async function AlertSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const supabase = await createClient();

  const canEditOrg = ctx.role === 'org_owner' || ctx.role === 'hq_admin';
  const storeId = ctx.currentStore?.id ?? null;

  const orFilter = storeId ? `store_id.is.null,store_id.eq.${storeId}` : 'store_id.is.null';
  const { data: rows } = await supabase
    .from('alert_rules')
    .select('store_id, rule_key, threshold, enabled')
    .eq('organization_id', ctx.organizationId)
    .or(orFilter);

  const orgByKey = new Map((rows ?? []).filter((r) => r.store_id === null).map((r) => [r.rule_key, r]));
  const storeByKey = new Map((rows ?? []).filter((r) => r.store_id === storeId && storeId !== null).map((r) => [r.rule_key, r]));

  const items: AlertRuleRowData[] = ALERT_RULE_KEYS.map((key: AlertRuleKey) => {
    const orgRow = orgByKey.get(key);
    const storeRow = storeByKey.get(key);
    const effectiveValue = storeRow ? storeRow.threshold : (orgRow ? orgRow.threshold : ALERT_RULE_DEFAULTS[key]);
    const effectiveSource: 'store' | 'org' | 'default' = storeRow ? 'store' : orgRow ? 'org' : 'default';
    return {
      ruleKey: key,
      label: ALERT_RULE_LABELS[key],
      unit: ALERT_RULE_UNITS[key],
      defaultValue: ALERT_RULE_DEFAULTS[key],
      orgValue: orgRow?.threshold ?? null,
      orgEnabled: orgRow?.enabled ?? true,
      storeValue: storeRow?.threshold ?? null,
      storeEnabled: storeRow?.enabled ?? true,
      effectiveValue,
      effectiveSource,
    };
  });

  return (
    <div>
      <PageHeader
        title="異常検知の閾値設定"
        description="ダッシュボードのアラート判定に使う閾値です。店舗設定は企業既定より優先されます。"
      />

      <Card>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>項目</Th>
                  <Th>企業既定{canEditOrg ? '' : '（本社のみ編集可）'}</Th>
                  <Th>{ctx.currentStore ? `店舗設定（${ctx.currentStore.name}）` : '店舗設定'}</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map((item) => (
                  <AlertRuleRow key={item.ruleKey} data={item} storeId={storeId} canEditOrg={canEditOrg} canEditStore={!!storeId} />
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-gray-400">
        ※ 優先順位: 店舗設定 &gt; 企業既定 &gt; コード既定値。店舗設定を削除すると企業既定に戻ります。
      </p>
    </div>
  );
}
