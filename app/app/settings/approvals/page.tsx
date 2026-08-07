import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsBackLink } from '@/components/settings/back-link';
import { ApprovalRulesPanel, type ApprovalRuleRow } from './approval-rules-panel';

export const metadata: Metadata = { title: '承認ルール | 設定' };

export default async function ApprovalRulesSettingsPage() {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data } = await supabase
    .from('approval_rules')
    .select('id, target, min_amount, max_amount, approver_role, allow_self_approve')
    .eq('organization_id', ctx.organizationId)
    .order('target')
    .order('min_amount');

  const rows: ApprovalRuleRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    target: r.target as ApprovalRuleRow['target'],
    minAmount: r.min_amount as number,
    maxAmount: r.max_amount as number | null,
    approverRole: r.approver_role as ApprovalRuleRow['approverRole'],
    allowSelfApprove: r.allow_self_approve as boolean,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="承認ルール"
        description="金額帯ごとに必要な承認ロール・自己承認可否を設定します。対象：請求書・経費・小口現金・発注。"
      />
      <ApprovalRulesPanel initial={rows} />
    </div>
  );
}
