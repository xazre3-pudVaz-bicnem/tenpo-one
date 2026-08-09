import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { brand } from '@/lib/brand';
import { Breadcrumbs } from '@/components/marketing/primitives';
import { ContactForm } from './contact-form';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: { absolute: `お問い合わせ・デモのご相談｜${brand.name}` },
  description:
    'TENPO ONEの導入・デモのご相談はこちら。予約・POS・在庫・勤怠・会計・経営分析を1つにまとめる飲食店向け店舗管理プラットフォームについて、画面を見ながらご説明します。',
  ...(siteUrl ? { alternates: { canonical: '/contact' } } : {}),
};

const POINTS = [
  '画面を見ながら、実際の操作感をご確認いただけます',
  '店舗数や現在お使いのツールに合わせてご説明します',
  '1店舗から多店舗まで、段階的な導入をご相談できます',
];

export default function ContactPage() {
  return (
    <section className="bg-surface">
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
        <Breadcrumbs items={[{ label: 'ホーム', href: '/' }, { label: 'お問い合わせ' }]} />
        <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_1.3fr] lg:gap-14">
          <div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-navy sm:text-4xl">
              無料で相談する
            </h1>
            <p className="mt-5 text-base leading-relaxed text-gray-600">
              TENPO ONEの導入やデモについて、お気軽にご相談ください。
              いただいた内容を確認のうえ、担当よりご連絡いたします。
            </p>
            <ul className="mt-8 space-y-3">
              {POINTS.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-8 text-xs leading-relaxed text-gray-400">
              ※ 現在オンラインでの無料トライアルは提供しておりません。まずは画面を見ながらのご相談から承ります。
            </p>
          </div>

          <div>
            <ContactForm />
          </div>
        </div>
      </div>
    </section>
  );
}
