/**
 * レジの iPad がネット無しで受けた伝票を、ネットが戻ったときにサーバーへ送る形（2026-10-24 Ronnie「net chalepaxi afai sync」）。
 * 1回の送信＝1つの伝票（オフラインで始めた伝票、またはオフラインのあいだに触ったサーバーの伝票）。
 * 同じものを何度送っても二重にならない（サーバーは clientId とそれぞれの行の id で、もう入れたかを覚えている）。
 * ここは形の確認だけ（DB・Next 非依存。tests/native-offline-sync.test.ts）。
 */
import { parseDraft } from './native-floor';
import type { VisitDraft } from './handy-visit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.trim().slice(0, max) : null);

/** オフラインの時刻は「7日前〜少し先」だけ受ける（iPad の時計が大きくずれていたら止める） */
export const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFLINE_CLOCK_SKEW_MS = 10 * 60 * 1000;
const MAX_PRICE = 10_000_000;

export interface OfflineSyncLine {
  clientLineId: string;
  menuItemId: string | null;
  /** 「その他（金額入力）」 */
  custom: { categoryId: string | null; price: number; memo: string | null } | null;
  optionItemIds: string[];
  openPrice: number | null;
  quantity: number;
  /** オフラインで計算してお客様に出した単価（選択肢こみ・税込の表示価格） */
  unitPrice: number;
  at: string;
}

export type OfflineLineRef = { kind: 'server'; lineId: string } | { kind: 'client'; clientLineId: string };

export interface OfflineSyncCancel {
  ref: OfflineLineRef;
  reason: string;
  approvedByClerkId: string | null;
  at: string;
}

export interface OfflineSyncCheckout {
  /** オフラインは現金だけ */
  payments: { method: 'cash'; amount: number; tendered: number }[];
  memo: string;
  at: string;
  /** iPad で計算した会計金額（サーバーの合計と違ったら記録に残す） */
  total: number;
}

export interface OfflineSyncOrder {
  /** iPad が付けた同期の id（オフラインで始めた伝票は off-<uuid> の uuid、サーバーの伝票はオフラインで触りはじめたときの uuid） */
  clientId: string;
  storeId: string;
  /** オフラインのあいだに触ったサーバーの伝票（オフラインで始めた伝票は null） */
  serverOrderId: string | null;
  /** オフラインで始めた伝票の卓と来店登録・始めた時刻 */
  tableId: string | null;
  draft: VisitDraft | null;
  openedAt: string | null;
  /** iPad の伝票番号（OFF-3 など。記録に残す） */
  localNo: string | null;
  /** 来店登録で選んで、まだ厨房へ送っていないプラン商品（未送信の品として入れる） */
  planItemIds: string[];
  clerkId: string | null;
  visitSourceId: string | null;
  lines: OfflineSyncLine[];
  cancels: OfflineSyncCancel[];
  cleared: { reason: string; approvedByClerkId: string | null; at: string } | null;
  checkout: OfflineSyncCheckout | null;
}

function isRecentIso(v: unknown, now: number): v is string {
  if (typeof v !== 'string' || v.length > 40) return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && t >= now - OFFLINE_MAX_AGE_MS && t <= now + OFFLINE_CLOCK_SKEW_MS;
}

function parseLine(v: unknown, now: number): OfflineSyncLine | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (!isUuid(d.clientLineId) || !isInt(d.quantity, 1, 99) || !isInt(d.unitPrice, 0, MAX_PRICE) || !isRecentIso(d.at, now)) return null;
  const optionItemIds = d.optionItemIds ?? [];
  if (!Array.isArray(optionItemIds) || optionItemIds.length > 30 || !optionItemIds.every(isUuid)) return null;
  const openPrice = d.openPrice == null ? null : d.openPrice;
  if (openPrice !== null && !isInt(openPrice, 0, MAX_PRICE)) return null;
  let custom: OfflineSyncLine['custom'] = null;
  if (d.custom != null) {
    const c = d.custom as Record<string, unknown>;
    if (typeof c !== 'object' || !isInt(c.price, 0, MAX_PRICE)) return null;
    const categoryId = c.categoryId == null ? null : c.categoryId;
    if (categoryId !== null && !isUuid(categoryId)) return null;
    custom = { categoryId, price: c.price, memo: str(c.memo, 40) || null };
  }
  const menuItemId = d.menuItemId == null ? null : d.menuItemId;
  if (menuItemId !== null && !isUuid(menuItemId)) return null;
  if (!custom && !menuItemId) return null;
  return { clientLineId: d.clientLineId, menuItemId: custom ? null : menuItemId, custom, optionItemIds: [...new Set(optionItemIds as string[])], openPrice, quantity: d.quantity, unitPrice: d.unitPrice, at: d.at };
}

function parseCancel(v: unknown, now: number): OfflineSyncCancel | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const r = d.ref as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !isRecentIso(d.at, now)) return null;
  let ref: OfflineLineRef;
  if (r.kind === 'server' && isUuid(r.lineId)) ref = { kind: 'server', lineId: r.lineId };
  else if (r.kind === 'client' && isUuid(r.clientLineId)) ref = { kind: 'client', clientLineId: r.clientLineId };
  else return null;
  const approver = d.approvedByClerkId == null ? null : d.approvedByClerkId;
  if (approver !== null && !isUuid(approver)) return null;
  return { ref, reason: str(d.reason, 200) ?? '', approvedByClerkId: approver, at: d.at };
}

export type ParsedOfflineSync = { ok: true; order: OfflineSyncOrder } | { ok: false; error: string };

/** POST { type: 'offlineSync', order } の中身を確かめる */
export function parseOfflineSync(raw: unknown, now = Date.now()): ParsedOfflineSync {
  const bad = (error: string): ParsedOfflineSync => ({ ok: false, error });
  if (!raw || typeof raw !== 'object') return bad('内容が正しくありません');
  const d = (raw as { order?: unknown }).order as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return bad('内容が正しくありません');
  if (!isUuid(d.clientId) || !isUuid(d.storeId)) return bad('伝票の id が正しくありません');
  const serverOrderId = d.serverOrderId == null ? null : d.serverOrderId;
  if (serverOrderId !== null && !isUuid(serverOrderId)) return bad('伝票の id が正しくありません');
  const tableId = d.tableId == null ? null : d.tableId;
  if (tableId !== null && !isUuid(tableId)) return bad('卓が正しくありません');
  let draft: VisitDraft | null = null;
  let openedAt: string | null = null;
  if (!serverOrderId) {
    if (!tableId) return bad('オフラインで始めた伝票に卓がありません');
    draft = parseDraft(d.draft);
    if (!draft) return bad('来店登録の内容が正しくありません');
    if (!isRecentIso(d.openedAt, now)) return bad('始めた時刻が正しくありません');
    openedAt = d.openedAt;
  }
  const planItemIds = d.planItemIds ?? [];
  if (!Array.isArray(planItemIds) || planItemIds.length > 30 || !planItemIds.every(isUuid)) return bad('プラン商品が正しくありません');
  const clerkId = d.clerkId == null ? null : d.clerkId;
  if (clerkId !== null && !isUuid(clerkId)) return bad('担当者が正しくありません');
  const visitSourceId = d.visitSourceId == null ? null : str(d.visitSourceId, 40);
  const lines = Array.isArray(d.lines) ? d.lines : [];
  const cancels = Array.isArray(d.cancels) ? d.cancels : [];
  if (lines.length > 300 || cancels.length > 300) return bad('品が多すぎます');
  const parsedLines = lines.map((l) => parseLine(l, now));
  if (parsedLines.some((l) => !l)) return bad('品の内容が正しくありません（時刻・数・金額）');
  const parsedCancels = cancels.map((c) => parseCancel(c, now));
  if (parsedCancels.some((c) => !c)) return bad('取消の内容が正しくありません');

  let cleared: OfflineSyncOrder['cleared'] = null;
  if (d.cleared != null) {
    const c = d.cleared as Record<string, unknown>;
    const approver = c?.approvedByClerkId == null ? null : c.approvedByClerkId;
    if (typeof c !== 'object' || !isRecentIso(c.at, now) || (approver !== null && !isUuid(approver))) return bad('テーブルクリアの内容が正しくありません');
    cleared = { reason: str(c.reason, 200) ?? '', approvedByClerkId: approver, at: c.at as string };
  }
  let checkout: OfflineSyncCheckout | null = null;
  if (d.checkout != null) {
    const c = d.checkout as Record<string, unknown>;
    if (typeof c !== 'object' || !isRecentIso(c.at, now) || !isInt(c.total, 0, MAX_PRICE) || !Array.isArray(c.payments) || c.payments.length === 0 || c.payments.length > 5) {
      return bad('会計の内容が正しくありません');
    }
    const payments: OfflineSyncCheckout['payments'] = [];
    for (const p of c.payments as Record<string, unknown>[]) {
      if (!p || p.method !== 'cash' || !isInt(p.amount, 0, MAX_PRICE) || !isInt(p.tendered, 0, MAX_PRICE) || (p.tendered as number) < (p.amount as number)) {
        return bad('オフラインの会計は現金だけです');
      }
      payments.push({ method: 'cash', amount: p.amount as number, tendered: p.tendered as number });
    }
    checkout = { payments, memo: str(c.memo, 200) ?? '', at: c.at as string, total: c.total as number };
  }
  if (cleared && checkout) return bad('会計とテーブルクリアは同時にできません');

  return {
    ok: true,
    order: {
      clientId: d.clientId,
      storeId: d.storeId,
      serverOrderId,
      tableId,
      draft,
      openedAt,
      localNo: str(d.localNo, 20) || null,
      planItemIds: serverOrderId ? [] : (planItemIds as string[]),
      clerkId,
      visitSourceId: visitSourceId || null,
      lines: parsedLines as OfflineSyncLine[],
      cancels: parsedCancels as OfflineSyncCancel[],
      cleared,
      checkout,
    },
  };
}

/**
 * iPad で受け取った金額とサーバーの合計の差を、端数調整で合わせてよいか（税の端数・時間帯の値段のずれくらい）。
 * ¥200 か 合計の5% の大きい方まで。それより大きいときは人が見る
 */
export function offlineRoundingAllowed(serverTotal: number, ipadTotal: number): boolean {
  return Math.abs(ipadTotal - serverTotal) <= Math.max(200, Math.round(ipadTotal * 0.05));
}

/** 会計の支払い（お預かりは足りる分だけ。足りなければ null＝人に見てもらう） */
export function offlineCashPayments(serverTotal: number, checkout: OfflineSyncCheckout): { method: 'cash'; amount: number; tendered: number }[] | null {
  const tendered = checkout.payments.reduce((a, p) => a + p.tendered, 0);
  if (tendered < serverTotal) return null;
  return [{ method: 'cash', amount: serverTotal, tendered }];
}
