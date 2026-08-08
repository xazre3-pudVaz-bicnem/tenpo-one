'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export interface ActionResult {
  error?: string;
}

interface OnboardingData {
  /** 実際にデータを保存して完了したステップ番号（「後で設定する」でスキップした場合は含まない） */
  completedSteps?: number[];
  [key: string]: unknown;
}

interface OnboardingState {
  step: number;
  completed: boolean;
  data: OnboardingData;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * organizations.onboarding を読み書きする。進捗は後退させず、常に最大値を保持する。
 * completedStep を渡すと、その回で実データを保存したステップとして data.completedSteps に記録する
 * （dashboard のセットアップ進捗カードの完了率計算に使用）。
 */
async function bumpOnboardingStep(
  supabase: SupabaseServerClient,
  organizationId: string,
  nextStep: number,
  dataPatch?: Record<string, unknown>,
  completedStep?: number
): Promise<void> {
  const { data: org } = await supabase
    .from('organizations')
    .select('onboarding')
    .eq('id', organizationId)
    .single();
  const current = (org?.onboarding ?? {}) as Partial<OnboardingState>;
  const completedSteps = new Set<number>(Array.isArray(current.data?.completedSteps) ? current.data.completedSteps : []);
  if (completedStep) completedSteps.add(completedStep);
  const next: OnboardingState = {
    step: Math.max(current.step ?? 1, nextStep),
    completed: current.completed ?? false,
    data: { ...(current.data ?? {}), ...(dataPatch ?? {}), completedSteps: Array.from(completedSteps).sort((a, b) => a - b) },
  };
  await supabase.from('organizations').update({ onboarding: next }).eq('id', organizationId);
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `store-${Date.now().toString(36)}`;
}

/** 「後で設定する」共通アクション。データは変更せず進捗のみ進める */
export async function skipOnboardingStep(nextStep: number): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();
  await bumpOnboardingStep(supabase, ctx.organizationId, nextStep);
  revalidatePath('/app/onboarding');
  return {};
}

// =============================================================
// STEP1: 会社情報
// =============================================================

export interface CompanyStepInput {
  name: string;
  nameKana: string;
  postalCode: string;
  address: string;
  phone: string;
}

export async function saveCompanyStep(input: CompanyStepInput): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  const name = input.name.trim();
  if (!name) return { error: '会社名を入力してください' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update({
      name,
      name_kana: input.nameKana.trim() || null,
      postal_code: input.postalCode.trim() || null,
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
      updated_by: ctx.userId,
    })
    .eq('id', ctx.organizationId);
  if (error) return { error: `会社情報の保存に失敗しました: ${error.message}` };

  await bumpOnboardingStep(supabase, ctx.organizationId, 2, undefined, 1);
  revalidatePath('/app/onboarding');
  return {};
}

// =============================================================
// STEP2: 店舗情報
// =============================================================

export interface StoreStepInput {
  storeId: string | null;
  name: string;
  address: string;
  phone: string;
}

export interface StoreStepResult extends ActionResult {
  storeId?: string;
}

export async function saveStoreStep(input: StoreStepInput): Promise<StoreStepResult> {
  const ctx = await requirePermission('org.settings');
  const name = input.name.trim();
  if (!name) return { error: '店舗名を入力してください' };

  const supabase = await createClient();

  if (input.storeId) {
    const { error } = await supabase
      .from('stores')
      .update({
        name,
        address: input.address.trim() || null,
        phone: input.phone.trim() || null,
        updated_by: ctx.userId,
      })
      .eq('id', input.storeId)
      .eq('organization_id', ctx.organizationId);
    if (error) return { error: `店舗情報の保存に失敗しました: ${error.message}` };

    await bumpOnboardingStep(supabase, ctx.organizationId, 3, undefined, 2);
    revalidatePath('/app/onboarding');
    return { storeId: input.storeId };
  }

  const base = slugify(name);
  let slug = base;
  for (let attempt = 0; attempt <= 5; attempt++) {
    if (attempt > 0) slug = `${base}-${attempt}`;
    const { data: store, error } = await supabase
      .from('stores')
      .insert({
        organization_id: ctx.organizationId,
        slug,
        name,
        address: input.address.trim() || null,
        phone: input.phone.trim() || null,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('id')
      .single();

    if (!error && store) {
      const { error: settingsErr } = await supabase
        .from('store_settings')
        .insert({ organization_id: ctx.organizationId, store_id: store.id, created_by: ctx.userId, updated_by: ctx.userId });
      if (settingsErr) return { error: `店舗設定の作成に失敗しました: ${settingsErr.message}` };

      await bumpOnboardingStep(supabase, ctx.organizationId, 3, undefined, 2);
      revalidatePath('/app/onboarding');
      return { storeId: store.id as string };
    }
    if (error?.code !== '23505') {
      return { error: `店舗の作成に失敗しました: ${error?.message ?? '不明なエラー'}` };
    }
  }
  return { error: '店舗の作成に失敗しました' };
}

// =============================================================
// STEP3: 営業時間
// =============================================================

export interface BusinessHourStepInput {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

function normalizeTime(v: string | null): string | null {
  if (!v) return null;
  return /^\d{2}:\d{2}$/.test(v) ? v : null;
}

export async function saveHoursStep(storeId: string, hours: BusinessHourStepInput[]): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  if (hours.length !== 7 || hours.some((h) => h.dayOfWeek < 0 || h.dayOfWeek > 6)) {
    return { error: '営業時間データが不正です' };
  }

  const supabase = await createClient();
  const { data: store } = await supabase
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!store) return { error: '対象店舗が見つかりません' };

  const rows = hours.map((h) => ({
    organization_id: ctx.organizationId,
    store_id: storeId,
    day_of_week: h.dayOfWeek,
    is_closed: h.isClosed,
    open_time: h.isClosed ? null : normalizeTime(h.openTime),
    close_time: h.isClosed ? null : normalizeTime(h.closeTime),
    updated_by: ctx.userId,
  }));

  const { error } = await supabase.from('business_hours').upsert(rows, { onConflict: 'store_id,day_of_week' });
  if (error) return { error: `営業時間の保存に失敗しました: ${error.message}` };

  await bumpOnboardingStep(supabase, ctx.organizationId, 4, undefined, 3);
  revalidatePath('/app/onboarding');
  return {};
}

// =============================================================
// STEP4: テーブル・席
// =============================================================

export interface TableStepInput {
  name: string;
  capacityMax: number;
}

export async function saveTablesStep(storeId: string, tables: TableStepInput[]): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: store } = await supabase
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!store) return { error: '対象店舗が見つかりません' };

  const valid = tables.filter((t) => t.name.trim());
  if (valid.length > 0) {
    const rows = valid.map((t, i) => ({
      organization_id: ctx.organizationId,
      store_id: storeId,
      name: t.name.trim(),
      capacity_min: 1,
      capacity_max: Math.max(1, t.capacityMax || 1),
      sort_order: i,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    }));
    const { error } = await supabase.from('restaurant_tables').insert(rows);
    if (error) return { error: `テーブルの登録に失敗しました: ${error.message}` };
  }

  await bumpOnboardingStep(supabase, ctx.organizationId, 5, undefined, 4);
  revalidatePath('/app/onboarding');
  return {};
}

// =============================================================
// STEP5: 商品カテゴリー
// =============================================================

export interface CategoryStepInput {
  name: string;
}

export interface CategorySummary {
  id: string;
  name: string;
}

export interface CategoryStepResult extends ActionResult {
  created?: CategorySummary[];
}

export async function saveCategoriesStep(storeId: string, categories: CategoryStepInput[]): Promise<CategoryStepResult> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: store } = await supabase
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!store) return { error: '対象店舗が見つかりません' };

  const valid = categories.filter((c) => c.name.trim());
  let created: CategorySummary[] = [];
  if (valid.length > 0) {
    const rows = valid.map((c, i) => ({
      organization_id: ctx.organizationId,
      store_id: storeId,
      name: c.name.trim(),
      sort_order: i,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    }));
    const { data, error } = await supabase.from('menu_categories').insert(rows).select('id, name');
    if (error) return { error: `カテゴリーの登録に失敗しました: ${error.message}` };
    created = data ?? [];
  }

  await bumpOnboardingStep(supabase, ctx.organizationId, 6, undefined, 5);
  revalidatePath('/app/onboarding');
  return { created };
}

// =============================================================
// STEP6: 商品登録（税率マスタが未整備なら標準10%・軽減8%を自動作成）
// =============================================================

export interface TaxRateSummary {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
}

/** 税率マスタが空の企業に標準10%（内税・既定）と軽減8%（内税）を自動作成する */
export async function ensureDefaultTaxRates(): Promise<TaxRateSummary[]> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('tax_rates')
    .select('id, name, rate, is_default')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('rate', { ascending: false });

  if (existing && existing.length > 0) {
    return existing.map((t) => ({ id: t.id, name: t.name, rate: t.rate, isDefault: t.is_default }));
  }

  const { data: created, error } = await supabase
    .from('tax_rates')
    .insert([
      {
        organization_id: ctx.organizationId,
        name: '標準税率',
        rate: 10,
        is_reduced: false,
        is_inclusive: true,
        is_default: true,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      },
      {
        organization_id: ctx.organizationId,
        name: '軽減税率',
        rate: 8,
        is_reduced: true,
        is_inclusive: true,
        is_default: false,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      },
    ])
    .select('id, name, rate, is_default');
  if (error || !created) return [];

  return created.map((t) => ({ id: t.id, name: t.name, rate: t.rate, isDefault: t.is_default }));
}

export interface MenuItemStepInput {
  categoryId: string | null;
  name: string;
  price: number;
}

export async function saveMenuItemsStep(storeId: string, items: MenuItemStepInput[]): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: store } = await supabase
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!store) return { error: '対象店舗が見つかりません' };

  const valid = items.filter((i) => i.name.trim());
  if (valid.length > 0) {
    const rates = await ensureDefaultTaxRates();
    const defaultRate = rates.find((r) => r.isDefault) ?? rates[0] ?? null;

    const rows = valid.map((i, idx) => ({
      organization_id: ctx.organizationId,
      store_id: storeId,
      category_id: i.categoryId,
      name: i.name.trim(),
      item_type: 'food' as const,
      price: Math.max(0, Math.round(i.price) || 0),
      tax_rate_id: defaultRate?.id ?? null,
      sort_order: idx,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    }));
    const { error } = await supabase.from('menu_items').insert(rows);
    if (error) return { error: `商品の登録に失敗しました: ${error.message}` };
  }

  await bumpOnboardingStep(supabase, ctx.organizationId, 7, undefined, 6);
  revalidatePath('/app/onboarding');
  return {};
}

// =============================================================
// STEP7: スタッフ招待（任意）
// =============================================================

export interface StaffInviteStepInput {
  email: string;
  displayName: string;
  role: string;
}

export interface StaffInviteStepResult extends ActionResult {
  invited?: { email: string; password: string }[];
}

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#$%';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function saveStaffStep(entries: StaffInviteStepInput[]): Promise<StaffInviteStepResult> {
  const ctx = await requirePermission('org.settings');
  const valid = entries.filter((e) => e.email.trim() && e.displayName.trim());

  const supabase = await createClient();

  if (valid.length === 0) {
    await bumpOnboardingStep(supabase, ctx.organizationId, 8);
    revalidatePath('/app/onboarding');
    return { invited: [] };
  }

  const admin = createAdminClient();
  const invited: { email: string; password: string }[] = [];

  for (const entry of valid) {
    const email = entry.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: `メールアドレスの形式が正しくありません: ${entry.email}` };
    }
    const password = randomPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: entry.displayName.trim() },
    });
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? '';
      if (/already|registered|exists/i.test(msg)) {
        return { error: `既に登録済みのメールアドレスです: ${email}` };
      }
      return { error: `スタッフの招待に失敗しました: ${msg || '不明なエラー'}` };
    }
    const { error: memErr } = await admin.from('memberships').insert({
      organization_id: ctx.organizationId,
      profile_id: created.user.id,
      role: entry.role,
      status: 'invited',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (memErr) return { error: `メンバー登録に失敗しました: ${memErr.message}` };

    invited.push({ email, password });
  }

  await bumpOnboardingStep(supabase, ctx.organizationId, 8, undefined, 7);
  revalidatePath('/app/onboarding');
  return { invited };
}

// =============================================================
// STEP8: 支払方法（案内のみ）
// =============================================================

export async function advancePaymentsStep(): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();
  await bumpOnboardingStep(supabase, ctx.organizationId, 9, undefined, 8);
  revalidatePath('/app/onboarding');
  return {};
}

// =============================================================
// STEP9: レジ設定
// =============================================================

export async function saveRegisterStep(storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: store } = await supabase
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!store) return { error: '対象店舗が見つかりません' };

  const { data: existing } = await supabase
    .from('registers')
    .select('id')
    .eq('store_id', storeId)
    .eq('status', 'active')
    .limit(1);

  if (!existing || existing.length === 0) {
    const { error } = await supabase.from('registers').insert({
      organization_id: ctx.organizationId,
      store_id: storeId,
      name: 'レジ1',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (error) return { error: `レジの作成に失敗しました: ${error.message}` };
  }

  await bumpOnboardingStep(supabase, ctx.organizationId, 10, undefined, 9);
  revalidatePath('/app/onboarding');
  return {};
}

// =============================================================
// STEP10: 完了
// =============================================================

export async function completeOnboarding(): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: org } = await supabase.from('organizations').select('onboarding').eq('id', ctx.organizationId).single();
  const current = (org?.onboarding ?? {}) as Partial<OnboardingState>;
  const completedSteps = new Set<number>(Array.isArray(current.data?.completedSteps) ? current.data.completedSteps : []);
  completedSteps.add(10);
  const next: OnboardingState = {
    step: 10,
    completed: true,
    data: { ...(current.data ?? {}), completedSteps: Array.from(completedSteps).sort((a, b) => a - b) },
  };

  const { error } = await supabase.from('organizations').update({ onboarding: next }).eq('id', ctx.organizationId);
  if (error) return { error: `完了処理に失敗しました: ${error.message}` };

  revalidatePath('/app/onboarding');
  revalidatePath('/app/dashboard');
  return {};
}
