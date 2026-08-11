import { describe, expect, it } from 'vitest';
import {
  canTransitionStage,
  computeProgress,
  evaluateGoLive,
  isItemRelevant,
  ALL_CHECKLIST_ITEMS,
  ENVIRONMENTS,
  STAGES,
  MODULES,
  type OnboardingSignals,
  type ChecklistState,
} from '@/lib/tenant-onboarding';

describe('導入ステージ state machine', () => {
  it('定義された遷移のみ許可する', () => {
    expect(canTransitionStage('draft', 'onboarding')).toBe(true);
    expect(canTransitionStage('ready', 'live')).toBe(true);
    expect(canTransitionStage('onboarding', 'testing')).toBe(false); // configを飛ばせない
    expect(canTransitionStage('draft', 'live')).toBe(false); // いきなり本番不可
    expect(canTransitionStage('live', 'suspended')).toBe(true);
    expect(canTransitionStage('cancelled', 'onboarding')).toBe(true); // 再開
  });
  it('全ステージが遷移表を持つ', () => {
    for (const s of STAGES) expect(canTransitionStage(s, s)).toBe(false); // 自己遷移は定義しない
  });
});

describe('環境・モジュール定義', () => {
  it('環境は demo/test/pilot/production', () => {
    expect([...ENVIRONMENTS]).toEqual(['demo', 'test', 'pilot', 'production']);
  });
  it('モジュールに主要機能が含まれる', () => {
    for (const m of ['reservations', 'pos', 'crm', 'kds', 'inventory']) {
      expect((MODULES as readonly string[]).includes(m)).toBe(true);
    }
  });
});

describe('チェックリスト関連性', () => {
  it('module指定なしは常に関連', () => {
    const item = ALL_CHECKLIST_ITEMS.find((i) => i.key === 'owner_account')!;
    expect(isItemRelevant(item, [])).toBe(true);
  });
  it('module指定は enabled_modules 次第', () => {
    const posItem = ALL_CHECKLIST_ITEMS.find((i) => i.key === 'menu_items')!; // module: pos
    expect(isItemRelevant(posItem, ['reservations'])).toBe(false);
    expect(isItemRelevant(posItem, ['pos'])).toBe(true);
  });
});

describe('進捗率', () => {
  it('関連項目のうち満たされた割合を返す', () => {
    const signals: OnboardingSignals = { org_created: true, store_created: true, slug_set: true, owner_account: true, business_hours: false };
    const checklist: ChecklistState = {};
    const p = computeProgress(signals, checklist, []); // module無しモジュールで最小
    expect(p.relevantTotal).toBeGreaterThan(0);
    expect(p.percent).toBeGreaterThanOrEqual(0);
    expect(p.percent).toBeLessThanOrEqual(100);
  });
});

describe('Go Live 判定', () => {
  const fullSignals: OnboardingSignals = {
    org_created: true, store_created: true, slug_set: true, owner_account: true, business_hours: true,
    tables: true, menu_items: true, tax: true, register: true,
  };
  const manualDone: ChecklistState = {
    e2e: { done: true }, security: { done: true }, owner_confirm: { done: true }, go_live_approval: { done: true },
  };

  it('POS利用時: 必須(tables/menu/tax/register + 手動)が揃えばREADY', () => {
    const r = evaluateGoLive(fullSignals, manualDone, ['pos', 'reservations']);
    expect(r.ready).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it('必須未達はblockerに現れる', () => {
    const r = evaluateGoLive({ ...fullSignals, tax: false }, manualDone, ['pos']);
    expect(r.ready).toBe(false);
    expect(r.blockers.some((b) => b.key === 'tax')).toBe(true);
  });

  it('使わないモジュールのCriticalは対象外（在庫/給与を使わなくてもGo Live可能）', () => {
    // pos未使用なら menu_items/tax/register のCriticalは対象外
    const noPos: OnboardingSignals = {
      org_created: true, store_created: true, slug_set: true, owner_account: true, business_hours: true, tables: true,
    };
    const r = evaluateGoLive(noPos, manualDone, ['reservations']);
    expect(r.ready).toBe(true);
  });

  it('手動の必須(E2E/セキュリティ/オーナー確認/承認)未完了はNOT READY', () => {
    const r = evaluateGoLive(fullSignals, {}, ['pos']);
    expect(r.ready).toBe(false);
    expect(r.blockers.some((b) => b.key === 'go_live_approval')).toBe(true);
  });
});
