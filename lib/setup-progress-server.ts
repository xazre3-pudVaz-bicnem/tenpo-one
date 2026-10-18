import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * 初期設定（オンボーディング）の完了率。完了済み・かつ100%未満のときだけ数値を返す。
 * organizations.onboarding.data.completedSteps（実データを保存したステップ）を10ステップに対する割合で算出する。
 * 2026-10-18 Ronnie「初期設定のバーは設定の中の上に」→ ホームから設定画面の上へ移した。
 */
export async function getSetupProgressPercent(organizationId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('onboarding')
    .eq('id', organizationId)
    .maybeSingle();
  const onboarding = (org?.onboarding ?? {}) as { completed?: boolean; data?: { completedSteps?: number[] } };
  if (!onboarding.completed) return null;
  const completedSteps = Array.isArray(onboarding.data?.completedSteps) ? onboarding.data.completedSteps : [];
  const percent = Math.round((new Set(completedSteps).size / 10) * 100);
  return percent < 100 ? percent : null;
}
