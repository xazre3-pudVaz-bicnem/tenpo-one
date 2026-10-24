import { isUuid } from '@/lib/native-pos';
import type {
  BusinessHourStepInput,
  CategoryStepInput,
  CompanyStepInput,
  MenuItemStepInput,
  StaffInviteStepInput,
  StoreStepInput,
  TableStepInput,
} from '@/app/app/onboarding/actions';

/**
 * iPad アプリのネイティブの「初期設定」（初期導入ウィザード。Web の /app/onboarding と同じ。2026-10-24 Ronnie「iPad は全部ネイティブ」）。
 * 読み込みは GET /api/app/v1/pos?part=onboarding、操作は POST { type: 'onboarding', action: … }（lib/native-modules/onboarding.ts）。
 * 中身は Web と同じ Server Action（app/app/onboarding/actions.ts）を呼ぶだけ。ここは送られてきた中身の確かめ（純粋な関数）。
 */

/** ウィザードの段の数（会社情報 … 完了） */
export const ONBOARDING_STEPS = 10;

/** 1 回に送れる行（テーブル・カテゴリー・商品・スタッフ）の上限。Web の画面で手で足せる数より十分大きい */
const MAX_ROWS = 300;
/** 1 つの欄の長さの上限 */
const MAX_TEXT = 500;

export type NativeOnboardingAction =
  | { action: 'company'; input: CompanyStepInput }
  | { action: 'store'; input: StoreStepInput }
  | { action: 'hours'; storeId: string; hours: BusinessHourStepInput[] }
  | { action: 'tables'; storeId: string; tables: TableStepInput[] }
  | { action: 'categories'; storeId: string; categories: CategoryStepInput[] }
  | { action: 'items'; storeId: string; items: MenuItemStepInput[] }
  | { action: 'staff'; entries: StaffInviteStepInput[] }
  | { action: 'payments' }
  | { action: 'register'; storeId: string }
  | { action: 'complete' }
  | { action: 'skip'; next: number };

type Parsed = { ok: true; value: NativeOnboardingAction } | { ok: false; error: string };

const BAD = '内容が正しくありません';
const text = (v: unknown): string => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const rows = (v: unknown): Record<string, unknown>[] | null =>
  Array.isArray(v) && v.length <= MAX_ROWS && v.every((r) => r && typeof r === 'object' && !Array.isArray(r))
    ? (v as Record<string, unknown>[])
    : null;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 時刻を「HH:mm」に（DB の time は「11:00:00」で来る。Web の input[type=time] と同じ形にそろえる）。形が違えば null */
export function onboardingTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** 開くステップ（1〜10 に収める。Web の wizard.tsx の useState と同じ） */
export function onboardingStartStep(step: unknown): number {
  const n = typeof step === 'number' && Number.isFinite(step) ? Math.trunc(step) : 1;
  return Math.min(ONBOARDING_STEPS, Math.max(1, n));
}

/** POST { type: 'onboarding', action, … } の中身を確かめる */
export function parseNativeOnboardingAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: BAD };
  const b = raw as Record<string, unknown>;
  const storeId = isUuid(b.storeId) ? (b.storeId as string) : null;
  const needStore = (): Parsed => ({ ok: false, error: '先に店舗情報を登録してください（前のステップへ戻ってください）' });

  switch (b.action) {
    case 'company': {
      const c = b.company && typeof b.company === 'object' ? (b.company as Record<string, unknown>) : null;
      if (!c) return { ok: false, error: BAD };
      return {
        ok: true,
        value: {
          action: 'company',
          input: { name: text(c.name), nameKana: text(c.nameKana), postalCode: text(c.postalCode), address: text(c.address), phone: text(c.phone) },
        },
      };
    }
    case 'store': {
      if (b.storeId != null && !storeId) return { ok: false, error: BAD };
      if (!text(b.name).trim()) return { ok: false, error: '店舗名を入力してください' };
      return { ok: true, value: { action: 'store', input: { storeId, name: text(b.name), address: text(b.address), phone: text(b.phone) } } };
    }
    case 'hours': {
      if (!storeId) return needStore();
      const list = rows(b.hours);
      if (!list || list.length !== 7) return { ok: false, error: '営業時間データが不正です' };
      const hours: BusinessHourStepInput[] = list.map((h) => ({
        dayOfWeek: typeof h.dayOfWeek === 'number' && Number.isInteger(h.dayOfWeek) ? h.dayOfWeek : -1,
        isClosed: h.isClosed === true,
        openTime: onboardingTime(h.openTime),
        closeTime: onboardingTime(h.closeTime),
      }));
      // 曜日は 0〜6 がちょうど 1 つずつ
      const days = new Set(hours.map((h) => h.dayOfWeek));
      if (days.size !== 7 || hours.some((h) => h.dayOfWeek < 0 || h.dayOfWeek > 6)) return { ok: false, error: '営業時間データが不正です' };
      return { ok: true, value: { action: 'hours', storeId, hours } };
    }
    case 'tables': {
      if (!storeId) return needStore();
      const list = rows(b.tables);
      if (!list) return { ok: false, error: BAD };
      return {
        ok: true,
        value: { action: 'tables', storeId, tables: list.map((t) => ({ name: text(t.name), capacityMax: Math.max(1, Math.round(num(t.capacityMax)) || 1) })) },
      };
    }
    case 'categories': {
      if (!storeId) return needStore();
      const list = rows(b.categories);
      if (!list) return { ok: false, error: BAD };
      return { ok: true, value: { action: 'categories', storeId, categories: list.map((c) => ({ name: text(c.name) })) } };
    }
    case 'items': {
      if (!storeId) return needStore();
      const list = rows(b.items);
      if (!list) return { ok: false, error: BAD };
      if (list.some((i) => i.categoryId != null && i.categoryId !== '' && !isUuid(i.categoryId))) return { ok: false, error: BAD };
      return {
        ok: true,
        value: {
          action: 'items',
          storeId,
          items: list.map((i) => ({
            categoryId: isUuid(i.categoryId) ? (i.categoryId as string) : null,
            name: text(i.name),
            price: Math.max(0, num(i.price)),
          })),
        },
      };
    }
    case 'staff': {
      const list = rows(b.entries);
      if (!list) return { ok: false, error: BAD };
      return {
        ok: true,
        value: { action: 'staff', entries: list.map((e) => ({ email: text(e.email), displayName: text(e.displayName), role: text(e.role) })) },
      };
    }
    case 'payments':
      return { ok: true, value: { action: 'payments' } };
    case 'register':
      if (!storeId) return needStore();
      return { ok: true, value: { action: 'register', storeId } };
    case 'complete':
      return { ok: true, value: { action: 'complete' } };
    case 'skip': {
      // 「後で設定する」：次のステップ（2〜10）へ進むだけ
      const next = typeof b.next === 'number' && Number.isInteger(b.next) ? b.next : 0;
      if (next < 2 || next > ONBOARDING_STEPS) return { ok: false, error: BAD };
      return { ok: true, value: { action: 'skip', next } };
    }
    default:
      return { ok: false, error: BAD };
  }
}
