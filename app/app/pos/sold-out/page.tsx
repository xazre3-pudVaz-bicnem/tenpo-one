import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { loadSoldOutBoard } from '@/lib/sold-out-loader';
import { FROM_REGISTER, registerBackUrl, registerSettingsUrl } from '@/lib/register-settings';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SoldOutBoard } from '@/components/pos/sold-out-board';

export const metadata: Metadata = { title: '品切れ設定' };

/**
 * レジの品切れ設定（POSレジの「品切れ」から開く）。スタッフが商品ごとに売切／販売再開を切り替える。
 * 売切の商品はレジ・ハンディ・お客様QRで注文できなくなる（2026-09-21 店舗要望）。
 */
export default async function PosSoldOutPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; order?: string }>;
}) {
  const { from, order } = await searchParams;
  // レジの設定から開いたときはレジの設定に戻す（それ以外は POSレジへ）
  const fromRegister = from === FROM_REGISTER;
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return (
      <div>
        <PageHeader title="品切れ設定" en="Sold out" />
        <EmptyState
          title={store ? '品切れを設定する権限がありません' : '対象の店舗がありません'}
          description={store ? '店長・管理者に権限の付与を依頼してください' : '店舗を選択してから設定を行ってください'}
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { categories, items, error } = await loadSoldOutBoard(supabase, ctx.organizationId, store.id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={fromRegister ? registerSettingsUrl(order) : registerBackUrl(order)}
        className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {fromRegister ? 'レジの設定に戻る' : 'POSレジへ戻る'}
      </Link>
      <PageHeader title="品切れ設定" en="Sold out" description={`${store.name}｜商品ごとに売切・販売再開を切り替えます`} />
      {error ? (
        <EmptyState title="商品を読み込めませんでした" description="画面を更新してください" />
      ) : (
        <div className="overflow-hidden rounded-xl bg-[#f9f5f8]">
          <SoldOutBoard categories={categories} items={items} canManageShared={can(ctx.role, 'menu.manage')} />
        </div>
      )}
    </div>
  );
}
