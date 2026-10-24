import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { saveCategory, saveCourseSteps, saveMenuItem } from '@/app/app/settings/menu/actions';
import { addOptionItem, createOptionGroup, deleteOptionGroup, deleteOptionItem, setGroupMenuItems, updateOptionGroup } from '@/app/app/settings/options/actions';
import { saveMenuBookPages, saveMenuBookPlans } from '@/app/app/settings/menu-book/actions';
import { courseStepsFrom, MAX_COURSE_STEPS } from '@/lib/course-steps';
import { menuBookFrom, menuBookPages, planCategoryIds, STANDARD_MENU_PAGES } from '@/lib/menu-book';
import {
  choicesChanged,
  COURSE_DISH_CATEGORY_NAME,
  COURSE_MAIN_GROUP_NAME,
  courseMainGroupsFrom,
  defaultCategoryFor,
  MAX_MAIN_CHOICES,
  planKindOf,
  pickCourseMainGroup,
  reuseDishesByName,
  type CourseBuilderInput,
  type CourseStepInput,
} from '@/lib/course-builder';

/**
 * iPad の 設定 › プラン の「コース／放題プランを作る」（lib/course-builder.ts の説明を参照）。
 * 中身は Web と同じ Server Action を順に呼ぶ：
 *   saveMenuItem（コース本体）→ 料理（¥0・非表示の商品を作る）→ saveCourseSteps（出す順）
 *   → 選べるメイン（createOptionGroup / updateOptionGroup / addOptionItem / deleteOptionItem / setGroupMenuItems）
 *   → saveMenuBookPlans（プランで出すカテゴリ）
 * 権限は menu.manage（コース・料理・出す順）。選べるメインは store.settings（オプションの Server Action が見る）。
 * コース本体を保存できたあとの失敗は、エラーにせず warning で返す（コースを二重に作らないように。iPad は id を受け取って編集を続ける）。
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Ctx = Awaited<ReturnType<typeof requirePermission>>;

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/* ------------------------------------------------------------ 読み込み（GET ?part=menuItems に足す分） */

export interface CourseBuilderExtras {
  /** コースID → 料理（出す順。メニューから消えた料理は出さない） */
  courseSteps: Record<string, { id: string; name: string; hidden: boolean }[]>;
  /** コースID → 選べるメイン（必須・1つ選ぶ選択肢グループ） */
  courseMains: Record<string, { groupId: string; name: string; choices: { id: string; name: string; price: number }[] }>;
  /** プランID → プランで出すカテゴリ（指定の無いプランは入らない＝プランのときだけのカテゴリを全部） */
  planCategories: Record<string, string[]>;
  /** 出し方が「プランのときだけ」のカテゴリ（飲み放題の F など）。プランの画面で先に並べる */
  planOnlyCategoryIds: string[];
  maxCourseSteps: number;
  maxMainChoices: number;
  /** 選べるメインを変えられる（オプションの権限 store.settings） */
  canEditOptions: boolean;
}

export async function loadCourseBuilderExtras(
  ctx: SessionContext,
  supabase: Supabase,
  storeId: string,
  data: {
    categories: { id: string; name: string }[];
    items: { id: string; name: string; categoryId: string | null; price: number; itemType: string; status: string }[];
  }
): Promise<CourseBuilderExtras> {
  const [{ data: settingsRow }, { data: links }] = await Promise.all([
    supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle(),
    supabase
      .from('menu_item_option_groups')
      .select('menu_item_id, menu_option_groups!inner(id, name, status, menu_option_items(id, name, price, sort_order, status))')
      .eq('store_id', storeId),
  ]);
  const settings = (settingsRow as { settings?: unknown } | null)?.settings ?? null;
  const itemsById = new Map(data.items.map((i) => [i.id, i]));
  const courseIds = data.items.filter((i) => i.itemType === 'course').map((i) => i.id);
  const isCourse = new Set(courseIds);

  const steps = courseStepsFrom(settings);
  const courseSteps: CourseBuilderExtras['courseSteps'] = {};
  for (const id of courseIds) {
    const list = (steps[id] ?? [])
      .map((d) => itemsById.get(d))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .map((d) => ({ id: d.id, name: d.name, hidden: d.status === 'hidden' }));
    if (list.length > 0) courseSteps[id] = list;
  }

  type G = { id: string; name: string; status: string; menu_option_items?: { id: string; name: string; price: number | null; sort_order: number | null; status: string }[] };
  const groupsByCourse = new Map<string, G[]>();
  for (const l of (links ?? []) as { menu_item_id: string; menu_option_groups: G | G[] | null }[]) {
    if (!isCourse.has(l.menu_item_id)) continue;
    const g = one(l.menu_option_groups);
    if (!g || (g.status && g.status !== 'active')) continue;
    const list = groupsByCourse.get(l.menu_item_id) ?? [];
    if (!list.some((x) => x.id === g.id)) list.push(g);
    groupsByCourse.set(l.menu_item_id, list);
  }
  const saved = courseMainGroupsFrom(settings);
  const courseMains: CourseBuilderExtras['courseMains'] = {};
  for (const [courseId, groups] of groupsByCourse) {
    const g = pickCourseMainGroup(courseId, saved, groups);
    if (!g) continue;
    courseMains[courseId] = {
      groupId: g.id,
      name: g.name,
      choices: (g.menu_option_items ?? [])
        .filter((o) => o.status === 'active')
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((o) => ({ id: o.id, name: o.name, price: Number(o.price ?? 0) })),
    };
  }

  const book = menuBookFrom(settings);
  const planCategories: Record<string, string[]> = {};
  for (const id of courseIds) if (book.plans[id]) planCategories[id] = book.plans[id];
  const active = data.items.filter((i) => i.status === 'active').map((i) => ({ categoryId: i.categoryId, name: i.name, price: i.price, itemType: i.itemType }));

  return {
    courseSteps,
    courseMains,
    planCategories,
    planOnlyCategoryIds: [...planCategoryIds(data.categories, active, book)],
    maxCourseSteps: MAX_COURSE_STEPS,
    maxMainChoices: MAX_MAIN_CHOICES,
    canEditOptions: can(ctx.role, 'store.settings'),
  };
}

/* ------------------------------------------------------------ 保存（POST courseBuilderSave） */

export type CourseBuilderResult =
  | { ok: true; data: { courseId: string; dishIds: string[]; mainGroupId: string | null; warning?: string } }
  | { ok: false; error: string };

/** 名前でカテゴリを探し、無ければ作る（saveCategory。作ったかどうかも返す） */
async function ensureCategory(ctx: Ctx, supabase: Supabase, storeId: string, name: string, nameEn: string): Promise<{ id: string; created: boolean } | { error: string }> {
  const find = async (): Promise<string | null> => {
    const { data } = await supabase
      .from('menu_categories')
      .select('id, store_id')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .eq('name', name)
      .order('sort_order')
      .limit(5);
    const rows = (data ?? []) as { id: string; store_id: string | null }[];
    // この店のカテゴリを先に（全店共通の同名カテゴリより）
    return (rows.find((r) => r.store_id === storeId) ?? rows[0])?.id ?? null;
  };
  const found = await find();
  if (found) return { id: found, created: false };
  const { data: last } = await supabase
    .from('menu_categories')
    .select('sort_order')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .or(`store_id.is.null,store_id.eq.${storeId}`)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = await saveCategory({ storeId, name, nameEn, color: '#2563EB', sortOrder: Number(last?.sort_order ?? 0) + 10 });
  if (r.error) return { error: r.error };
  const id = await find();
  return id ? { id, created: true } : { error: `カテゴリ「${name}」を作れませんでした` };
}

/** 作ったカテゴリを上のタブ（メニューブックのページ）に入れる。決めてあれば変えない。うまくいかなくても止めない（自動の振り分けのまま） */
async function pinCategoryPage(supabase: Supabase, ctx: Ctx, storeId: string, categoryId: string, pageKey: string): Promise<void> {
  const [{ data: row }, { data: cats }] = await Promise.all([
    supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle(),
    supabase.from('menu_categories').select('id').eq('organization_id', ctx.organizationId).eq('status', 'active').or(`store_id.is.null,store_id.eq.${storeId}`),
  ]);
  const book = menuBookFrom((row as { settings?: unknown } | null)?.settings ?? null);
  if (book.categoryPage[categoryId]) return;
  const pages = book.pages.length > 0 ? book.pages : STANDARD_MENU_PAGES.map((p) => ({ key: p.key, name: p.name }));
  if (!menuBookPages({ pages }).some((p) => p.key === pageKey)) return;
  const live = new Set(((cats ?? []) as { id: string }[]).map((c) => c.id));
  const categoryPage: Record<string, string> = {};
  for (const [id, key] of Object.entries(book.categoryPage)) if (live.has(id)) categoryPage[id] = key;
  categoryPage[categoryId] = pageKey;
  const r = await saveMenuBookPages(storeId, { pages, categoryPage });
  if (r.error) console.warn('[course-builder] page pin skipped:', r.error);
}

/**
 * 料理の行を商品IDにする。メニューから選んだ行はそのまま。名前だけの行は「コースの料理」カテゴリの同じ名前の商品を使い、
 * 無ければ ¥0・非表示のフードとしてまとめて作る（1回の insert。途中で半分だけ作られないように）
 */
async function resolveDishes(ctx: Ctx, supabase: Supabase, storeId: string, steps: readonly CourseStepInput[]): Promise<{ ids: string[] } | { error: string }> {
  const newNames = steps.filter((s) => !s.dishId).map((s) => s.name);
  const idByName = new Map<string, string>();
  if (newNames.length > 0) {
    const cat = await ensureCategory(ctx, supabase, storeId, COURSE_DISH_CATEGORY_NAME, 'Course dishes');
    if ('error' in cat) return cat;
    const { data: existing, error } = await supabase
      .from('menu_items')
      .select('id, name, item_type, sort_order')
      .eq('organization_id', ctx.organizationId)
      .eq('category_id', cat.id)
      .neq('status', 'deleted')
      .or(`store_id.is.null,store_id.eq.${storeId}`);
    if (error) return { error: `料理の読み込みに失敗しました: ${error.message}` };
    const rows = (existing ?? []) as { id: string; name: string; item_type: string; sort_order: number | null }[];
    for (const [n, id] of reuseDishesByName(newNames, rows.filter((r) => r.item_type !== 'course' && r.item_type !== 'option'))) idByName.set(n, id);
    const toCreate = newNames.filter((n) => !idByName.has(n));
    if (toCreate.length > 0) {
      const base = rows.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), 0) + 10;
      const { data: created, error: insErr } = await supabase
        .from('menu_items')
        .insert(
          toCreate.map((name, i) => ({
            organization_id: ctx.organizationId,
            store_id: storeId,
            category_id: cat.id,
            name,
            item_type: 'food',
            price: 0,
            // コースの値段に入っている料理なので ¥0 のまま（「価格未設定」の印は付けない）
            price_pending: false,
            // 非表示：レジ・ハンディ・お客様QRに単品で出さない（厨房伝票には出る。lib/print-queue.ts は削除以外を読む）
            status: 'hidden',
            sort_order: base + i * 10,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          }))
        )
        .select('id, name');
      if (insErr) return { error: `料理の追加に失敗しました: ${insErr.message}` };
      for (const r of (created ?? []) as { id: string; name: string }[]) if (!idByName.has(r.name)) idByName.set(r.name, r.id);
      await supabase.rpc('log_audit', {
        p_org: ctx.organizationId,
        p_store: storeId,
        p_action: 'settings.menu.course_dishes_add',
        p_target_table: 'menu_items',
        p_target_id: cat.id,
        p_before: null,
        p_after: { names: toCreate, price: 0, status: 'hidden' },
        p_note: null,
      });
    }
  }
  const ids = steps.map((s) => s.dishId ?? idByName.get(s.name) ?? null);
  if (ids.some((id) => !id)) return { error: '料理の保存に失敗しました。画面を開き直してください' };
  return { ids: ids as string[] };
}

/** store_settings.settings.courseMainGroups にコースの選べるメインのグループを残す（null で外す） */
async function writeCourseMainGroup(ctx: Ctx, supabase: Supabase, storeId: string, courseId: string, groupId: string | null): Promise<void> {
  const { data: row } = await supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const current = ((row as { settings?: unknown } | null)?.settings as Record<string, unknown> | null) ?? {};
  const map = courseMainGroupsFrom(current);
  if (groupId) map[courseId] = groupId;
  else delete map[courseId];
  const next: Record<string, unknown> = { ...current };
  if (Object.keys(map).length > 0) next.courseMainGroups = map;
  else delete next.courseMainGroups;
  const { error } = await supabase
    .from('store_settings')
    .upsert({ organization_id: ctx.organizationId, store_id: storeId, settings: next, updated_by: ctx.userId }, { onConflict: 'store_id' });
  if (error) console.warn('[course-builder] courseMainGroups not saved:', error.message);
}

async function groupLinkIds(supabase: Supabase, storeId: string, groupId: string): Promise<string[]> {
  const { data } = await supabase.from('menu_item_option_groups').select('menu_item_id').eq('store_id', storeId).eq('group_id', groupId);
  return ((data ?? []) as { menu_item_id: string }[]).map((r) => r.menu_item_id);
}

/** 選べるメイン：必須・1つ選ぶグループをこのコースに付ける／外す（ほかの商品にも付いていれば、このコースから外すだけ） */
async function saveCourseMain(
  ctx: Ctx,
  supabase: Supabase,
  storeId: string,
  courseId: string,
  main: NonNullable<CourseBuilderInput['main']>
): Promise<{ groupId: string | null } | { error: string }> {
  const [{ data: row }, { data: links }] = await Promise.all([
    supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle(),
    supabase.from('menu_item_option_groups').select('group_id, menu_option_groups!inner(id, name, status)').eq('store_id', storeId).eq('menu_item_id', courseId),
  ]);
  type G = { id: string; name: string; status: string };
  const linked = ((links ?? []) as { menu_option_groups: G | G[] | null }[])
    .map((l) => one(l.menu_option_groups))
    .filter((g): g is G => !!g && (!g.status || g.status === 'active'));
  const saved = courseMainGroupsFrom((row as { settings?: unknown } | null)?.settings ?? null);
  const current = pickCourseMainGroup(courseId, saved, linked);

  if (!main.enabled) {
    if (current) {
      const others = (await groupLinkIds(supabase, storeId, current.id)).filter((id) => id !== courseId);
      const r = others.length === 0 ? await deleteOptionGroup(current.id, storeId) : await setGroupMenuItems({ groupId: current.id, storeId, menuItemIds: others });
      if (r.error) return { error: `選べるメインを外せませんでした: ${r.error}` };
    }
    if (saved[courseId]) await writeCourseMainGroup(ctx, supabase, storeId, courseId, null);
    return { groupId: null };
  }

  let groupId: string;
  let created = false;
  if (current) {
    // 名前は今のまま（Web のオプションの画面で変えていても戻さない）。必須・1つ選ぶにそろえる
    const r = await updateOptionGroup({ id: current.id, storeId, name: current.name, isRequired: true, minSelect: 1, maxSelect: 1 });
    if (r.error) return { error: `選べるメインを保存できませんでした: ${r.error}` };
    groupId = current.id;
  } else {
    const r = await createOptionGroup({ storeId, name: COURSE_MAIN_GROUP_NAME, isRequired: true, minSelect: 1, maxSelect: 1 });
    if (r.error || !r.id) return { error: `選べるメインを作れませんでした: ${r.error ?? ''}` };
    groupId = r.id;
    created = true;
  }

  // このコースに付ける（ほかに付いている商品はそのまま）
  const linkedIds = await groupLinkIds(supabase, storeId, groupId);
  if (!linkedIds.includes(courseId)) {
    const r = await setGroupMenuItems({ groupId, storeId, menuItemIds: [...linkedIds, courseId] });
    if (r.error) {
      if (created) await deleteOptionGroup(groupId, storeId);
      return { error: `選べるメインをコースに付けられませんでした: ${r.error}` };
    }
  }

  // 選択肢：名前・追加料金・並びが変わったときだけ入れ直す（並びは addOptionItem の順）
  const { data: items } = await supabase.from('menu_option_items').select('id, name, price, sort_order, status').eq('group_id', groupId).eq('store_id', storeId).order('sort_order');
  const activeItems = ((items ?? []) as { id: string; name: string; price: number | null; status: string }[])
    .filter((i) => !i.status || i.status === 'active')
    .map((i) => ({ id: i.id, name: i.name, price: Number(i.price ?? 0) }));
  if (choicesChanged(activeItems, main.choices)) {
    for (const it of activeItems) {
      const r = await deleteOptionItem(it.id, storeId);
      if (r.error) return { error: `選べるメインの「${it.name}」を消せませんでした: ${r.error}` };
    }
    for (const ch of main.choices) {
      const r = await addOptionItem({ groupId, storeId, name: ch.name, price: ch.price });
      if (r.error) return { error: `選べるメインの「${ch.name}」を足せませんでした: ${r.error}` };
    }
  }
  if (saved[courseId] !== groupId) await writeCourseMainGroup(ctx, supabase, storeId, courseId, groupId);
  return { groupId };
}

export async function runCourseBuilderSave(storeId: string, input: CourseBuilderInput): Promise<CourseBuilderResult> {
  const ctx = await requirePermission('menu.manage');
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return { ok: false, error: 'この店舗の操作はできません' };
  const supabase = await createClient();
  const c = input.course;
  const label = input.kind === 'course' ? 'コース' : 'プラン';

  // 1) 編集のときは今の商品を読む（この画面で変えない項目＝フリガナ・説明・テイクアウト価格・原価・販売時間・並び順は残す）
  type Existing = {
    id: string;
    store_id: string | null;
    item_type: string;
    name_kana: string | null;
    description: string | null;
    takeout_price: number | null;
    cost: number | null;
    sell_start_time: string | null;
    sell_end_time: string | null;
    sort_order: number | null;
  };
  let existing: Existing | null = null;
  if (c.id) {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, store_id, item_type, name_kana, description, takeout_price, cost, sell_start_time, sell_end_time, sort_order')
      .eq('organization_id', ctx.organizationId)
      .neq('status', 'deleted')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .eq('id', c.id)
      .maybeSingle();
    if (error) return { ok: false, error: `${label}の読み込みに失敗しました: ${error.message}` };
    if (!data || data.item_type === 'option') return { ok: false, error: `${label}が見つかりません。画面を開き直してください` };
    existing = data as Existing;
    // 全店共通の商品に選べるメインは付けられない（オプションは店ごと。setGroupMenuItems はこの店の商品だけ受け付ける）
    if (input.kind === 'course' && input.main?.enabled && existing.store_id === null) {
      return { ok: false, error: '全店共通のコースには選べるメインを付けられません（選べるメインをオフにしてください）' };
    }
  }

  // 2) カテゴリ（選ばなければ「コース」「飲み放題プラン」… を使う。無ければ作って、上のタブも合わせる）
  let categoryId = c.categoryId;
  let pinPage: { id: string; pageKey: string } | null = null;
  if (categoryId) {
    const { data: cat } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .eq('id', categoryId)
      .maybeSingle();
    if (!cat) return { ok: false, error: 'カテゴリが見つかりません。画面を開き直してください' };
  } else {
    const def = defaultCategoryFor(input.kind, input.kind === 'plan' ? planKindOf(c.includesDrinks, c.includesAyce, '') : null);
    const r = await ensureCategory(ctx, supabase, storeId, def.name, def.nameEn);
    if ('error' in r) return { ok: false, error: r.error };
    categoryId = r.id;
    if (r.created) pinPage = { id: r.id, pageKey: def.pageKey };
  }

  // 3) 並び順（新しく作るときはカテゴリの最後）
  let sortOrder = existing?.sort_order ?? null;
  if (sortOrder == null) {
    const { data: last } = await supabase
      .from('menu_items')
      .select('sort_order')
      .eq('organization_id', ctx.organizationId)
      .eq('category_id', categoryId)
      .neq('status', 'deleted')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = Number(last?.sort_order ?? 0) + 10;
  }

  // 4) コース本体（Web の商品の保存と同じ saveMenuItem）
  const saved = await saveMenuItem({
    id: existing?.id,
    storeId,
    categoryId,
    name: c.name,
    nameEn: c.nameEn,
    nameKana: existing?.name_kana ?? '',
    description: existing?.description ?? '',
    itemType: 'course',
    price: c.price,
    takeoutPrice: existing?.takeout_price ?? null,
    cost: existing?.cost ?? null,
    taxRateId: c.taxRateId,
    durationMinutes: c.durationMinutes,
    sellStartTime: existing?.sell_start_time ?? null,
    sellEndTime: existing?.sell_end_time ?? null,
    sortOrder,
    status: c.hidden ? 'hidden' : 'active',
    courseIncludesDrinks: c.includesDrinks,
    courseIncludesAyce: c.includesAyce,
  });
  if (saved.error) return { ok: false, error: saved.error };
  const courseId = saved.id ?? existing?.id ?? null;
  if (!courseId) return { ok: false, error: `${label}を保存できませんでした。画面を開き直してください` };

  // ここから先の失敗は warning（コース本体は保存済み）
  const warnings: string[] = [];
  let dishIds: string[] = [];
  let mainGroupId: string | null = null;
  try {
    if (pinPage) await pinCategoryPage(supabase, ctx, storeId, pinPage.id, pinPage.pageKey);

    // 5) 料理（出す順）。Web の「コースの料理」と同じ saveCourseSteps（空にするとコース名だけ出る）
    if (input.kind === 'course' && input.steps) {
      const dishes = await resolveDishes(ctx, supabase, storeId, input.steps);
      if ('error' in dishes) warnings.push(dishes.error);
      else {
        const r = await saveCourseSteps(storeId, courseId, dishes.ids);
        if (r.error) warnings.push(r.error);
        else dishIds = dishes.ids;
      }
    }

    // 6) 選べるメイン
    if (input.kind === 'course' && input.main) {
      const m = await saveCourseMain(ctx, supabase, storeId, courseId, input.main);
      if ('error' in m) warnings.push(m.error);
      else mainGroupId = m.groupId;
    }

    // 7) プランで出すカテゴリ（メニューブックの「プランで出すカテゴリ」と同じ saveMenuBookPlans）
    if (input.planCategoryIds !== undefined) {
      const r = await saveMenuBookPlans(storeId, [{ planItemId: courseId, categoryIds: input.planCategoryIds }]);
      if (r.error) warnings.push(r.error);
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'うまく保存できなかった項目があります');
  }

  return {
    ok: true,
    data: { courseId, dishIds, mainGroupId, ...(warnings.length > 0 ? { warning: `${label}は保存しました。ただし：${warnings.join(' / ')}` } : {}) },
  };
}
