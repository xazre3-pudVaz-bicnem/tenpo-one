import { isUuid } from '@/lib/native-pos';
import { CASH_DENOMINATIONS } from '@/lib/cash-count';
import { parsePeriodReportRange } from '@/lib/period-report';
import { parseCheckoutBluetoothLink, type CheckoutBluetoothLink } from '@/lib/checkout-bluetooth';

/**
 * iPad アプリのネイティブのレジ開局・レジクローズとサーバーの決まりごと（2026-10-24 Ronnie「レジの画面は全部ネイティブに」）。
 * 読み込みは GET /api/app/v1/pos?part=cash（lib/native-cash-server.ts）、操作は POST { type: 'cash…' }。
 * 中身は Web のレジ開局・レジクローズと同じ Server Action（app/app/cash/actions.ts）。ここは純粋な型と検証だけ。
 */

/** 金種（"1"〜"10000"）→ 枚数 */
export type NativeDenominations = Record<string, number>;

export type NativeCashAction =
  /** レジ開局（釣銭準備金を金種で数えて開ける） */
  | { type: 'cashOpen'; registerId: string; denominations: NativeDenominations; reason: string | null; clerkName: string | null }
  /** レジクローズ（現金実査して締める。精算レシートが出る） */
  | { type: 'cashClose'; sessionId: string; denominations: NativeDenominations; reason: string | null; clerkName: string | null; bluetoothLink?: CheckoutBluetoothLink }
  /** 精算レシートの再印刷 */
  | { type: 'cashReprint'; sessionId: string; bluetoothLink?: CheckoutBluetoothLink }
  /** 精算情報（釣銭準備金〜金種）だけの紙 */
  | { type: 'cashSettlement'; sessionId: string; bluetoothLink?: CheckoutBluetoothLink }
  /** レジ端末のログアウト（レジクローズのあと。Web の signOutRegister と同じ） */
  | { type: 'cashSignOut' }
  /** 入出金の登録（Web の CashEntryForm と同じ。買い物は 用途の文をアプリで作る＝buildShoppingPurpose） */
  | { type: 'cashEntry'; sessionId: string; kind: 'deposit' | 'withdrawal'; amount: number; purpose: string }
  /** 期間の決算レポート（伝票明細の 昨日・一昨日・今週・今月・日付）をレシートプリンターへ（2026-10-26 Ronnie） */
  | { type: 'periodReport'; from: string; to: string; clerkName: string | null; bluetoothLink?: CheckoutBluetoothLink };

export type NativeCashActionType = NativeCashAction['type'];

export const NATIVE_CASH_ACTION_TYPES: readonly NativeCashActionType[] = ['cashOpen', 'cashClose', 'cashReprint', 'cashSettlement', 'cashSignOut', 'cashEntry', 'periodReport'];

export function isNativeCashActionType(v: unknown): v is NativeCashActionType {
  return typeof v === 'string' && (NATIVE_CASH_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeCashAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};

/** 金種の枚数（金種はレジのトレイの 1〜10000 円だけ。枚数は 0〜1,000,000 の整数）。1つも無ければ null */
export function parseDenominations(raw: unknown): NativeDenominations | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: NativeDenominations = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(k)) return null;
    if (!(CASH_DENOMINATIONS as readonly number[]).includes(Number(k))) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000) return null;
    out[k] = v;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** 金種の枚数 → 合計（Web の sumDenominations と同じ） */
export function sumNativeDenominations(d: NativeDenominations): number {
  return Object.entries(d).reduce((t, [k, n]) => t + Number(k) * n, 0);
}

export function parseNativeCashAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  // この iPad が Bluetooth・USB でつないでいるレシートプリンター（あれば精算レシート・決算レポートをその場で出す。会計と同じ形）
  const link = b.bluetoothLink == null ? null : parseCheckoutBluetoothLink(b.bluetoothLink);
  if (b.bluetoothLink != null && !link) return bad();
  const withLink = link ? { bluetoothLink: link } : {};
  switch (b.type) {
    case 'cashOpen': {
      if (!isUuid(b.registerId)) return bad('レジが正しくありません');
      const denominations = parseDenominations(b.denominations);
      if (!denominations) return bad('釣銭準備金を金種ごとに数えて枚数を入力してください（0円のときは1円に0と入れてください）');
      return { ok: true, action: { type: 'cashOpen', registerId: b.registerId, denominations, reason: str(b.reason, 200), clerkName: str(b.clerkName, 80) } };
    }
    case 'cashClose': {
      if (!isUuid(b.sessionId)) return bad('レジのセッションが正しくありません');
      const denominations = parseDenominations(b.denominations);
      if (!denominations) return bad('金種ごとの枚数を入れてください（0円のときは1円に0と入れてください）');
      return { ok: true, action: { type: 'cashClose', sessionId: b.sessionId, denominations, reason: str(b.reason, 200), clerkName: str(b.clerkName, 80), ...withLink } };
    }
    case 'cashReprint':
    case 'cashSettlement':
      if (!isUuid(b.sessionId)) return bad('レジのセッションが正しくありません');
      return { ok: true, action: { type: b.type, sessionId: b.sessionId, ...withLink } };
    case 'cashSignOut':
      return { ok: true, action: { type: 'cashSignOut' } };
    case 'cashEntry': {
      if (!isUuid(b.sessionId)) return bad('開局中のレジがありません');
      if (b.kind !== 'deposit' && b.kind !== 'withdrawal') return bad();
      if (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount <= 0 || b.amount > 100_000_000) return bad('金額は1円以上の整数で入力してください');
      const purpose = str(b.purpose, 300);
      if (!purpose) return bad('用途を入力してください');
      return { ok: true, action: { type: 'cashEntry', sessionId: b.sessionId, kind: b.kind, amount: b.amount, purpose } };
    }
    case 'periodReport': {
      const range = parsePeriodReportRange(b.from, b.to);
      if (!range.ok) return bad(range.error);
      return { ok: true, action: { type: 'periodReport', from: range.from, to: range.to, clerkName: str(b.clerkName, 80), ...withLink } };
    }
    default:
      return bad();
  }
}
