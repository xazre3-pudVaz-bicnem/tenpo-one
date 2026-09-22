import 'server-only';
import { dynamicPricingFrom, type DynamicPriceRule } from './dynamic-pricing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (table: string) => any };

/** 店舗のダイナミックプライシングのルール（読めなければ空＝今まで通りの値段） */
export async function loadDynamicRules(client: AnyClient, storeId: string): Promise<DynamicPriceRule[]> {
  try {
    const { data, error } = await client.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
    if (error) {
      console.error('[dynamic-pricing] settings read failed', error.message);
      return [];
    }
    return dynamicPricingFrom((data as { settings?: unknown } | null)?.settings ?? null).rules;
  } catch (e) {
    console.error('[dynamic-pricing] settings read failed', e instanceof Error ? e.message : e);
    return [];
  }
}
