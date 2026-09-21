import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { requireHandyClerk } from '@/lib/handy-session';
import { loadSoldOutBoard } from '@/lib/sold-out-loader';
import { HandyMain, HandyMenuButton, HandyRefreshButton, HandyTopBar } from '@/components/handy/handy-chrome';
import { SoldOutBoard } from '@/components/pos/sold-out-board';

export const metadata: Metadata = { title: '品切れ設定' };

/**
 * ハンディの品切れ設定（ドロワーの「品切れ設定」から開く）。
 * スタッフが商品ごとに売切／販売再開を切り替える（2026-09-21 店舗要望）。
 */
export default async function HandySoldOutPage() {
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return (
      <>
        <HandyTopBar left={<HandyMenuButton />} title="品切れ設定" />
        <HandyMain>
          <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#8a769d]">
            {store
              ? '品切れを設定する権限がありません。店長・管理者に権限の付与を依頼してください。'
              : 'アクセス可能な店舗がありません。管理者に店舗の割り当てを依頼してください。'}
          </p>
        </HandyMain>
      </>
    );
  }
  await requireHandyClerk();

  const supabase = await createClient();
  const { categories, items, error } = await loadSoldOutBoard(supabase, ctx.organizationId, store.id);

  return (
    <>
      <HandyTopBar left={<HandyMenuButton />} storeName={store.name} title="品切れ設定" right={<HandyRefreshButton />} />
      <HandyMain>
        {error ? (
          <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#b3341f]">
            商品を読み込めませんでした。画面を更新してください。
          </p>
        ) : (
          <SoldOutBoard categories={categories} items={items} canManageShared={can(ctx.role, 'menu.manage')} />
        )}
      </HandyMain>
    </>
  );
}
