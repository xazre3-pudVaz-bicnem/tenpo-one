import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth';
import { isPhoneUserAgent } from '@/lib/device-kind';
import { createClient } from '@/lib/supabase/server';
import { visibleNavGroups, visibleNavTiles, MOBILE_NAV, TABLET_NAV } from '@/lib/nav';
import { can } from '@/lib/permissions';
import { featureForRoute } from '@/lib/features';
import { Sidebar } from '@/components/layout/sidebar';
import { ContentArea } from '@/components/layout/content-area';
import { menuLayout } from '@/app/app/menu/data';
import { TopBar } from '@/components/layout/top-bar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { StoreSwitcher } from '@/components/layout/store-switcher';
import { CommandPaletteProvider } from '@/components/search/command-palette';
import { OfflineBanner } from '@/components/offline/offline-banner';
import { ThemeBody } from '@/components/layout/theme-body';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { ClerkGate, type GateClerk } from '@/components/pos/clerk-gate';
import { loadStoreClerks } from '@/lib/pos-clerks-server';
import { ReservationAlert } from '@/components/notifications/reservation-alert';

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
  // メール＋パスワードのパソコンは今まで通り。
  const isRegi = ctx.isRegisterDevice === true;

  // レジ端末は「いま誰が操作しているか」を必ず選ばせる（3分さわらないと選び直し）。
  // 取消の承認（店長以上）にも使うので、役職も一緒に持ってくる。
  let gateClerks: GateClerk[] = [];
  if (isRegi && ctx.currentStore) {
    const rows = await loadStoreClerks(supabase, ctx.currentStore.id);
    gateClerks = rows.map((c) => ({ id: c.id, name: c.name, role: c.role }));
  }

  // レジは左メニューをホーム画面だけに出し、そこから開いた画面は全幅で使う（2026-09-23 要望）。
  // 画面の移動では layout が作り直されないため、出し分けは Sidebar / ContentArea 側で行う。

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

  const shell = (
    <CommandPaletteProvider role={ctx.role}>
      <ThemeBody />
      <OfflineBanner />
      <div className="theme-regi min-h-screen bg-lilac">
        {/* 上部バー（全幅）→ その下に左メニュー（固定）と本文 */}
        <TopBar ctx={ctx} unreadCount={unreadCount ?? 0} showMenuLink={posFullscreen} />
        {/* 新しいネット予約のチャイム＋バナー（レジ・パソコンどの画面でも） */}
        {ctx.currentStore && <ReservationAlert storeId={ctx.currentStore.id} ledgerHref="/app/reservations" />}
        {!posFullscreen && (
          <Sidebar
            tiles={tiles}
            groups={groups}
            alertCount={unreadCount ?? 0}
            currentStoreId={ctx.currentStore?.id ?? null}
            iconFirst={isRegi}
            homeOnly={isRegi}
          />
        )}
        <ContentArea homeOnly={isRegi}>
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
        </ContentArea>
        <MobileNav items={mobileItems} />
      </div>
    </CommandPaletteProvider>
  );

  // レジだけ担当者のポップアップで包む（パソコン・ハンディは今まで通り）
  return isRegi ? <ClerkGate clerks={gateClerks}>{shell}</ClerkGate> : shell;
}
