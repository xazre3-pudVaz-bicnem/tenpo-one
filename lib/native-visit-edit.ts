import { isUuid } from '@/lib/native-pos';
import { parseDraft } from '@/lib/native-floor';
import { HANDY_PLANS, type HandyPlan, type VisitDraft } from '@/lib/handy-visit';

/**
 * 着席中の「お客様情報」を、来店登録（お客様情報の確定）と同じ画面で直す（2026-10-24 Ronnie
 * 「manxe ko tauko ma click garda aaune popup start ko jastai sabai 変更 garna milne、same popup」）。
 * 読み込み GET /api/app/v1/pos?part=visitEdit&orderId=…（伝票メモから男女・来店経路・時間制・終了前注意を読む）、
 * 保存 POST { type: 'visitEdit', orderId, draft, courseId }。中身は Web と同じ setSeatTime（開始・時間・人数・モード・プラン・コース）、
 * 来店経路は setOrderVisitSource、伝票メモは visitMemo（来店登録と同じ書き方）で書き直す。
 * ここは純粋な型と検証だけ（DB・Next 非依存・テスト対象）。
 */

export interface NativeVisitEdit {
  type: 'visitEdit';
  orderId: string;
  draft: VisitDraft;
  /** 席のコース（今のまま渡す。コースのプランを選んだらそれ）。null はコースなし */
  courseId: string | null;
}

export function isNativeVisitEditType(v: unknown): v is NativeVisitEdit['type'] {
  return v === 'visitEdit';
}

export function parseNativeVisitEdit(raw: unknown): { ok: true; action: NativeVisitEdit } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (b.type !== 'visitEdit' || !isUuid(b.orderId)) return { ok: false, error: '内容が正しくありません' };
  const draft = parseDraft(b.draft);
  if (!draft) return { ok: false, error: 'お客様情報を確認してください' };
  if (draft.male + draft.female < 1) return { ok: false, error: '人数を入れてください' };
  const courseId = b.courseId == null || b.courseId === '' ? null : b.courseId;
  if (courseId !== null && !isUuid(courseId)) return { ok: false, error: '内容が正しくありません' };
  return { ok: true, action: { type: 'visitEdit', orderId: b.orderId as string, draft, courseId: courseId as string | null } };
}

/** 伝票メモから読めたお客様情報（読めないものは null） */
export interface VisitFromMemo {
  plans: HandyPlan[] | null;
  male: number | null;
  female: number | null;
  source: string | null;
  timed: boolean;
  duration: number | null;
  warningEnabled: boolean;
  warningMinutes: number | null;
}

const PREFIX = 'ハンディ: ';

/** 「2時間」「1時間30分」「45分」→ 分（lib/handy-visit の durationLabel の逆） */
export function minutesFromLabel(label: string): number | null {
  const m = /^(?:(\d+)時間)?(?:(\d+)分)?$/.exec(label.trim());
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

/**
 * 伝票メモ「ハンディ: 飲み放題・アラカルト / 男2・女1 / 食べログ / 2時間制（30分前に声かけ）」を読む（visitMemo の逆）。
 * 来店登録で入れた伝票でなければ null
 */
export function visitFromMemo(memo: string | null | undefined): VisitFromMemo | null {
  if (!memo || !memo.startsWith(PREFIX)) return null;
  const parts = memo.slice(PREFIX.length).split(' / ');
  const out: VisitFromMemo = {
    plans: null,
    male: null,
    female: null,
    source: null,
    timed: false,
    duration: null,
    warningEnabled: false,
    warningMinutes: null,
  };
  const names = (parts[0] ?? '').split('・').filter(Boolean);
  const plans = names.map((n) => HANDY_PLANS.find((p) => p.name === n)?.id).filter((p): p is HandyPlan => !!p);
  if (plans.length > 0 && plans.length === names.length) out.plans = plans;
  for (const part of parts.slice(1)) {
    const g = /^男(\d+)・女(\d+)$/.exec(part);
    if (g) {
      out.male = Number(g[1]);
      out.female = Number(g[2]);
      continue;
    }
    const t = /^(.+?)制(?:（(.+?)前に声かけ）)?$/.exec(part);
    const tm = t ? minutesFromLabel(t[1]) : null;
    if (t && tm !== null) {
      out.timed = true;
      out.duration = tm;
      const w = t[2] ? minutesFromLabel(t[2]) : null;
      out.warningEnabled = w !== null;
      out.warningMinutes = w;
      continue;
    }
    if (part.trim() && out.source === null) out.source = part.trim();
  }
  return out;
}
