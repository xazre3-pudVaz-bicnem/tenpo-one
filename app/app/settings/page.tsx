import type { Metadata } from 'next';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';

export const metadata: Metadata = { title: '設定' };

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-6">
      <dt className="w-40 shrink-0 text-sm text-ink-2">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm font-medium text-ink sm:text-right">{children}</dd>
    </div>
  );
}

const muted = <span className="font-normal text-ink-3">未設定</span>;

/**
 * 設定トップ。PC は左メニュー（layout）＋右に店舗情報の概要。
 * スマホは layout 側で左メニューのみを全幅表示する。
 */
export default async function SettingsHubPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />;
  }

  const supabase = await createClient();
  const [{ data: store }, { data: hours }] = await Promise.all([
    supabase
      .from('stores')
      .select('name, postal_code, address, phone, email, seat_count, booking_enabled')
      .eq('id', targetStore.id)
      .maybeSingle(),
    supabase
      .from('business_hours')
      .select('day_of_week, is_closed, open_time, close_time')
      .eq('store_id', targetStore.id),
  ]);

  const closedDays = (hours ?? [])
    .filter((h) => h.is_closed)
    .map((h) => h.day_of_week)
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d]);
  const openRanges = Array.from(
    new Set(
      (hours ?? [])
        .filter((h) => !h.is_closed && h.open_time && h.close_time)
        .map((h) => `${h.open_time!.slice(0, 5)}〜${h.close_time!.slice(0, 5)}`)
    )
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle en="Store">店舗情報</CardTitle>
        <Link
          href="/app/settings/store"
          className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-iris-soft px-4 text-sm font-bold text-royal transition-colors hover:bg-wisteria/50"
        >
          <Pencil className="h-4 w-4" aria-hidden />
          編集
        </Link>
      </CardHeader>
      <div className="px-5 pb-2 pt-4">
        <p className="text-[13px] text-ink-3">店舗名・住所・営業時間などの基本情報（左のメニューから各設定を変更できます）</p>
        {store ? (
          <dl className="mt-2">
            <Field label="店舗名">{store.name}</Field>
            <Field label="会社">{ctx.organizationName || muted}</Field>
            <Field label="住所">
              {store.address ? `${store.postal_code ? `〒${store.postal_code} ` : ''}${store.address}` : muted}
            </Field>
            <Field label="電話番号">
              <span className="tabular-nums">{store.phone || muted}</span>
            </Field>
            <Field label="メールアドレス">{store.email || muted}</Field>
            <Field label="営業時間">
              {openRanges.length > 0 ? (
                <span className="tabular-nums">{openRanges.join(' / ')}</span>
              ) : (
                <Link href="/app/settings/hours" className="font-normal text-iris hover:underline">
                  営業時間を設定する
                </Link>
              )}
            </Field>
            <Field label="定休日">{closedDays.length > 0 ? `${closedDays.join('・')}曜日` : '無休'}</Field>
            <Field label="座席数">
              <span className="tabular-nums">{store.seat_count ?? 0}</span> 席
            </Field>
            <Field label="オンライン予約">
              {store.booking_enabled ? <Badge tone="success">受付中</Badge> : <Badge tone="gray">停止中</Badge>}
            </Field>
          </dl>
        ) : (
          <EmptyState title="店舗情報を取得できませんでした" className="my-6" />
        )}
      </div>
    </Card>
  );
}
