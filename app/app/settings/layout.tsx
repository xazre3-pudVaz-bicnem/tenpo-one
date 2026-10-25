import { requireMember } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { settingsHubs } from '@/lib/settings-hubs';
import { isDisplayMonitorOnForSettings } from '@/lib/display-monitor-server';
import { getSetupProgressPercent } from '@/lib/setup-progress-server';
import { SettingsShell, type SettingsNavGroup } from '@/components/settings/settings-nav';
import { SetupProgressCard } from '@/components/dashboard/setup-progress-card';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // 各設定ページ側で権限を強制するため、ここでは表示判定のみ行う
  const member = await requireMember();
  // ディスプレイ端末は運営が企業・店舗の両方で ON にしたときだけ デバイス管理 に出す
  const ctx = { ...member, displayMonitorOn: await isDisplayMonitorOnForSettings(member) };
  const hubs = settingsHubs(ctx);
  // 見出しなしの1グループ（まとめ6つだけの一覧）
  const navGroups: SettingsNavGroup[] = [{ label: '', en: '', items: hubs }];
  // 初期設定の残り（スキップした手順があるとき）。ホームから設定の上へ移した（2026-10-18 Ronnie）
  const setupPercent =
    ctx.organizationId && can(ctx.role, 'org.settings') ? await getSetupProgressPercent(ctx.organizationId) : null;

  return (
    <SettingsShell groups={navGroups} top={setupPercent != null ? <SetupProgressCard percent={setupPercent} /> : null}>
      {children}
    </SettingsShell>
  );
}
