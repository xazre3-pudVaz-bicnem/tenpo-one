import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, Lock } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { kitchenTicketSettingsFrom } from '@/lib/kitchen-ticket';
import { registerBackUrl, registerOrderId, registerSettingSections } from '@/lib/register-settings';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { KitchenTicketPanel } from '@/components/settings/kitchen-ticket-panel';
import { RegisterSettingsList } from '@/components/pos/register-settings-list';

export const metadata: Metadata = { title: 'レジの設定' };

/**
 * レジの設定（POSレジ・注文画面・フロア・左メニューの「レジの設定」から開く）。
 * 2026-09-21 店舗要望「レジから今までのことを変えられるように」:
 *   厨房伝票（分け方・文字の大きさ・商品名の言語）はこの画面でその場で変える。
 *   メニュー（品切れ・商品の編集・並び順・カテゴリの出し方・ページ・プラン・ランチ・選択肢）、
 *   キッチンの振り分け・プリンター、テーブルQRの印刷、ハンディ・担当者、予約・営業時間は、ボタンで各画面を開く
 *   （開いた画面の上の「レジの設定に戻る」でここに戻る）。
 */
export default async function RegisterSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  const orderId = registerOrderId(order);
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return (
      <div>
        <PageHeader title="レジの設定" en="Register settings" />
        <EmptyState
          title={store ? 'レジを使う権限がありません' : '対象の店舗がありません'}
          description={store ? '店長・管理者に権限の付与を依頼してください' : '店舗を選択してから設定を行ってください'}
        />
      </div>
    );
  }

  const canKitchen = can(ctx.role, 'store.settings');
  let kitchen = null;
  if (canKitchen) {
    const supabase = await createClient();
    const { data } = await supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle();
    kitchen = kitchenTicketSettingsFrom(data?.settings ?? null);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={registerBackUrl(orderId)}
        className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {orderId ? '伝票に戻る' : 'POSレジへ戻る'}
      </Link>
      <PageHeader
        title="レジの設定"
        en="Register settings"
        description={`${store.name}｜レジから変えられる設定をまとめています。保存すると、次の注文からレジ・ハンディ・お客様QR・プリンターに反映されます`}
      />

      <section aria-labelledby="register-settings-kitchen-ticket" className="mb-6">
        <h2 id="register-settings-kitchen-ticket" className="mb-2 text-sm font-bold text-navy">
          厨房伝票（キッチン・ドリンクのプリンター）
          <span className="ml-1.5 text-xs font-normal text-gray-400">Kitchen tickets</span>
        </h2>
        {kitchen ? (
          <KitchenTicketPanel storeId={store.id} initial={kitchen} />
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
            <Lock className="h-4 w-4 text-gray-300" aria-hidden />
            分け方・文字の大きさ・商品名の言語は、店長以上が変更できます
          </div>
        )}
      </section>

      <RegisterSettingsList sections={registerSettingSections(ctx.role, orderId)} />
    </div>
  );
}
