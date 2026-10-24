import type { createClient } from '@/lib/supabase/server';
import { calcRfm, type CustomerMetrics } from '@/lib/crm';
import type { RfmCustomerRow } from '@/components/customers/rfm-view';
import type { DuplicateCandidate, DuplicateGroup } from '@/components/customers/duplicates-view';

/**
 * 顧客台帳の「RFM分析」「重複候補」（/app/customers?view=rfm|duplicates）の読み込み。
 * Web の画面と iPad アプリのネイティブ画面（GET ?part=customerRfm|customerDuplicates）で同じものを使う。
 * 中身は app/app/customers/page.tsx にあったものをそのまま移した（2026-10-24）。
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function loadRfmCustomers(supabase: Supabase, organizationId: string): Promise<RfmCustomerRow[]> {
    // RFM分析は組織内の全active顧客を対象とする（来店実績のない顧客は R1F1M1・Dランクに集計される）
    const { data: rfmRows } = await supabase
      .from('customers')
      .select('id, name, phone, visit_count, total_spent, last_visit_at')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .limit(10000);

    const now = new Date();
    const rfmCustomers: RfmCustomerRow[] = (rfmRows ?? []).map((c) => {
      const metrics: CustomerMetrics = {
        visitCount: c.visit_count,
        totalSpent: c.total_spent,
        cancelCount: 0,
        noShowCount: 0,
        firstVisitAt: null,
        lastVisitAt: c.last_visit_at ? new Date(c.last_visit_at) : null,
      };
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        visitCount: c.visit_count,
        totalSpent: c.total_spent,
        lastVisitAt: c.last_visit_at,
        rfm: calcRfm(metrics, now),
      };
    });

  return rfmCustomers;
}

export async function loadDuplicateGroups(supabase: Supabase, organizationId: string): Promise<DuplicateGroup[]> {
    // 重複候補: 電話番号（:merged: を除く）またはメールアドレスが一致するactive顧客をグルーピングする
    const { data: dupRows } = await supabase
      .from('customers')
      .select('id, name, phone, email, visit_count, total_spent, last_visit_at')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .limit(5000);

    const phoneMap = new Map<string, DuplicateCandidate[]>();
    const emailMap = new Map<string, DuplicateCandidate[]>();
    for (const c of dupRows ?? []) {
      const cand: DuplicateCandidate = {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        visitCount: c.visit_count,
        totalSpent: c.total_spent,
        lastVisitAt: c.last_visit_at,
      };
      if (c.phone && c.phone.trim() && !c.phone.includes(':merged:')) {
        const key = c.phone.trim();
        phoneMap.set(key, [...(phoneMap.get(key) ?? []), cand]);
      }
      if (c.email && c.email.trim()) {
        const key = c.email.trim().toLowerCase();
        emailMap.set(key, [...(emailMap.get(key) ?? []), cand]);
      }
    }
    const groups: DuplicateGroup[] = [
      ...[...phoneMap.entries()]
        .filter(([, v]) => v.length > 1)
        .map(([key, dupCustomers]) => ({ key, matchType: 'phone' as const, customers: dupCustomers })),
      ...[...emailMap.entries()]
        .filter(([, v]) => v.length > 1)
        .map(([key, dupCustomers]) => ({ key, matchType: 'email' as const, customers: dupCustomers })),
    ];

  return groups;
}
