import { isUuid } from '@/lib/native-pos';
import {
  DEFAULT_VISIT_DRAFT,
  HANDY_PLANS,
  isPlanList,
  isStartHm,
  MAX_GUESTS,
  VISIT_SOURCE_LABELS,
  type HandyPlan,
  type VisitDraft,
} from '@/lib/handy-visit';
import type { SeatTimeInput } from '@/app/app/pos/actions';

/**
 * iPad アプリのネイティブのフロア（テーブル一覧）画面とサーバーの決まりごと（2026-10-24 Ronnie「レジは全部ネイティブに」）。
 * 画面の読み込みは GET /api/app/v1/pos?part=floor（lib/native-floor-server.ts）、操作は POST { type: 'floor…' }。
 * 中身は Web のテーブル一覧と同じサーバーの処理（app/app/floor/actions.ts・app/app/pos/actions.ts）をそのまま使う。
 * ここは純粋な型と検証だけ（DB・Next 非依存・テスト対象）。
 */

export type NativeFloorAction =
  /** 空席の卓にお客様を通す（お客様情報を入れて伝票を立てる。レジのファーストオーダーと同じ） */
  | { type: 'floorStart'; tableId: string; draft: VisitDraft }
  /** 着席中の卓の伝票を開く（無ければ 1 名で立てる） */
  | { type: 'floorOrder'; tableId: string }
  | { type: 'floorCleaned'; tableId: string }
  | { type: 'floorBlock'; tableId: string; unavailable: boolean }
  | { type: 'floorGroup'; tableIds: string[] }
  | { type: 'floorMerge'; targetOrderId: string; sourceOrderId: string }
  | { type: 'floorGuests'; orderId: string; guestCount: number }
  | { type: 'floorMemo'; orderId: string; memo: string }
  | { type: 'floorSeatTime'; orderId: string; input: SeatTimeInput }
  | { type: 'floorBill'; orderId: string }
  /** レシートの再発行（CloudPRNT・LAN のレシートプリンターへ。Bluetooth は iPad が直前のレシートをもう一度送る） */
  | { type: 'floorReceipt'; orderId: string }
  | { type: 'floorExpo'; orderId: string }
  | { type: 'floorPrintSelected'; orderId: string; itemIds: string[] }
  | { type: 'floorClear'; orderId: string; reason: string; approvedByClerkId: string | null }
  | { type: 'floorCall'; callId: string }
  /** 清掃中のまま時間が過ぎた卓を空席に戻す（画面を開いている iPad が 1 分ごとに呼ぶ） */
  | { type: 'floorRelease'; storeId: string }
  // ここから、オーダー画面の「伝票の操作」（2026-10-24 Ronnie「会計のとき Web に飛ばない。全部ネイティブで」）
  /** 同じ卓に空の伝票をもう1枚 */
  | { type: 'floorNewSlip'; orderId: string }
  /** 伝票を別の空席の卓へ */
  | { type: 'floorMove'; orderId: string; tableId: string }
  /** 品目のない伝票の取消（理由・店長の承認） */
  | { type: 'floorCancelEmpty'; orderId: string; reason: string; approvedByClerkId: string | null }
  /** ホームの「ドロアオープン」 */
  | { type: 'floorDrawer'; storeId: string };

export type NativeFloorActionType = NativeFloorAction['type'];

export const NATIVE_FLOOR_ACTION_TYPES: readonly NativeFloorActionType[] = [
  'floorStart',
  'floorOrder',
  'floorCleaned',
  'floorBlock',
  'floorGroup',
  'floorMerge',
  'floorGuests',
  'floorMemo',
  'floorSeatTime',
  'floorBill',
  'floorReceipt',
  'floorExpo',
  'floorPrintSelected',
  'floorClear',
  'floorCall',
  'floorRelease',
  'floorNewSlip',
  'floorMove',
  'floorCancelEmpty',
  'floorDrawer',
];

export function isNativeFloorActionType(v: unknown): v is NativeFloorActionType {
  return typeof v === 'string' && (NATIVE_FLOOR_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeFloorAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** お客様情報（来店登録）の中身。形だけ見る（範囲・組み合わせはサーバーの validateVisitDraft が見る） */
function parseDraft(raw: unknown): VisitDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const plans = d.plans ?? DEFAULT_VISIT_DRAFT.plans;
  if (!isPlanList(plans)) return null;
  const planItemIds = d.planItemIds ?? [];
  if (!Array.isArray(planItemIds) || planItemIds.length > 30 || !planItemIds.every(isUuid)) return null;
  if (!isInt(d.male, 0, MAX_GUESTS) || !isInt(d.female, 0, MAX_GUESTS)) return null;
  const source = typeof d.source === 'string' ? d.source : '';
  if (source && !VISIT_SOURCE_LABELS.includes(source)) return null;
  const timed = d.timed === true;
  const duration = d.duration ?? DEFAULT_VISIT_DRAFT.duration;
  if (!isInt(duration, 0, 24 * 60)) return null;
  const warningEnabled = d.warningEnabled === undefined ? DEFAULT_VISIT_DRAFT.warningEnabled : d.warningEnabled === true;
  const warningMinutes = d.warningMinutes ?? DEFAULT_VISIT_DRAFT.warningMinutes;
  if (!isInt(warningMinutes, 0, 24 * 60)) return null;
  const startTime = d.startTime == null ? null : d.startTime;
  if (startTime !== null && !isStartHm(startTime)) return null;
  return {
    plans: [...new Set(plans as HandyPlan[])].filter((p) => HANDY_PLANS.some((h) => h.id === p)),
    planItemIds: [...new Set(planItemIds as string[])],
    male: d.male as number,
    female: d.female as number,
    source,
    timed,
    duration: duration as number,
    warningEnabled,
    warningMinutes: warningMinutes as number,
    startTime,
  };
}

/** お客様情報（席の時間・コース・人数・モード）の中身 */
function parseSeatTime(raw: unknown): SeatTimeInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const i = raw as Record<string, unknown>;
  const startTime = i.startTime == null ? null : i.startTime;
  if (startTime !== null && !isStartHm(startTime)) return null;
  const durationMinutes = i.durationMinutes == null ? null : i.durationMinutes;
  if (durationMinutes !== null && !isInt(durationMinutes, 1, 24 * 60)) return null;
  const courseId = i.courseId == null || i.courseId === '' ? null : i.courseId;
  if (courseId !== null && !isUuid(courseId)) return null;
  const guestCount = i.guestCount == null ? null : i.guestCount;
  if (guestCount !== null && !isInt(guestCount, 1, MAX_GUESTS)) return null;
  const plans = i.plans == null ? null : i.plans;
  if (plans !== null && !isPlanList(plans)) return null;
  const planItemIds = i.planItemIds ?? [];
  if (!Array.isArray(planItemIds) || planItemIds.length > 30 || !planItemIds.every(isUuid)) return null;
  return {
    startTime,
    durationMinutes: durationMinutes as number | null,
    courseId: courseId as string | null,
    guestCount: guestCount as number | null,
    plans: plans as HandyPlan[] | null,
    planItemIds: [...new Set(planItemIds as string[])],
  };
}

/** アプリから来たフロアの操作を確かめる（知らない形・範囲外の値は受け付けない） */
export function parseNativeFloorAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'floorStart': {
      if (!isUuid(b.tableId)) return bad();
      const draft = parseDraft(b.draft);
      if (!draft) return bad('お客様情報を確認してください');
      return { ok: true, action: { type: 'floorStart', tableId: b.tableId, draft } };
    }
    case 'floorOrder':
    case 'floorCleaned':
      if (!isUuid(b.tableId)) return bad();
      return { ok: true, action: { type: b.type, tableId: b.tableId } };
    case 'floorBlock':
      if (!isUuid(b.tableId) || typeof b.unavailable !== 'boolean') return bad();
      return { ok: true, action: { type: 'floorBlock', tableId: b.tableId, unavailable: b.unavailable } };
    case 'floorGroup': {
      const ids = b.tableIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || !ids.every(isUuid)) return bad();
      return { ok: true, action: { type: 'floorGroup', tableIds: [...new Set(ids as string[])] } };
    }
    case 'floorMerge':
      if (!isUuid(b.targetOrderId) || !isUuid(b.sourceOrderId) || b.targetOrderId === b.sourceOrderId) return bad();
      return { ok: true, action: { type: 'floorMerge', targetOrderId: b.targetOrderId, sourceOrderId: b.sourceOrderId } };
    case 'floorGuests':
      if (!isUuid(b.orderId) || !isInt(b.guestCount, 1, MAX_GUESTS)) return bad('人数は1〜999名で入力してください');
      return { ok: true, action: { type: 'floorGuests', orderId: b.orderId, guestCount: b.guestCount } };
    case 'floorMemo': {
      if (!isUuid(b.orderId) || typeof b.memo !== 'string') return bad();
      return { ok: true, action: { type: 'floorMemo', orderId: b.orderId, memo: b.memo.slice(0, 200) } };
    }
    case 'floorSeatTime': {
      if (!isUuid(b.orderId)) return bad();
      const input = parseSeatTime(b.input);
      if (!input) return bad('お客様情報を確認してください');
      return { ok: true, action: { type: 'floorSeatTime', orderId: b.orderId, input } };
    }
    case 'floorBill':
    case 'floorReceipt':
    case 'floorExpo':
      if (!isUuid(b.orderId)) return bad();
      return { ok: true, action: { type: b.type, orderId: b.orderId } };
    case 'floorPrintSelected': {
      const ids = b.itemIds;
      if (!isUuid(b.orderId) || !Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every(isUuid)) return bad();
      return { ok: true, action: { type: 'floorPrintSelected', orderId: b.orderId, itemIds: [...new Set(ids as string[])] } };
    }
    case 'floorClear': {
      if (!isUuid(b.orderId)) return bad();
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : '';
      const approver = b.approvedByClerkId == null ? null : b.approvedByClerkId;
      if (approver !== null && !isUuid(approver)) return bad();
      return { ok: true, action: { type: 'floorClear', orderId: b.orderId, reason, approvedByClerkId: approver as string | null } };
    }
    case 'floorCall':
      if (!isUuid(b.callId)) return bad();
      return { ok: true, action: { type: 'floorCall', callId: b.callId } };
    case 'floorRelease':
    case 'floorDrawer':
      if (!isUuid(b.storeId)) return bad();
      return { ok: true, action: { type: b.type, storeId: b.storeId } };
    case 'floorNewSlip':
      if (!isUuid(b.orderId)) return bad();
      return { ok: true, action: { type: 'floorNewSlip', orderId: b.orderId } };
    case 'floorMove':
      if (!isUuid(b.orderId) || !isUuid(b.tableId)) return bad();
      return { ok: true, action: { type: 'floorMove', orderId: b.orderId, tableId: b.tableId } };
    case 'floorCancelEmpty': {
      if (!isUuid(b.orderId)) return bad();
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : '';
      if (!reason) return bad('取消理由を入力してください');
      const approver = b.approvedByClerkId == null ? null : b.approvedByClerkId;
      if (approver !== null && !isUuid(approver)) return bad();
      return { ok: true, action: { type: 'floorCancelEmpty', orderId: b.orderId, reason, approvedByClerkId: approver as string | null } };
    }
    default:
      return bad();
  }
}
