import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth';
import { isPhoneUserAgent } from '@/lib/device-kind';
import { createClient } from '@/lib/supabase/server';
import { visibleNavGroups, visibleNavTiles, MOBILE_NAV, TABLET_NAV } from '@/lib/nav';
import { can } from '@/lib/permissions';
import { featureForRoute } from '@/lib/features';
import { Sidebar } from '@/components/layout/sidebar';
import { menuLayout } from '@/app/app/menu/data';
import { TopBar } from '@/components/layout/top-bar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { StoreSwitcher } from '@/components/layout/store-switcher';
import { CommandPaletteProvider } from '@/components/search/command-palette';
import { OfflineBanner } from '@/components/offline/offline-banner';
import { ThemeBody } from '@/components/layout/theme-body';
import { InstallPrompt } from '@/components/pwa/install-prompt';

/** 店舗画面はブラウザのツールバー色も上部バー（濃紫）に合わせる */
export const viewport = { themeColor: '#241436' };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();

  // ハンディ端末（QRで登録したスマホ）はハンディ専用。レジ本体（/app）は開かせない
  if (ctx.isHandyDevice) redirect('/handy');

  // 組織に未所属のcypress管理者は運営コンソールへ
  if (!ctx.organizationId) {
    if (ctx.isCypressAdmin) redirect('/admin/organizations');
    redirect('/login?error=no_membership');
  }

  // スマホからは ハンディ だけ（2026-09-23 要望）。
  // 売上・設定などの本体はパソコンと iPad から。iPad はここに入らない（lib/device-kind.ts）。
  if (isPhoneUserAgent((await headers()).get('user-agent'))) redirect('/handy');

  const supabase = await createClient();

  // オンボーディング状態と未読通知数を並列取得（往復回数削減）
  const needsOnboardingCheck = ctx.role === 'org_owner' || ctx.role === 'hq_admin';
  const [orgRes, unreadRes] = await Promise.all([
    needsOnboardingCheck
      ? supabase
          .from('organizations')
          .select('onboarding')
          .eq('id', ctx.organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', ctx.userId)
      .is('read_at', null),
  ]);

  const pathname = (await headers()).get('x-pathname') ?? '';
  // レジ（注文）画面は左メニューを出さず、商品グリッドと伝票に画面の幅を全部使う
  // （iPad で左メニューが 250px 取り、商品が2列しか見えなかった店舗要望）。
  // 他画面への移動は上部バーの「メニュー」「ホーム」と、画面内の「フロアへ戻る」から。
  const posFullscreen = pathname === '/app/pos';

  // レジ端末（/register-login でログイン）だけ、左メニューの中身をレジ用の並びに差し替える。
  // 画面の形（左メニュー＋上部バー）はパソコンと同じまま。メール＋パスワードのパソコンは今まで通り。
  const isRegi = ctx.isRegisterDevice === true;

  // 初期導入ウィザード未完了の企業オーナー/本社管理者を /app/onboarding へ誘導
  // （ウィザード自身とハンバーガーメニュー画面は無限リダイレクトを避けるため除外）
  if (needsOnboardingCheck) {
    if (pathname !== '/app/onboarding' && !pathname.startsWith('/app/menu')) {
      const onboarding = (orgRes.data?.onboarding ?? null) as { completed?: boolean } | null;
      if (!onboarding?.completed) redirect('/app/onboarding');
    }
  }

  const unreadCount = 'count' in unreadRes ? unreadRes.count : 0;

  // レジ端末は「入金出金・仕入経費を上のタイルに」「ハンディ・レジの設定・スキャン・スタッフは設定などの中へ」
  // 「在庫設定は仕入・在庫の中へ」「店舗運営〜チームは集計ひとつに」まとめた並び（app/app/menu/data.ts）
  const regiLayout = isRegi ? menuLayout(ctx.role, ctx.disabledFeatures, { keepActions: true }) : null;
  const tiles = regiLayout ? regiLayout.tiles : visibleNavTiles(ctx.role, ctx.disabledFeatures);
  const groups = regiLayout
    ? [{ label: null, items: regiLayout.main }]
    : visibleNavGroups(ctx.role, ctx.disabledFeatures);
  const mobileItems = (isRegi ? TABLET_NAV : MOBILE_NAV).filter((i) => {
    if (i.permission && !can(ctx.role, i.permission)) return false;
    const feature = featureForRoute(i.href);
    return !feature || !ctx.disabledFeatures.has(feature);
  });

  return (
    <CommandPaletteProvider role={ctx.role}>
      <ThemeBody />
      <OfflineBanner />
      <div className="theme-regi min-h-screen bg-lilac">
        {/* 上部バー（全幅）→ その下に左メニュー（固定）と本文 */}
        <TopBar ctx={ctx} unreadCount={unreadCount ?? 0} showMenuLink={posFullscreen} />
        {!posFullscreen && (
          <Sidebar
            tiles={tiles}
            groups={groups}
            alertCount={unreadCount ?? 0}
            currentStoreId={ctx.currentStore?.id ?? null}
          />
        )}
        <div className={posFullscreen ? undefined : 'lg:pl-[250px]'}>
          <InstallPrompt />
          {/* スマホは店舗切替を上部バーの下に表示 */}
          <div className="border-b border-line bg-white px-4 py-2 sm:hidden">
            <StoreSwitcher
              stores={ctx.stores}
              currentStoreId={ctx.currentStore?.id ?? null}
              allowAll={ctx.isHq}
            />
          </div>
          <main className="px-4 pt-4 pb-24 lg:px-[22px] lg:pt-[18px] lg:pb-8">{children}</main>
        </div>
        <MobileNav items={mobileItems} />
      </div>
    </CommandPaletteProvider>
  );
}
