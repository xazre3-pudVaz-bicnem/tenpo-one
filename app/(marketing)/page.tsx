import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  X,
  CalendarCheck,
  MonitorSmartphone,
  QrCode,
  Package,
  Calculator,
  BarChart3,
  Clock,
  Building2,
  UserCog,
  Footprints,
  UtensilsCrossed,
  Lock,
  ShieldCheck,
  ScrollText,
} from 'lucide-react';
import { brand } from '@/lib/brand';
import { FEATURE_CATEGORIES, FEATURE_PAGES, featuresByCategory, ONBOARDING_STEPS, type FeatureCategoryKey } from '@/lib/marketing';
import { SectionHeading, Screenshot, CtaButtons, FinalCta } from '@/components/marketing/primitives';
import { Reveal } from '@/components/marketing/reveal';
import { DataFlow } from '@/components/marketing/data-flow';
import { FaqAccordion, type FaqItem } from '@/components/marketing/faq-accordion';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: { absolute: `${brand.name}｜${brand.tagline} 飲食店向け店舗管理システム` },
  description:
    '予約・POS・QRオーダー・在庫・勤怠・給与・会計・経営分析まで。飲食店運営に必要な機能を同じデータでつなぐクラウド型店舗管理システム。多店舗展開の本社業務から店舗オペレーションまでを1つのプラットフォームに統合します。',
  ...(siteUrl ? { alternates: { canonical: '/' } } : {}),
  openGraph: {
    title: `${brand.name}｜${brand.tagline}`,
    description: '予約・POS・QRオーダー・在庫・勤怠・給与・会計・経営分析を同じデータでつなぐ飲食店向け店舗管理システム。',
    type: 'website',
    locale: 'ja_JP',
    ...(siteUrl ? { url: siteUrl } : {}),
  },
  twitter: {
    card: 'summary_large_image',
    title: `${brand.name}｜${brand.tagline}`,
    description: '予約・POS・QRオーダー・在庫・勤怠・給与・会計・経営分析を同じデータでつなぐ飲食店向け店舗管理システム。',
  },
};

const CATEGORY_ORDER: FeatureCategoryKey[] = ['operations', 'backoffice', 'management'];

const CATEGORY_IMAGE: Record<FeatureCategoryKey, { src: string; alt: string }> = {
  operations: { src: '/lp-pos-checkout.png', alt: 'POSレジのタブレットで会計を行うスタッフ' },
  backoffice: { src: '/lp-attendance.png', alt: '厨房でタブレットに出勤を打刻するスタッフ' },
  management: { src: '/lp-owner-analytics.png', alt: 'ノートPCで売上ダッシュボードを確認するオーナー' },
};

const PROBLEM_CARDS = [
  {
    title: '同じ数字を何度も入力',
    desc: '予約サイト・POSレジ・勤怠SaaS・Excelがバラバラで、同じ情報を毎回手で入力し直している。',
  },
  {
    title: '閉店後のレジ締めと日報',
    desc: '現金の数え合わせと日報作成に時間がかかり、閉店後の残業が続いている。',
  },
  {
    title: '本社は数字が集まるまで分からない',
    desc: '各店舗からの報告が届くまで、全店の売上や状況を把握できない。',
  },
  {
    title: '経理は結局すべて再入力',
    desc: 'POSの売上や経費を、月末に会計ソフトへ改めて打ち込んでいる。',
  },
];

const BEFORE_ITEMS = [
  '予約サイト・POSレジ・勤怠SaaS・Excel会計が別々に存在',
  '同じお客様や売上の情報を、システムごとに入力し直す',
  '閉店後に手作業でレジを締め、数字を突き合わせる',
  '本社は店舗からの報告が届くまで状況が分からない',
];

const AFTER_ITEMS = [
  '予約・来店・注文・会計が同じデータでつながる',
  '会計と同時に、在庫・原価・顧客情報が自動で更新',
  'レジ締め・日報の数字が自動で集計される',
  '本社はリアルタイムで全店の状況を確認できる',
];

const HIGHLIGHTS: { slug: string; icon: typeof CalendarCheck }[] = [
  { slug: 'reservations', icon: CalendarCheck },
  { slug: 'pos', icon: MonitorSmartphone },
  { slug: 'qr-kds', icon: QrCode },
  { slug: 'inventory', icon: Package },
  { slug: 'workforce', icon: Clock },
  { slug: 'accounting', icon: Calculator },
  { slug: 'analytics', icon: BarChart3 },
];

const TIMELINE = [
  { time: '15:00', title: '予約確認・仕込み', desc: '当日の予約状況を確認しながら、仕込みを進めます。' },
  { time: '16:30', title: 'スタッフ出勤', desc: 'タブレットで出勤を打刻。シフトどおりの人員がそろいます。' },
  { time: '17:00', title: '開店', desc: 'レジを開局し、営業を開始します。' },
  { time: '18:00', title: '予約のお客様が来店', desc: '予約台帳からテーブルへ案内し、着席します。' },
  { time: '18:10', title: 'QR注文・POS注文', desc: 'お客様はQRで、スタッフはPOSで注文を入力します。' },
  { time: '18:11', title: '厨房のKDSに表示', desc: '注文が厨房のキッチンディスプレイに届き、調理を開始します。' },
  { time: '19:30', title: '会計', desc: '複数の支払い方法に対応した会計を行います。' },
  { time: '19:31', title: '売上・顧客・在庫へ反映', desc: '会計と同時に、売上・顧客履歴・在庫・原価が更新されます。' },
  { time: '23:00', title: 'レジ締め', desc: '理論現金と実際の現金を突き合わせて締めます。' },
  { time: '23:05', title: '日報・利益の集計', desc: '売上・原価・人件費から、その日の利益が自動で集計されます。' },
  { time: '翌朝', title: '本社が全店を確認', desc: '本社は出社前に、前日の全店の実績を1画面で確認できます。' },
];

const ROLES = [
  { icon: Building2, role: '経営者・本社', desc: '全店舗の売上・利益・人件費率を1画面で比較し、店舗を横断した経営判断ができます。' },
  { icon: UserCog, role: '店長', desc: '予約・フロア・レジ締め・発注・シフト作成までを、タブレット1台で完結できます。' },
  { icon: Footprints, role: 'ホールスタッフ', desc: '注文・会計・案内に絞った画面で、新人でもすぐに操作を覚えられます。' },
  { icon: UtensilsCrossed, role: '厨房スタッフ', desc: '注文がキッチンディスプレイに届き、調理と提供の進み具合をタッチで管理できます。' },
  { icon: Calculator, role: '経理担当', desc: '売上・経費・レジ締めがそのまま仕訳に反映され、月末の再入力が要りません。' },
];

const SECURITY_ITEMS = [
  { icon: Lock, title: '契約企業ごとのデータ分離', desc: '契約企業ごとにアクセスを分離し、他社のデータが混在しない設計です。' },
  { icon: ShieldCheck, title: 'ロール別の権限管理', desc: '経営者・店長・ホール・厨房・経理など役割ごとに、閲覧・操作できる範囲を制御します。' },
  { icon: ScrollText, title: '操作の記録（監査ログ）', desc: '金額や勤怠、取消などの重要な操作は記録に残り、あとから確認できます。' },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    question: '専用のレジ端末が必要ですか？',
    answer: '専用端末は不要です。市販のタブレットやパソコンのブラウザからそのままご利用いただけます。',
  },
  {
    question: 'スマートフォンやタブレットにも対応していますか？',
    answer: 'はい。ブラウザで動作するため、スマートフォン・タブレット・PCのいずれからでも利用できます。POSレジ画面はタッチ操作を前提としたタブレットでの利用を推奨しています。',
  },
  {
    question: '複数店舗をまとめて管理できますか？',
    answer: 'はい。1店舗でも多店舗でも同じ仕組みで運用でき、本社ロールは全店舗を横断して閲覧・比較できます。',
  },
  {
    question: '既存の予約台帳や顧客データの移行はできますか？',
    answer: 'ご相談内容に応じて個別に対応します。移行手順や対応範囲は導入時のヒアリングで確認させてください。',
  },
  {
    question: 'POS機能だけを使うこともできますか？',
    answer: '可能です。POSを中心にご利用いただき、予約や在庫などの機能は必要になったタイミングで段階的に追加できます。',
  },
  {
    question: 'お客様のQR注文にアプリのインストールは必要ですか？',
    answer: '不要です。スマートフォンのカメラでテーブルのQRコードを読み取ると、ブラウザでメニューが開き、そのまま注文できます。',
  },
];

export default function TopPage() {
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
      '@type': 'SoftwareApplication',
      name: brand.name,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        '予約・POS・QRオーダー・在庫・勤怠・給与・会計・経営分析を同じデータでつなぐ飲食店向けクラウド型店舗管理システム。',
      ...(siteUrl ? { url: siteUrl } : {}),
      provider: { '@type': 'Organization', name: brand.company },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: brand.name,
      ...(siteUrl ? { url: siteUrl } : {}),
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

      {/* 1. HERO */}
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{brand.taglineEn}</p>
              <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-navy sm:text-5xl">
                飲食店の{brand.tagline}
              </h1>
              <p className="mt-5 text-base leading-relaxed text-gray-600 sm:text-lg">
                予約・POS・QR注文・在庫・勤怠・会計・経営分析まで。バラバラだった店舗業務を、
                同じデータでつながる1つのプラットフォームへ。
              </p>
              <div className="mt-8">
                <CtaButtons secondaryHref="/features" secondaryLabel="機能を見る" />
              </div>
            </div>
            <Screenshot
              src="/lp-hero-pos.png"
              alt="カウンターでTENPO ONEのPOSダッシュボードを操作する店員"
              device="plain"
              priority
            />
          </div>
        </div>
      </section>

      {/* 2. PRODUCT OVERVIEW */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="TENPO ONEとは"
          title="単なるPOSではなく、飲食店運営全体を一元化する基幹プラットフォーム"
          description="予約・フロア・POS・会計・QRオーダー・キッチンディスプレイ・顧客管理・在庫・原価・経費・勤怠・給与試算・本社の多店舗管理まで。すべての機能が、同じ会社・店舗・お客様・注文・スタッフのデータでつながっています。"
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <p className="text-sm font-bold text-navy">フロント業務</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">予約・フロア・POS・QRオーダー・キッチンディスプレイ</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <p className="text-sm font-bold text-navy">バックオフィス</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">在庫・原価・経費・請求書・小口現金・勤怠・給与試算</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <p className="text-sm font-bold text-navy">経営管理</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">会計帳簿・経営分析・多店舗の一元管理</p>
          </div>
        </div>
      </section>

      {/* 3. PROBLEM */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading title="システムを増やすほど、仕事まで増えていませんか？" />
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEM_CARDS.map((c, i) => (
              <Reveal key={c.title} delay={i * 70}>
                <div className="h-full rounded-2xl border border-gray-200 bg-white p-6">
                  <p className="text-base font-bold text-navy">{c.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-gray-500">{c.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 4. BEFORE / AFTER */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading title="バラバラなシステムから、1つのデータへ" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-gray-200 bg-gray-50 p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Before</p>
              <p className="mt-1 text-lg font-bold text-navy">別々のシステムで運用</p>
              <ul className="mt-5 space-y-3">
                {BEFORE_ITEMS.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="h-full rounded-2xl border border-primary/30 bg-primary-soft p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">After</p>
              <p className="mt-1 text-lg font-bold text-navy">{brand.name}で1つに</p>
              <ul className="mt-5 space-y-3">
                {AFTER_ITEMS.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-navy">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 5. CONNECTED FLOW */}
      <section className="bg-navy py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            tone="dark"
            title="連携しているのではなく、最初から1つのデータとして動きます"
            description="予約から給与試算まで、業務ごとにツールを乗り換える必要はありません。"
          />
          <Reveal className="mt-10">
            <DataFlow />
          </Reveal>
        </div>
      </section>

      {/* 6. 3 CATEGORY */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading eyebrow="Features" title="3つの領域を、同じデータで" align="left" />
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {CATEGORY_ORDER.map((key, i) => {
            const category = FEATURE_CATEGORIES[key];
            const image = CATEGORY_IMAGE[key];
            const items = featuresByCategory(key).slice(0, 3);
            return (
              <Reveal key={key} delay={i * 90}>
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
                  <Screenshot src={image.src} alt={image.alt} device="plain" />
                  <div className="flex flex-1 flex-col p-6">
                    <p className="text-base font-bold text-navy">{category.label}</p>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500">{category.description}</p>
                    <ul className="mt-4 flex flex-wrap gap-1.5">
                      {items.map((f) => (
                        <li key={f.slug} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] text-gray-500">
                          {f.name}
                        </li>
                      ))}
                    </ul>
                    <Link href="/features" className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary-deep">
                      詳しく見る <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* 7. FEATURE HIGHLIGHTS */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Highlights" title="主な機能" align="left" />
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {HIGHLIGHTS.map((h, i) => {
              const feature = FEATURE_PAGES.find((f) => f.slug === h.slug);
              if (!feature) return null;
              return (
                <Reveal key={h.slug} delay={i * 60}>
                  <Link
                    href={`/features/${feature.slug}`}
                    className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary-deep">
                      <h.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <p className="mt-3 text-sm font-bold text-navy group-hover:text-primary-deep">{feature.name}</p>
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{feature.tagline}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary-deep">
                      詳しく見る <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </Link>
                </Reveal>
              );
            })}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-gray-400">
            ※ 給与・歩合は勤怠実績からの試算です。所得税・社会保険・年末調整を含む正式な給与計算には対応していません。
          </p>
        </div>
      </section>

      {/* 8. RESTAURANT DAY */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading eyebrow="A Day" title="飲食店の1日" description="予約から翌朝の本社確認まで、同じデータがつながっていきます。" />
        <ol className="mt-10 space-y-6 border-l border-gray-200 pl-6 sm:pl-8">
          {TIMELINE.map((t, i) => (
            <Reveal key={t.time + t.title} delay={i * 40}>
              <li className="relative">
                <span className="absolute -left-[31px] top-1 h-2.5 w-2.5 rounded-full bg-primary sm:-left-[35px]" aria-hidden="true" />
                <p className="text-xs font-semibold text-primary">{t.time}</p>
                <p className="mt-0.5 text-base font-bold text-navy">{t.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-gray-500">{t.desc}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* 9. ROLE BASED */}
      <section className="bg-navy py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading tone="dark" title="立場ごとに、必要な画面だけを" />
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {ROLES.map((r, i) => (
              <Reveal key={r.role} delay={i * 60}>
                <div className="h-full rounded-2xl bg-navy-soft p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
                    <r.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-4 text-sm font-bold text-white">{r.role}</p>
                  <p className="mt-2 text-xs leading-relaxed text-gray-400">{r.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 10. MULTI STORE */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <SectionHeading eyebrow="Multi-store" title="本社から、全店舗を1画面で" align="left" />
            <p className="mt-5 text-sm leading-relaxed text-gray-600 sm:text-base">
              店舗ごとにExcelを集める運用から、リアルタイムに全店舗を横断して確認できる運用へ。
              1店舗でも多店舗でも、同じ仕組みで運用できます。
            </p>
            <Link href="/features/multi-store" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary-deep">
              詳しく見る <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <Reveal>
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <div className="grid grid-cols-3 gap-3">
                {['A店', 'B店', 'C店'].map((store) => (
                  <div key={store} className="rounded-xl bg-surface p-4 text-center">
                    <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-deep">
                      {store[0]}
                    </span>
                    <p className="mt-2 text-xs font-semibold text-navy">{store}</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-xs leading-relaxed text-gray-400">
                店舗を切り替えず、並べて比較できます
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 11. SCREEN SHOWCASE */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Screens" title="実際の利用シーン" align="left" />
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <Reveal>
              <figure className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <Screenshot src="/lp-qr-order.png" alt="お客様がテーブルのQRコードからスマートフォンで注文する様子" device="plain" />
                <figcaption className="px-5 py-4">
                  <p className="text-sm font-bold text-navy">QRオーダー</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    テーブルのQRコードからお客様自身が注文。アプリのインストールは不要です。
                  </p>
                </figcaption>
              </figure>
            </Reveal>
            <Reveal delay={80}>
              <figure className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <Screenshot src="/lp-kds.png" alt="厨房のキッチンディスプレイで注文状況を確認する調理スタッフ" device="plain" />
                <figcaption className="px-5 py-4">
                  <p className="text-sm font-bold text-navy">キッチンディスプレイ（KDS）</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    注文はリアルタイムで厨房に表示。調理状況を提供までタッチで管理します。
                  </p>
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 12. SECURITY */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading eyebrow="Security" title="安心して使える設計" />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {SECURITY_ITEMS.map((s, i) => (
            <Reveal key={s.title} delay={i * 70}>
              <div className="h-full rounded-2xl border border-gray-200 bg-white p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary-deep">
                  <s.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="mt-4 text-sm font-bold text-navy">{s.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link href="/security" className="inline-flex items-center gap-1 text-sm font-medium text-primary-deep">
            セキュリティについて詳しく <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* 13. 導入の流れ */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Onboarding" title="導入の流れ" />
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {ONBOARDING_STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 60}>
                <div className="h-full rounded-2xl border border-gray-200 bg-white p-5">
                  <span className="text-xs font-semibold text-primary">{step.step}</span>
                  <p className="mt-2 text-sm font-bold text-navy">{step.title}</p>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 14. FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading title="よくある質問" />
        <div className="mt-10">
          <FaqAccordion items={FAQ_ITEMS} />
        </div>
      </section>

      {/* 15. FINAL CTA */}
      <FinalCta />
    </>
  );
}
