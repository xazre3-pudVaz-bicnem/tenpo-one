import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FEATURE_PAGES, featureBySlug } from '@/lib/marketing';
import { FEATURE_DETAILS } from '@/lib/marketing-details';
import { FeatureDetail } from '@/components/marketing/feature-detail';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export function generateStaticParams() {
  return FEATURE_PAGES.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const feature = featureBySlug(slug);
  if (!feature) return {};
  return {
    title: { absolute: feature.seoTitle },
    description: feature.seoDescription,
    ...(siteUrl
      ? {
          alternates: { canonical: `/features/${feature.slug}` },
          openGraph: {
            title: feature.seoTitle,
            description: feature.seoDescription,
            url: `${siteUrl}/features/${feature.slug}`,
            type: 'website',
            locale: 'ja_JP',
          },
          twitter: { card: 'summary_large_image', title: feature.seoTitle, description: feature.seoDescription },
        }
      : {}),
  };
}

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const feature = featureBySlug(slug);
  if (!feature || !FEATURE_DETAILS[slug]) notFound();

  const detail = FEATURE_DETAILS[slug];
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ホーム', ...(siteUrl ? { item: siteUrl } : {}) },
        { '@type': 'ListItem', position: 2, name: '機能', ...(siteUrl ? { item: `${siteUrl}/features` } : {}) },
        { '@type': 'ListItem', position: 3, name: feature.name },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: detail.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <FeatureDetail feature={feature} />
    </>
  );
}
