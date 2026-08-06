import type { Metadata } from 'next';
import { Check, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { yen } from '@/lib/format';
import { brand } from '@/lib/brand';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: '料金プラン',
  description:
    'TENPO ONEの料金プランをご紹介します。店舗数や利用機能に応じたプランをご用意。正式な料金は導入時のご相談内容に応じて決定します。',
  ...(siteUrl ? { alternates: { canonical: '/pricing' } } : {}),
};

interface PlanRow {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  description: string | null;
  sort_order: number;
}

export default async function PricingPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plans')
    .select('id, code, name, monthly_price, description, sort_order')
    .eq('is_active', true)
    .order('sort_order');

  const plans = (data ?? []) as PlanRow[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold text-navy sm:text-4xl">料金プラン</h1>
        <p className="mt-4 text-sm leading-relaxed text-gray-600 sm:text-base">
          店舗数や利用機能に応じたプランをご用意しています。掲載価格は目安であり、正式な料金は導入時にご相談ください。
        </p>
      </div>

      {plans.length === 0 ? (
        <div className="mx-auto mt-12 max-w-lg">
          <EmptyState
            title="料金プランは準備中です"
            description="現在プランを準備しています。お急ぎの場合はお問い合わせください。"
            action={
              <a href={`mailto:${brand.supportEmail}`} className={buttonVariants()}>
                <Mail className="h-4 w-4" />
                お問い合わせ
              </a>
            }
          />
        </div>
      ) : (
        <div className="mx-auto mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6">
              <p className="text-sm font-semibold text-primary-deep">{plan.name}</p>
              <p className="mt-3">
                {plan.monthly_price > 0 ? (
                  <>
                    <span className="text-3xl font-bold tabular-nums text-navy">{yen(plan.monthly_price)}</span>
                    <span className="ml-1 text-xs text-gray-500">/ 月〜</span>
                  </>
                ) : (
                  <span className="text-2xl font-bold text-navy">個別見積</span>
                )}
              </p>
              {plan.description && (
                <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-500">{plan.description}</p>
              )}
              <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
                <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                予約・POS・会計・勤怠・給与試算・顧客管理を利用可能
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mx-auto mt-14 max-w-lg rounded-2xl bg-surface p-6 text-center">
        <p className="text-sm font-medium text-navy">
          正式な料金は、店舗数・利用機能をお伺いしたうえで導入時にご相談ください。
        </p>
        <a href={`mailto:${brand.supportEmail}`} className={`${buttonVariants({ size: 'lg' })} mt-4`}>
          <Mail className="h-4 w-4" />
          料金についてお問い合わせ
        </a>
      </div>
    </div>
  );
}
