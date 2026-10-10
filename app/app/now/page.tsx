import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { loadStoreNow } from '@/lib/store-now-server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { StoreRealtimeRefresh } from '@/components/realtime/store-realtime-refresh';
import { StoreNowBoard } from '@/components/admin-v2/store-now-board';
import { StoreSwitchLink } from '@/components/admin-v2/store-switch-link';

export const metadata: Metadata = { title: '店舗ナウ' };

/** 描画の基準時刻（リクエスト時点）。経過時間の初期値に使う */
function requestTime() {
  return Date.now();
}

/**
 * 店舗ナウ（新しい管理画面。2026-10-10 Ronnie「店舗を押したら、どの卓に誰がいるか・予約まで全部」）。
 * 見るだけ。卓・未会計・本日の予約はテーブル一覧と同じ決め方（lib/store-now-server.ts）。
 */
export default async function StoreNowPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const ctx = await requireMember();
  if (!can(ctx.role, 'dashboard.view')) redirect('/app/dashboard');
  const sp = await searchParams;
  const stores = ctx.stores;
  if (stores.length === 0) {
    return (
      <div>
        <PageHeader title="店舗ナウ" en="Store now" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗の割り当てを依頼してください" />
      </div>
    );
  }
  const store = stores.find((s) => s.id === sp.store) ?? ctx.currentStore ?? stores[0];
  const supabase = await createClient();
  const serverNow = requestTime();
  const data = await loadStoreNow(supabase, { id: store.id, name: store.name }, serverNow);
  const time = new Date(serverNow).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col gap-4">
      <StoreRealtimeRefresh storeId={store.id} tables={['orders', 'order_items', 'reservations', 'restaurant_tables']} />
      <PageHeader
        title={store.name}
        en="Store now"
        description={`店舗ナウ・${time} 時点（自動で更新）。見るだけの画面です`}
        actions={
          <>
            <Link
              href="/app/orders"
              className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-bold text-ink-2 hover:border-wisteria hover:text-royal"
            >
              伝票明細
            </Link>
            <Link href="/app/reservations" className="inline-flex h-10 items-center rounded-lg bg-plum px-4 text-sm font-bold text-white hover:opacity-90">
              店舗台帳を開く
            </Link>
          </>
        }
      />
      {stores.length > 1 && (
        <nav aria-label="店舗を切り替える" className="-mt-2 flex flex-wrap gap-1.5">
          {stores.map((s) => (
            <StoreSwitchLink
              key={s.id}
              storeId={s.id}
              href={`/app/now?store=${s.id}`}
              current={s.id === store.id}
              className={cn(
                'h-8 rounded-full border px-3.5 text-[12.5px] disabled:opacity-60',
                s.id === store.id ? 'border-plum bg-plum font-bold text-white' : 'border-line bg-white text-ink-2 hover:border-wisteria'
              )}
            >
              {s.name}
            </StoreSwitchLink>
          ))}
        </nav>
      )}
      <StoreNowBoard data={data} serverNow={serverNow} />
    </div>
  );
}
