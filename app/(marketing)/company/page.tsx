import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, ArrowRight } from 'lucide-react';
import { brand } from '@/lib/brand';
import { buttonVariants } from '@/components/ui/button';
import { SectionHeading, Breadcrumbs, FinalCta } from '@/components/marketing/primitives';
import { Reveal } from '@/components/marketing/reveal';
import { FaqAccordion, type FaqItem } from '@/components/marketing/faq-accordion';
import { ONBOARDING_STEPS } from '@/lib/marketing';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: '運営会社・導入について',
  description:
    `${brand.name}（運営: ${brand.company}）のサービス概要と、運営会社、導入の流れをご紹介します。導入に関するご相談はお問い合わせよりご連絡ください。`,
  ...(siteUrl ? { alternates: { canonical: '/company' } } : {}),
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: '複数店舗の展開に対応していますか',
    answer:
      'はい。1つの契約企業のもとに複数店舗を登録し、本社ロールは全店舗を横断して閲覧・比較できます。店舗ごとにアクセスできるスタッフを制御することも可能です。',
  },
  {
    question: '既存データの移行はできますか',
    answer:
      '既存の予約・顧客データ等の移行はご相談内容に応じて個別に対応します。移行手順や対応範囲は導入時のヒアリングで確認させてください。',
  },
  {
    question: '対応端末を教えてください',
    answer:
      'Webブラウザで動作するため、PC・タブレット・スマートフォンで利用できます。POSレジ画面はタッチ操作を前提としたタブレットでの利用を推奨しています。',
  },
];

export default function CompanyPage() {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: brand.company,
      ...(siteUrl ? { url: siteUrl } : {}),
      email: brand.supportEmail,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ホーム', ...(siteUrl ? { item: siteUrl } : {}) },
        { '@type': 'ListItem', position: 2, name: '運営会社・導入について' },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero */}
      <section className="bg-surface">
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-10">
          <Breadcrumbs items={[{ label: 'ホーム', href: '/' }, { label: '運営会社・導入について' }]} />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-primary">{brand.taglineEn}</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-navy sm:text-4xl">
            {brand.name}について
          </h1>
          <p className="mt-5 text-base leading-relaxed text-gray-600">
            {brand.name}は、予約・POS・会計・在庫・勤怠・給与試算・顧客管理・経営分析など、飲食店運営に必要な機能を
            同じデータでつなぐ、店舗管理プラットフォームです。{brand.tagline}という考え方のもと、
            店舗のオペレーションから本社の経営判断までを1つのサービスで支えます。
          </p>
        </div>
      </section>

      {/* 運営会社 */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading eyebrow="Company" title="運営会社" align="left" />
        <div className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <dl className="divide-y divide-gray-100 text-sm">
            <div className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:gap-6">
              <dt className="w-32 shrink-0 font-semibold text-gray-500">サービス名</dt>
              <dd className="text-navy">{brand.name}</dd>
            </div>
            <div className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:gap-6">
              <dt className="w-32 shrink-0 font-semibold text-gray-500">運営会社</dt>
              <dd className="text-navy">{brand.company}</dd>
            </div>
            <div className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:gap-6">
              <dt className="w-32 shrink-0 font-semibold text-gray-500">お問い合わせ</dt>
              <dd className="text-navy">{brand.supportEmail}</dd>
            </div>
          </dl>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          所在地・代表者・設立等の詳細情報については、下記お問い合わせ窓口までご連絡ください。
        </p>
      </section>

      {/* 導入の流れ */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <SectionHeading eyebrow="Onboarding" title="導入の流れ" align="left" />
          <Reveal>
            <ol className="mt-10 space-y-4">
              {ONBOARDING_STEPS.map((step) => (
                <li
                  key={step.title}
                  className="flex gap-4 rounded-2xl border border-gray-200 bg-white p-5 sm:gap-6 sm:p-6"
                >
                  <span className="flex h-10 shrink-0 items-center rounded-full bg-primary px-3 text-xs font-bold tracking-wide text-white">
                    {step.step}
                  </span>
                  <div>
                    <p className="text-base font-bold text-navy">{step.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-500">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* お問い合わせ先 */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading eyebrow="Contact" title="お問い合わせ先" align="left" />
        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
          <p className="text-sm leading-relaxed text-gray-600">
            導入のご相談・デモのご依頼・その他お問い合わせは、以下の窓口までご連絡ください。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/contact" className={buttonVariants({ size: 'lg' })}>
              お問い合わせフォームへ
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a href={`mailto:${brand.supportEmail}`} className={buttonVariants({ size: 'lg', variant: 'secondary' })}>
              <Mail className="h-4 w-4" />
              {brand.supportEmail}
            </a>
          </div>
        </div>
      </section>

      {/* よくある質問 */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <SectionHeading title="よくある質問" />
          <div className="mt-10">
            <FaqAccordion items={FAQ_ITEMS} />
          </div>
        </div>
      </section>

      <FinalCta />
    </>
  );
}
