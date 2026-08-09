import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { brand } from '@/lib/brand';
import { FEATURE_CATEGORIES, FEATURE_PAGES, type FeatureCategoryKey } from '@/lib/marketing';
import { SectionHeading, FinalCta } from '@/components/marketing/primitives';
import { Reveal } from '@/components/marketing/reveal';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: { absolute: `飲食店運営の機能一覧｜${brand.name}` },
  description:
    '予約・POS・QRオーダー・KDS・顧客管理・在庫・原価・会計・勤怠・給与試算・経営分析・多店舗管理まで。飲食店運営に必要な機能を同じデータでつなぐTENPO ONEの機能一覧。',
  ...(siteUrl ? { alternates: { canonical: '/features' } } : {}),
};

const CATEGORY_ORDER: FeatureCategoryKey[] = ['operations', 'backoffice', 'management'];

export default function FeaturesHubPage() {
  return (
    <>
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Features</p>
          <h1 className="mx-auto mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight text-navy sm:text-4xl">
            飲食店運営に必要な機能を、TENPO ONEひとつに。
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-gray-600">
            予約から会計、在庫・原価、勤怠・給与、経営分析まで。すべての機能が同じデータでつながるため、
            同じ内容を別のシステムへ入力し直す必要はありません。
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {CATEGORY_ORDER.map((key, ci) => (
          <section key={key} className="border-t border-gray-100 py-16 first:border-t-0 sm:py-20">
            <SectionHeading
              eyebrow={`0${ci + 1}`}
              title={FEATURE_CATEGORIES[key].label}
              description={FEATURE_CATEGORIES[key].description}
              align="left"
            />
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURE_PAGES.filter((f) => f.category === key).map((f, i) => (
                <Reveal key={f.slug} delay={i * 60}>
                  <Link
                    href={`/features/${f.slug}`}
                    className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md"
                  >
                    <p className="text-base font-bold text-navy group-hover:text-primary-deep">{f.name}</p>
                    <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.tagline}</p>
                    <ul className="mt-4 flex flex-wrap gap-1.5">
                      {f.includes.slice(0, 5).map((item) => (
                        <li key={item} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] text-gray-500">
                          {item}
                        </li>
                      ))}
                      {f.includes.length > 5 && (
                        <li className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] text-gray-400">
                          ほか{f.includes.length - 5}件
                        </li>
                      )}
                    </ul>
                    <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary-deep">
                      詳しく見る <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </section>
        ))}
      </div>

      <FinalCta />
    </>
  );
}
