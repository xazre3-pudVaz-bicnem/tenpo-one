import 'server-only';
import { can, ROLES, ROLE_LABELS } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { loadOnboardingInitial } from '@/lib/onboarding-server';
import { onboardingStartStep, onboardingTime, parseNativeOnboardingAction } from '@/lib/native-onboarding';
import {
  advancePaymentsStep,
  completeOnboarding,
  saveCategoriesStep,
  saveCompanyStep,
  saveHoursStep,
  saveMenuItemsStep,
  saveRegisterStep,
  saveStaffStep,
  saveStoreStep,
  saveTablesStep,
  skipOnboardingStep,
} from '@/app/app/onboarding/actions';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 初期設定（初期導入ウィザード）の iPad ネイティブ（GET part=onboarding ／ POST { type: 'onboarding', action: … }）。
 * 中身・操作は Web の /app/onboarding と同じ（lib/onboarding-server.ts・app/app/onboarding/actions.ts）。権限も同じ org.settings。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */

const NO_PERMISSION: NativeModuleResult = { status: 403, body: { ok: false, error: '初期設定を変える権限がありません' } };

export const onboardingGet: NativeModuleGet = async ({ ctx }) => {
  if (!can(ctx.role, 'org.settings') || !ctx.organizationId) return NO_PERMISSION;
  const initial = await loadOnboardingInitial(await createClient(), ctx.organizationId);
  return {
    body: {
      ok: true,
      // store は「企業の最初の店舗」（ウィザードで作る・直す店舗。無ければ null）。Web の wizard.tsx と同じ
      ...initial,
      step: onboardingStartStep(initial.step),
      // 時刻は「HH:mm」にそろえる（DB の time は秒つき。iPad の時刻の選択と同じ形）
      hours: initial.hours.map((h) => ({ ...h, openTime: onboardingTime(h.openTime), closeTime: onboardingTime(h.closeTime) })),
      // スタッフ招待のロール（Web の step-staff.tsx と同じ並び）
      roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] })),
    },
  };
};

/** 1 つの段を保存して次へ（どれも Web と同じ Server Action） */
export const onboardingPost: NativeModulePost = async ({ ctx, raw }) => {
  if (!can(ctx.role, 'org.settings')) return NO_PERMISSION;
  const parsed = parseNativeOnboardingAction(raw);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
  const a = parsed.value;
  const fail = (error: string): NativeModuleResult => ({ status: 400, body: { ok: false, error } });

  switch (a.action) {
    case 'company': {
      const r = await saveCompanyStep(a.input);
      return r.error ? fail(r.error) : { body: { ok: true } };
    }
    case 'store': {
      const r = await saveStoreStep(a.input);
      return r.error ? fail(r.error) : { body: { ok: true, storeId: r.storeId ?? null } };
    }
    case 'hours': {
      const r = await saveHoursStep(a.storeId, a.hours);
      return r.error ? fail(r.error) : { body: { ok: true } };
    }
    case 'tables': {
      const r = await saveTablesStep(a.storeId, a.tables);
      return r.error ? fail(r.error) : { body: { ok: true } };
    }
    case 'categories': {
      const r = await saveCategoriesStep(a.storeId, a.categories);
      return r.error ? fail(r.error) : { body: { ok: true, created: r.created ?? [] } };
    }
    case 'items': {
      const r = await saveMenuItemsStep(a.storeId, a.items);
      return r.error ? fail(r.error) : { body: { ok: true } };
    }
    case 'staff': {
      // 初期パスワードはこの返事にだけ載る（再表示できない。Web と同じ）
      const r = await saveStaffStep(a.entries);
      return r.error ? fail(r.error) : { body: { ok: true, invited: r.invited ?? [] } };
    }
    case 'payments':
      await advancePaymentsStep();
      return { body: { ok: true } };
    case 'register': {
      const r = await saveRegisterStep(a.storeId);
      return r.error ? fail(r.error) : { body: { ok: true } };
    }
    case 'complete': {
      const r = await completeOnboarding();
      return r.error ? fail(r.error) : { body: { ok: true } };
    }
    case 'skip':
      await skipOnboardingStep(a.next);
      return { body: { ok: true } };
  }
};
