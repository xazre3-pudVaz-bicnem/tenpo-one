/**
 * 異常検知の閾値ロード（alert_rules）。
 * 継承ルール: 店舗override（store_id=当店） > 企業既定（store_id=null） > コード側の既定値。
 * lib/forecast.ts 同様の純ロジックはここではなく alerts.ts 側の計算に置き、
 * 本モジュールは「閾値の解決」だけを担う。
 */
import type { createClient } from '@/lib/supabase/server';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export const ALERT_RULE_KEYS = [
  'cash_difference_yen',
  'discount_rate_percent',
  'void_count',
  'cost_rate_percent',
  'labor_rate_percent',
  'waste_amount_yen',
  'sales_drop_percent',
] as const;

export type AlertRuleKey = (typeof ALERT_RULE_KEYS)[number];

export const ALERT_RULE_LABELS: Record<AlertRuleKey, string> = {
  cash_difference_yen: '現金差異（過去7日・日単位）',
  discount_rate_percent: '値引率（過去7日・売上に対する割合）',
  void_count: '取消（返金）件数（過去7日）',
  cost_rate_percent: '原価率（過去7日）',
  labor_rate_percent: '人件費率（過去7日）',
  waste_amount_yen: '廃棄額（過去7日）',
  sales_drop_percent: '売上低下（前日が過去4週同曜日平均に対する割合）',
};

export const ALERT_RULE_UNITS: Record<AlertRuleKey, string> = {
  cash_difference_yen: '円',
  discount_rate_percent: '%',
  void_count: '件',
  cost_rate_percent: '%',
  labor_rate_percent: '%',
  waste_amount_yen: '円',
  sales_drop_percent: '%（この値を下回ると警告）',
};

/** 既定値は現行ロジックを踏襲した値（現場でよく使われる目安） */
export const ALERT_RULE_DEFAULTS: Record<AlertRuleKey, number> = {
  cash_difference_yen: 3000,
  discount_rate_percent: 20,
  void_count: 5,
  cost_rate_percent: 40,
  labor_rate_percent: 35,
  waste_amount_yen: 10000,
  sales_drop_percent: 70,
};

export interface ResolvedThreshold {
  value: number;
  enabled: boolean;
  source: 'store' | 'org' | 'default';
}

interface AlertRuleRow {
  store_id: string | null;
  rule_key: string;
  threshold: number;
  enabled: boolean;
}

/** 店舗ごとの解決済み閾値マップを返す */
export async function loadResolvedThresholds(
  supabase: SupabaseClient,
  organizationId: string,
  storeIds: string[]
): Promise<Map<string, Record<AlertRuleKey, ResolvedThreshold>>> {
  const { data } = await supabase
    .from('alert_rules')
    .select('store_id, rule_key, threshold, enabled')
    .eq('organization_id', organizationId)
    .or(storeIds.length > 0 ? `store_id.is.null,store_id.in.(${storeIds.join(',')})` : 'store_id.is.null');

  const rows = (data ?? []) as AlertRuleRow[];
  const orgRows = new Map(rows.filter((r) => r.store_id === null).map((r) => [r.rule_key, r]));
  const storeRowsByStore = new Map<string, Map<string, AlertRuleRow>>();
  for (const r of rows) {
    if (r.store_id === null) continue;
    const m = storeRowsByStore.get(r.store_id) ?? new Map<string, AlertRuleRow>();
    m.set(r.rule_key, r);
    storeRowsByStore.set(r.store_id, m);
  }

  const result = new Map<string, Record<AlertRuleKey, ResolvedThreshold>>();
  for (const storeId of storeIds) {
    const storeRows = storeRowsByStore.get(storeId);
    const resolved = {} as Record<AlertRuleKey, ResolvedThreshold>;
    for (const key of ALERT_RULE_KEYS) {
      const storeRow = storeRows?.get(key);
      const orgRow = orgRows.get(key);
      if (storeRow) {
        resolved[key] = { value: storeRow.threshold, enabled: storeRow.enabled, source: 'store' };
      } else if (orgRow) {
        resolved[key] = { value: orgRow.threshold, enabled: orgRow.enabled, source: 'org' };
      } else {
        resolved[key] = { value: ALERT_RULE_DEFAULTS[key], enabled: true, source: 'default' };
      }
    }
    result.set(storeId, resolved);
  }
  return result;
}
