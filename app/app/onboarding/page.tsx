import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadOnboardingInitial } from '@/lib/onboarding-server';
import { OnboardingWizard } from './wizard';

export const metadata: Metadata = { title: '初期導入ウィザード' };

export default async function OnboardingPage() {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();
  // 読み込みは lib/onboarding-server.ts（iPad ネイティブと同じ）
  const initial = await loadOnboardingInitial(supabase, ctx.organizationId);

  return (
    <div className="mx-auto max-w-2xl">
      <OnboardingWizard initial={initial} />
    </div>
  );
}
