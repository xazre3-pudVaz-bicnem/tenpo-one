import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { readHandyClerk } from '@/lib/handy-session';
import { ThemeBody } from '@/components/layout/theme-body';
import { HandyChrome } from '@/components/handy/handy-chrome';
import type { HandyServiceCall } from '@/components/handy/logic';
import { logoutHandyClerk, resolveServiceCall } from '@/app/app/handy/actions';
import { redirect } from 'next/navigation';
import { checkHandyNetwork } from '@/lib/handy-device-server';
import { isRequestFromStoreNetwork } from '@/lib/store-access-server';
import { ACCESS_MESSAGE } from '@/lib/store-access';
import { HandyNetworkWatch } from '@/components/handy/handy-network-watch';
import { handyHeartbeat } from '@/app/handy-join/actions';

/**
 * ハンディは TENPO ONE 本体（/app）の外に置く独立した全画面アプリ。
 * 承認済みレイアウト（2026-09-21）どおり、本体の上部バー・左メニュー・下部5タブは出さず、
 * 濃紫の上部バーと「SELECT / HANDY・RESERVATION」だけで構成する。
 * 認証・機能フラグは本体と同じ（未ログインは /login へ）。
 */

export const metadata: Metadata = {
  title: 'ハンディ',
  // /handy を開いた状態で「ホーム画面に追加」すると、名前「ハンディ」・起動先 /handy のアイコンになる
  // （本体の manifest.webmanifest はダッシュボード起動なので、ハンディ専用のものに差し替える）
  manifest: '/manifest-handy.webmanifest',
  applicationName: 'ハンディ',
  appleWebApp: { capable: true, title: 'ハンディ', statusBarStyle: 'black' },
};
export const viewport = { themeColor: '#211c28' };

/** 描画の基準時刻（リクエスト時点）。クライアントの時計のハイドレーション初期値にも使う */
function requestTime() {
  return Date.now();
}

export default async function HandyLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireFeature('pos');
  // iPhone用ハンディ：お店のWi-Fiの外に3分いた端末はログアウト画面へ（解除はそこで行う）
  const guard = await checkHandyNetwork();
  if (guard.isDevice && guard.decision.kind === 'logout') redirect('/handy-join?out=1');

  // 契約のアクセス制限（お店の回線）。制限なしの店舗はそのまま
  const storeForAccess = ctx.currentStore ?? ctx.stores[0] ?? null;
  const onStoreNetwork = storeForAccess ? await isRequestFromStoreNetwork(storeForAccess.id) : true;
  const store = ctx.currentStore ?? ctx.stores[0] ?? null;
  // ログイン画面で選んだ担当者（未選択なら端末アカウントの表示名）
  const clerk = await readHandyClerk();

  let calls: HandyServiceCall[] = [];
  if (store) {
    const supabase = await createClient();
    const [{ data: rows }, { data: tables }] = await Promise.all([
      supabase
        .from('service_calls')
        .select('id, table_id, kind, note, created_at')
        .eq('store_id', store.id)
        .eq('status', 'open')
        .order('created_at'),
      supabase
        .from('restaurant_tables')
        .select('id, name')
        .eq('store_id', store.id),
    ]);
    const nameById = new Map((tables ?? []).map((t) => [t.id, t.name]));
    calls = (rows ?? []).map((c) => ({
      id: c.id,
      tableId: c.table_id,
      tableName: nameById.get(c.table_id) ?? null,
      kind: c.kind === 'checkout' ? 'checkout' : 'staff',
      createdAtMs: new Date(c.created_at).getTime(),
      note: c.note,
    }));
  }

  if (!onStoreNetwork) {
    return (
      <>
        <ThemeBody />
        <div className="flex min-h-dvh items-center justify-center bg-[#f9f5f8] px-6 text-center">
          <div className="rounded-2xl bg-white px-6 py-8 shadow-sm">
            <p className="text-base font-bold text-[#2a1f2e]">お店の回線からご利用ください</p>
            <p className="mt-2 text-sm leading-relaxed text-[#5e4e5a]">{ACCESS_MESSAGE.network}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* トースト等 body 直下の要素にも店舗画面の配色を効かせる */}
      <ThemeBody />
      {guard.isDevice && <HandyNetworkWatch heartbeatAction={handyHeartbeat} />}
      <HandyChrome
        storeId={store?.id ?? ''}
        storeName={store?.name ?? '店舗が未選択です'}
        staffName={clerk?.name ?? ctx.displayName}
        clerkSelected={clerk !== null}
        changeClerkAction={logoutHandyClerk}
        stores={ctx.stores}
        currentStoreId={ctx.currentStore?.id ?? null}
        allowAll={ctx.isHq}
        calls={calls}
        serverNow={requestTime()}
        resolveServiceCallAction={resolveServiceCall}
      >
        {children}
      </HandyChrome>
    </>
  );
}
