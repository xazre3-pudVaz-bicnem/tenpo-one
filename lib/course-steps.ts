/**
 * コースの料理（出す順）。純関数・テスト対象。
 *
 * コースは「コース」種別の商品（menu_items.item_type = 'course'）で、これまで厨房伝票にはコースの名前しか出なかった。
 * 店ごとに「このコースは前菜→サラダ→ポテト→…の順に出す」と決められるようにして、
 * コースを注文すると厨房伝票に 1st / 2nd / 3rd … と料理が順番に出る（2026-10-03 御茶ノ水 Miyazaki の要望・全店共通）。
 *
 * 保存先は店舗設定 store_settings.settings.courseSteps（DB の変更なしで全店・今後の店にも効く）:
 *   { [コースの menu_items.id]: [料理の menu_items.id, ...] }（配列の順が出す順）
 * 料理はその店のメニューにある商品から選ぶ。店によって登録してある料理が違っても、あるものから選べば動く。
 * 選んだ料理があとで削除されたら、その料理は飛ばして残りを順に出す（伝票は止まらない）。
 */
import type { ClaimedKitchenItem } from './kitchen-ticket';

/** 1つのコースに入れられる料理の数（暴走防止） */
export const MAX_COURSE_STEPS = 30;

export type CourseSteps = Record<string, string[]>;

/** 料理の id の並びを整える（文字列だけ・重複なし・上限まで。順番はそのまま） */
export function normalizeStepIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of ids) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_COURSE_STEPS) break;
  }
  return out;
}

/** store_settings.settings から コースの料理（出す順）を読む。未設定・壊れた値は空（これまでどおりコース名だけ出す） */
export function courseStepsFrom(settings: unknown): CourseSteps {
  const raw = (settings as { courseSteps?: unknown } | null)?.courseSteps;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: CourseSteps = {};
  for (const [courseId, ids] of Object.entries(raw as Record<string, unknown>)) {
    const list = normalizeStepIds(ids);
    if (list.length > 0) out[courseId] = list;
  }
  return out;
}

/** 展開に使う料理の情報（menu_items から読む） */
export interface CourseDish {
  id: string;
  name: string;
  nameEn: string | null;
  nameKana: string | null;
}

/**
 * claim_kitchen_items の行のうち、コースの行を「料理の行」に置き換える。
 *   - 料理の数はコースの数量どおり（差分 delta をそのまま使う。コース3名分なら各料理 x3、取消なら各料理が取消）
 *   - 選択肢（メイン選択など）とメモはコースの注文のものを全部の料理に付ける（アレルギーなどを落とさない）
 *   - 料理が1つも見つからないコース（全部削除された等）は、そのままコースの行で出す
 * menuItemIdByOrderItem: 明細 id → 商品 id（order_items.menu_item_id）
 */
export function expandCourseRows(
  rows: ClaimedKitchenItem[],
  menuItemIdByOrderItem: ReadonlyMap<string, string | null>,
  steps: CourseSteps,
  dishes: ReadonlyMap<string, CourseDish>
): ClaimedKitchenItem[] {
  const out: ClaimedKitchenItem[] = [];
  for (const r of rows) {
    const menuItemId = r.order_item_id ? menuItemIdByOrderItem.get(r.order_item_id) : null;
    const wanted = menuItemId ? steps[menuItemId] : undefined;
    const found = wanted ? wanted.map((id) => dishes.get(id)).filter((d): d is CourseDish => !!d) : [];
    if (found.length === 0) {
      out.push(r);
      continue;
    }
    const course = r.item_name_en?.trim() || r.item_name;
    found.forEach((d, i) => {
      out.push({
        ...r,
        item_name: d.name,
        item_name_en: d.nameEn,
        item_name_kana: d.nameKana,
        course_step: { index: i + 1, total: found.length, course },
      });
    });
  }
  return out;
}
