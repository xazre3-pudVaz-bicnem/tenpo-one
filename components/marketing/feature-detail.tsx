import Link from 'next/link';
import { Check, ArrowRight } from 'lucide-react';
import { SectionHeading, Screenshot, Breadcrumbs, FinalCta, CtaButtons } from '@/components/marketing/primitives';
import { Reveal } from '@/components/marketing/reveal';
import { FaqAccordion } from '@/components/marketing/faq-accordion';
import { featureBySlug, type FeaturePage } from '@/lib/marketing';
import { FEATURE_DETAILS } from '@/lib/marketing-details';

/** 機能詳細ページの共通テンプレート（全主要機能ページで共有） */
export function FeatureDetail({ feature }: { feature: FeaturePage }) {
  const detail = FEATURE_DETAILS[feature.slug];
  const related = detail.related
    .map((slug) => featureBySlug(slug))
    .filter((f): f is FeaturePage => !!f);

  return (
    <>
      {/* ① Hero */}
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-10">
          <Breadcrumbs
            items={[
              { label: 'ホーム', href: '/' },
              { label: '機能', href: '/features' },
              { label: feature.name },
            ]}
          />
          <div className="mt-6 grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{feature.name}</p>
              <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-navy sm:text-4xl">
                {feature.heroTitle}
              </h1>
              <p className="mt-5 text-base leading-relaxed text-gray-600">{detail.heroLead}</p>
              <div className="mt-8">
                <CtaButtons secondaryHref="/features" secondaryLabel="機能一覧へ戻る" />
              </div>
            </div>
            <Screenshot src={feature.image} alt={feature.imageAlt} priority />
          </div>
        </div>
      </section>

      {/* ② よくある課題 */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading eyebrow="Before" title="こんな困りごと、ありませんか" align="left" />
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {detail.challenges.map((c, i) => (
            <Reveal key={c.title} delay={i * 80}>
              <div className="h-full rounded-2xl border border-gray-200 bg-white p-6">
                <p className="text-base font-bold text-navy">{c.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{c.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ③ TENPO ONEならどう変わる */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <SectionHeading eyebrow="After" title={`TENPO ONEの${feature.name}`} align="left" description={detail.solution} />
            </div>
            {/* ④ 主な機能 */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
              <p className="text-sm font-bold text-navy">主な機能</p>
              <ul className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {feature.includes.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ⑤ 実際の画面 + ⑥ 他機能との連動 */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="Connected"
          title="他の機能と、同じデータでつながる"
          description="この機能で扱ったデータは、別のシステムへ入力し直すことなく、そのまま次の業務へ引き継がれます。"
        />
        <Reveal className="mt-10">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {detail.flow.map((label, i) => (
              <div key={label} className="flex items-center gap-3">
                <span className="rounded-full border border-primary/30 bg-primary-soft px-4 py-2 text-sm font-medium text-primary-deep">
                  {label}
                </span>
                {i < detail.flow.length - 1 && <ArrowRight className="h-4 w-4 text-gray-300" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ⑦ 利用シーン */}
      <section className="bg-navy py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading tone="dark" title="利用シーン" />
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {detail.useCases.map((u, i) => (
              <Reveal key={u.title} delay={i * 80}>
                <div className="h-full rounded-2xl bg-navy-soft p-6">
                  <p className="text-base font-bold text-white">{u.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-gray-400">{u.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
          {detail.note && (
            <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-gray-400">
              ※ {detail.note}
            </p>
          )}
        </div>
      </section>

      {/* ⑧ FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading title="よくある質問" />
        <div className="mt-10">
          <FaqAccordion items={detail.faq.map((f) => ({ question: f.q, answer: f.a }))} />
        </div>
      </section>

      {/* ⑨ 関連機能 */}
      {related.length > 0 && (
        <section className="bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading title="関連する機能" align="left" />
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/features/${r.slug}`}
                  className="group rounded-2xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md"
                >
                  <p className="text-sm font-bold text-navy group-hover:text-primary-deep">{r.name}</p>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">{r.tagline}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary-deep">
                    詳しく見る <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ⑩ CTA */}
      <FinalCta />
    </>
  );
}
