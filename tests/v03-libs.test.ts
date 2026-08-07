import { describe, expect, it } from 'vitest';
import { validateCoupon, type CouponLike, type CouponContext } from '@/lib/coupons';
import { checkApproval, resolveApprovalRule, type ApprovalRuleLike } from '@/lib/approvals';
import { forecastUsage, linearLandingForecast } from '@/lib/forecast';
import { suggestReorder } from '@/lib/reorder';
import { buildTaxRows } from '@/lib/receipts';
import { shouldOpenDrawer } from '@/lib/printing/types';
import { classifyExtended, matchesAudience } from '@/lib/crm';

const NOW = new Date('2026-08-08T19:00:00+09:00');

// -------------------------------------------------------------
describe('validateCoupon（クーポン検証）', () => {
  const base: CouponLike = {
    id: 'c1', kind: 'fixed', value: 500, minTotal: 0,
    startsAt: null, endsAt: null, timeFrom: null, timeTo: null,
    maxUses: null, perCustomerLimit: null, firstVisitOnly: false,
    storeId: null, status: 'active',
  };
  const ctx: CouponContext = {
    now: NOW, jstTime: '19:00', orderTotal: 3000, storeId: 's1',
    customerVisitCount: 3, totalRedemptions: 0, customerRedemptions: 0,
  };

  it('固定額: 合計を超えない値引き', () => {
    expect(validateCoupon(base, ctx)).toEqual({ valid: true, discount: 500 });
    expect(validateCoupon({ ...base, value: 5000 }, ctx).discount).toBe(3000);
  });
  it('%: 切り捨て計算', () => {
    expect(validateCoupon({ ...base, kind: 'percent', value: 10 }, { ...ctx, orderTotal: 1999 }).discount).toBe(199);
  });
  it('期間外・時間帯外・店舗違いを拒否', () => {
    expect(validateCoupon({ ...base, endsAt: new Date('2026-08-01') }, ctx).reason).toBe('expired');
    expect(validateCoupon({ ...base, startsAt: new Date('2026-09-01') }, ctx).reason).toBe('not_started');
    expect(validateCoupon({ ...base, timeFrom: '11:00', timeTo: '14:00' }, ctx).reason).toBe('time_window');
    expect(validateCoupon({ ...base, storeId: 's2' }, ctx).reason).toBe('wrong_store');
  });
  it('深夜跨ぎの時間帯（22:00-02:00）は跨いで有効', () => {
    const late = { ...base, timeFrom: '22:00', timeTo: '02:00' };
    expect(validateCoupon(late, { ...ctx, jstTime: '23:30' }).valid).toBe(true);
    expect(validateCoupon(late, { ...ctx, jstTime: '01:00' }).valid).toBe(true);
    expect(validateCoupon(late, { ...ctx, jstTime: '15:00' }).valid).toBe(false);
  });
  it('利用上限・顧客上限・初回限定', () => {
    expect(validateCoupon({ ...base, maxUses: 10 }, { ...ctx, totalRedemptions: 10 }).reason).toBe('max_uses');
    expect(validateCoupon({ ...base, perCustomerLimit: 1 }, { ...ctx, customerRedemptions: 1 }).reason).toBe('per_customer_limit');
    expect(validateCoupon({ ...base, firstVisitOnly: true }, ctx).reason).toBe('first_visit_only');
    expect(validateCoupon({ ...base, firstVisitOnly: true }, { ...ctx, customerVisitCount: 0 }).valid).toBe(true);
    expect(validateCoupon({ ...base, firstVisitOnly: true }, { ...ctx, customerVisitCount: null }).reason).toBe('requires_customer');
  });
  it('最低利用額', () => {
    expect(validateCoupon({ ...base, minTotal: 5000 }, ctx).reason).toBe('min_total');
  });
});

// -------------------------------------------------------------
describe('承認エンジン（approval_rules）', () => {
  const rules: ApprovalRuleLike[] = [
    { target: 'invoice', minAmount: 0, maxAmount: 30_000, approverRole: 'store_manager', allowSelfApprove: false },
    { target: 'invoice', minAmount: 30_000, maxAmount: 100_000, approverRole: 'area_manager', allowSelfApprove: false },
    { target: 'invoice', minAmount: 100_000, maxAmount: null, approverRole: 'hq_admin', allowSelfApprove: false },
  ];

  it('金額帯で必要承認ロールが変わる（30,000円は上位帯）', () => {
    expect(resolveApprovalRule(rules, 'invoice', 29_999)?.approverRole).toBe('store_manager');
    expect(resolveApprovalRule(rules, 'invoice', 30_000)?.approverRole).toBe('area_manager');
    expect(resolveApprovalRule(rules, 'invoice', 100_000)?.approverRole).toBe('hq_admin');
  });
  it('上位ロールは下位要求を満たす・下位は拒否', () => {
    const rule = resolveApprovalRule(rules, 'invoice', 50_000);
    expect(checkApproval(rule, 'hq_admin', false).allowed).toBe(true);
    expect(checkApproval(rule, 'store_manager', false)).toMatchObject({
      allowed: false, reason: 'insufficient_role', requiredRoleLabel: 'エリアマネージャー',
    });
  });
  it('自己承認は既定で禁止・許可設定で可能', () => {
    const rule = resolveApprovalRule(rules, 'invoice', 10_000);
    expect(checkApproval(rule, 'store_manager', true).reason).toBe('self_approve_forbidden');
    expect(checkApproval({ ...rule!, allowSelfApprove: true }, 'store_manager', true).allowed).toBe(true);
  });
  it('ルール未設定は既存権限に委ねる', () => {
    expect(checkApproval(null, 'staff', true).allowed).toBe(true);
    expect(resolveApprovalRule(rules, 'expense', 10_000)).toBeNull();
  });
});

// -------------------------------------------------------------
describe('forecastUsage（曜日別平均予測）', () => {
  it('曜日別平均から明日の見込みを出す', () => {
    // 金曜(8/8基準で明日=土曜)に多く売れる履歴
    const history = [
      { date: '2026-07-25', quantity: 30 }, { date: '2026-08-01', quantity: 34 }, // 土
      { date: '2026-07-24', quantity: 10 }, { date: '2026-07-31', quantity: 12 }, // 金
      { date: '2026-07-27', quantity: 5 }, { date: '2026-08-03', quantity: 7 },   // 月
      { date: '2026-07-28', quantity: 6 }, { date: '2026-08-04', quantity: 8 },
      { date: '2026-07-29', quantity: 6 }, { date: '2026-08-05', quantity: 6 },
      { date: '2026-07-30', quantity: 9 }, { date: '2026-08-06', quantity: 11 },
      { date: '2026-07-26', quantity: 20 }, { date: '2026-08-02', quantity: 24 }, // 日
    ];
    const f = forecastUsage(history, '2026-08-07'); // 金曜
    expect(f.tomorrow).toBe(32); // 土曜平均 (30+34)/2
    expect(f.lowConfidence).toBe(false);
    expect(f.weekdayAverages[6]).toBe(32);
  });
  it('データ不足は低信頼フラグ', () => {
    const f = forecastUsage([{ date: '2026-08-01', quantity: 10 }], '2026-08-07');
    expect(f.lowConfidence).toBe(true);
  });
  it('線形着地予測: 実績/経過日×月日数', () => {
    expect(linearLandingForecast(500_000, 10, 30)).toBe(1_500_000);
    expect(linearLandingForecast(0, 0, 30)).toBeNull();
  });
});

// -------------------------------------------------------------
describe('suggestReorder（発注提案）', () => {
  it('適正在庫があれば 適正−現在庫 が推奨数', () => {
    const s = suggestReorder({
      currentQuantity: 3, optimalQuantity: 10, minQuantity: 1,
      reorderPoint: 4, avgDailySales: 2, leadTimeDays: 3,
    });
    expect(s.needed).toBe(true);
    expect(s.suggestedQuantity).toBe(7);
  });
  it('適正未設定は 発注点+日販×リードタイム を推奨水準にする', () => {
    const s = suggestReorder({
      currentQuantity: 5, optimalQuantity: null, minQuantity: null,
      reorderPoint: 4, avgDailySales: 2, leadTimeDays: 3,
    });
    expect(s.targetQuantity).toBe(10);
    expect(s.suggestedQuantity).toBe(5);
  });
  it('入荷待ち分は差し引く・過剰在庫は0', () => {
    expect(suggestReorder({
      currentQuantity: 3, optimalQuantity: 10, minQuantity: null,
      reorderPoint: 4, avgDailySales: 1, leadTimeDays: 3,
    }, 5).suggestedQuantity).toBe(2);
    expect(suggestReorder({
      currentQuantity: 99, optimalQuantity: 10, minQuantity: null,
      reorderPoint: 4, avgDailySales: 1, leadTimeDays: 3,
    }).suggestedQuantity).toBe(0);
  });
});

// -------------------------------------------------------------
describe('レシート・ドロア', () => {
  it('buildTaxRows: 税率別内訳（10%/8%混在・取消行除外）', () => {
    const rows = buildTaxRows([
      { lineTotal: 1100, taxRate: 10 },
      { lineTotal: 1080, taxRate: 8 },
      { lineTotal: 550, taxRate: 10 },
      { lineTotal: 990, taxRate: 10, cancelled: true },
    ]);
    expect(rows).toEqual([
      { rate: 10, taxable: 1650, tax: 100 + 50 },
      { rate: 8, taxable: 1080, tax: 80 },
    ]);
  });
  it('shouldOpenDrawer: 現金のみ自動開放が既定・キャッシュレスは設定次第', () => {
    const cfg = { autoOpenOnCash: true, openOnCashless: false };
    expect(shouldOpenDrawer(['cash'], cfg)).toBe(true);
    expect(shouldOpenDrawer(['cash', 'credit'], cfg)).toBe(true);
    expect(shouldOpenDrawer(['credit'], cfg)).toBe(false);
    expect(shouldOpenDrawer(['credit'], { ...cfg, openOnCashless: true })).toBe(true);
  });
});

// -------------------------------------------------------------
describe('CRM拡張（v0.3セグメント・条件ビルダー）', () => {
  const base = {
    visitCount: 5, totalSpent: 60_000, cancelCount: 0, noShowCount: 0,
    firstVisitAt: new Date('2026-05-01'), lastVisitAt: new Date('2026-08-01'),
  };

  it('休眠30/60/90の段階判定', () => {
    expect(classifyExtended({ ...base, lastVisitAt: new Date('2026-07-01') }, {}, NOW)).toContain('dormant_30');
    expect(classifyExtended({ ...base, lastVisitAt: new Date('2026-06-01') }, {}, NOW)).toContain('dormant_60');
    expect(classifyExtended({ ...base, lastVisitAt: new Date('2026-04-01') }, {}, NOW)).toContain('dormant_90');
  });
  it('ランチ/ディナー傾向・テイクアウト・誕生月', () => {
    const seg = classifyExtended(base, {
      lunchVisits: 4, dinnerVisits: 1, takeoutOrders: 3,
      birthday: new Date('1990-08-15'),
    }, NOW);
    expect(seg).toEqual(expect.arrayContaining(['lunch', 'takeout', 'birthday_month']));
    expect(seg).not.toContain('dinner');
  });
  it('2回目来店', () => {
    expect(classifyExtended({ ...base, visitCount: 2 }, {}, NOW)).toContain('second_visit');
  });
  it('条件ビルダー: 累計10万以上 AND 最終来店30日以内 AND 来店5回以上', () => {
    const conditions = [
      { field: 'total_spent' as const, op: 'gte' as const, value: 100_000 },
      { field: 'days_since_last_visit' as const, op: 'lte' as const, value: 30 },
      { field: 'visit_count' as const, op: 'gte' as const, value: 5 },
    ];
    expect(matchesAudience({ ...base, totalSpent: 150_000 }, conditions, NOW)).toBe(true);
    expect(matchesAudience({ ...base, totalSpent: 50_000 }, conditions, NOW)).toBe(false);
    expect(matchesAudience(
      { ...base, totalSpent: 150_000, lastVisitAt: new Date('2026-06-01') }, conditions, NOW
    )).toBe(false);
  });
});
