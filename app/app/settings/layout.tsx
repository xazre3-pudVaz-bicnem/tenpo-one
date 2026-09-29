import { requireMember } from '@/lib/auth';
import { settingsHubs } from '@/lib/settings-hubs';
import { SettingsShell, type SettingsNavGroup } from '@/components/settings/settings-nav';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // 各設定ページ側で権限を強制するため、ここでは表示判定のみ行う
  const ctx = await requireMember();
  const hubs = settingsHubs(ctx);
  // 見出しなしの1グループ（まとめ6つだけの一覧）
  const navGroups: SettingsNavGroup[] = [{ label: '', en: '', items: hubs }];

  return <SettingsShell groups={navGroups}>{children}</SettingsShell>;
}
