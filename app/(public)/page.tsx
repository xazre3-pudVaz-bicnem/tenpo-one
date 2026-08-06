import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Globe, BookOpen, MonitorSmartphone, CreditCard, Banknote, Wallet, FileText,
  Clock, JapaneseYen, Users, BarChart3, Building2, ShieldCheck, Lock, ScrollText,
  Mail, ArrowRight, Building, UserCog, Smartphone, Printer, MessageCircle, ScanText, Link2, Calculator,
} from 'lucide-react';
import { brand } from '@/lib/brand';
import { buttonVariants } from '@/components/ui/button';
import { FeatureGrid, type FeatureItem } from '@/components/marketing/feature-grid';
import { DataFlow } from '@/components/marketing/data-flow';
import { FaqAccordion, type FaqItem } from '@/components/marketing/faq-accordion';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: {
    absolute: `${brand.name}｜${brand.tagline} 飲食店向け店舗管理システム`,
  },
  description:
    '予約・POS・会計・勤怠・給与・顧客管理をひとつのデータでつなぐ飲食店向けクラウド型店舗管理システム。多店舗展開の本社業務から店舗オペレーションまでを1画面に統合します。',
  ...(siteUrl ? { alternates: { canonical: '/' } } : {}),
};

const PROBLEM_CARDS = [
  {
    title: 'ツールがバラバラで再入力',
    desc: '予約サイト・POS・勤怠SaaS・Excelがバラバラで、同じ情報を何度も手入力している。',
  },
  {
    title: 'レジ締めと日報に時間がかかる',
    desc: '現金の数え合わせと日報作成が毎日の締め作業を圧迫し、閉店後の残業につながっている。',
  },
  {
    title: '全店の数字がすぐに見えない',
    desc: '本社は店舗ごとのExcelが集まるまで待たされ、朝一で全店の売上・客数を把握できない。',
  },
];

const FEATURES: FeatureItem[] = [
  { icon: Globe, title: 'オンライン予約', desc: '店舗ページから空席検索〜予約確定までをWebで完結。' },
  { icon: BookOpen, title: '予約台帳', desc: 'テーブル×時間軸のタイムラインで予約とウォークインを一元管理。' },
  { icon: MonitorSmartphone, title: 'POSレジ', desc: 'タブレットで注文入力から会計まで、迷わない画面設計。' },
  { icon: CreditCard, title: '会計・決済', desc: '店内・テイクアウトの税率(10%/8%)を自動判定して会計。' },
  { icon: Banknote, title: 'レジ締め', desc: 'セッション開閉と現金過不足の記録で日次締めを標準化。' },
  { icon: Wallet, title: '小口現金管理', desc: '入出金の記録と承認フローで釣銭準備金までを一元管理。' },
  { icon: FileText, title: '請求書・書類管理', desc: 'アップロードと支払期限アラートで書類の抜け漏れを防止。' },
  { icon: Clock, title: '勤怠打刻', desc: '個人端末・共用端末どちらからも打刻でき、修正申請も画面で完結。' },
  { icon: JapaneseYen, title: '給与試算', desc: '勤怠実績から給与・歩合の試算値を自動計算（試算値であり法定給与計算の代替ではありません）。' },
  { icon: Users, title: '顧客管理', desc: '来店回数・累計利用額・アレルギーや接客メモを予約とPOSの双方から参照。' },
  { icon: BarChart3, title: 'レポート・経営分析', desc: '期間・店舗・軸別のグラフと明細ドリルダウンで経営判断を支援。' },
  { icon: Building2, title: 'マルチ店舗・権限管理', desc: '店舗ごとのロール権限で、本社は全店横断、店舗は自店のみに制御。' },
];

const ROADMAP = [
  { icon: Printer, title: 'プリンターSDK連携', desc: 'レシート・キッチンプリンターとの直接連携（現状はブラウザ印刷）。' },
  { icon: MessageCircle, title: 'LINE連携', desc: '予約通知・来店促進のLINE公式アカウント連携。' },
  { icon: ScanText, title: '請求書OCR', desc: '請求書画像からの項目自動読み取り（結果は必ず人が確認）。' },
  { icon: Link2, title: '外部予約サイト連携', desc: 'グルメサイト等の外部予約チャネルとの在庫・予約連携。' },
  { icon: Calculator, title: '正式給与計算', desc: '社会保険・源泉徴収・年末調整を含む法定給与計算への対応。' },
];

const PERSPECTIVES = [
  {
    icon: Building,
    role: '本社・オーナー',
    title: '全店ダッシュボードで比較する',
    desc: '選択した店舗、または全店舗の売上・客数・アラートを1画面で確認し、店舗間の実績を比較できます。',
  },
  {
    icon: UserCog,
    role: '店長',
    title: '台帳からPOSまで1台で',
    desc: '予約台帳・フロアマップ・レジ締め・発注・シフト作成までをタブレット1台で完結できます。',
  },
  {
    icon: Smartphone,
    role: 'ホールスタッフ',
    title: '迷わない打刻とPOS',
    desc: '出退勤の打刻と注文・会計の操作だけに絞った画面で、新人でもすぐに使いこなせます。',
  },
];

const SECURITY = [
  { icon: Lock, title: '企業間データ分離（RLS）', desc: 'Supabaseの行レベルセキュリティにより、契約企業ごとにデータベースレベルでアクセスを分離します。' },
  { icon: ShieldCheck, title: 'ロール別権限制御', desc: '本社・店長・スタッフなど9段階のロールで、閲覧・操作できる範囲を機能単位で制御します。' },
  { icon: ScrollText, title: '監査ログ', desc: '金額・勤怠・請求書・取消など重要操作は監査ログに記録し、物理削除を行いません。' },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    question: '導入の流れを教えてください',
    answer: 'お問い合わせ後、ヒアリングのうえ企業アカウントを発行します。店舗情報・メニュー・スタッフを登録いただければ運用を開始できます。導入時期や移行方法はご相談内容に応じて個別にご案内します。',
  },
  {
    question: '対応端末を教えてください',
    answer: 'Webブラウザで動作するため、PC・タブレット・スマートフォンで利用できます。POSレジ画面はタッチ操作を前提としたタブレットでの利用を推奨しています。',
  },
  {
    question: '複数店舗の展開に対応していますか',
    answer: 'はい。1つの契約企業のもとに複数店舗を登録し、本社ロールは全店舗を横断して閲覧・比較できます。店舗ごとにアクセスできるスタッフを制御することも可能です。',
  },
  {
    question: '既存データの移行はできますか',
    answer: '既存の予約・顧客データ等の移行はご相談内容に応じて個別に対応します。移行手順や対応範囲は導入時のヒアリングで確認させてください。',
  },
  {
    question: '料金はいくらですか',
    answer: '店舗数や利用機能に応じたプランをご用意しています。料金ページに目安を掲載していますが、正式な料金は導入時のご相談内容に応じて決定します。',
  },
  {
    question: 'サポート体制を教えてください',
    answer: 'メールでのお問い合わせに加え、運営チームによる操作サポートに対応しています。重要な操作はすべて記録されるため、トラブル時も状況を確認しながらサポートできます。',
  },
];

export default function HomePage() {
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
        '予約・POS・会計・勤怠・給与・顧客管理をひとつのデータでつなぐ飲食店向けクラウド型店舗管理システム。',
      ...(siteUrl ? { url: siteUrl } : {}),
      provider: { '@type': 'Organization', name: brand.company },
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ① ヒーロー */}
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              {brand.taglineEn}
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-navy sm:text-5xl">
              <span className="bg-gradient-to-r from-[#7B3FF2] to-[#5A2ED6] bg-clip-text text-transparent">
                店舗運営を、
              </span>
              ひとつに。
            </h1>
            <p className="mt-5 text-base leading-relaxed text-gray-600 sm:text-lg">
              オンライン予約・予約台帳・POS・会計・レジ締め・勤怠・給与・顧客管理・経営分析。
              飲食店の運営に必要な業務を、同じデータでつながる1つのプラットフォームに統合します。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className={buttonVariants({ size: 'lg' })}>
                ログイン
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={`mailto:${brand.supportEmail}`}
                className={buttonVariants({ size: 'lg', variant: 'secondary' })}
              >
                <Mail className="h-4 w-4" />
                お問い合わせ
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ② 課題提起 */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-center text-2xl font-bold text-navy sm:text-3xl">
          こんな悩みで、営業時間を削られていませんか
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {PROBLEM_CARDS.map((c) => (
            <div key={c.title} className="rounded-2xl border border-gray-200 bg-white p-6">
              <p className="text-base font-bold text-navy">{c.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ③ 解決コンセプト */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold text-navy sm:text-3xl">
              すべての業務が、同じデータでつながる
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-600 sm:text-base">
              予約から給与試算まで、同じ organization / store / customer / order のデータが連鎖します。
              同じ内容を複数の画面へ再入力する必要はありません。
            </p>
          </div>
          <div className="mt-10">
            <DataFlow />
          </div>
        </div>
      </section>

      {/* ④ 主要機能 */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-center text-2xl font-bold text-navy sm:text-3xl">主要機能</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-gray-500">
          現在ご利用いただける機能です。すべて同じデータベース上で連動します。
        </p>
        <div className="mt-10">
          <FeatureGrid items={FEATURES} />
        </div>
      </section>

      {/* ⑤ 3つの視点 */}
      <section className="bg-navy py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">
            立場ごとに、必要な画面だけを
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {PERSPECTIVES.map((p) => (
              <div key={p.role} className="rounded-2xl bg-navy-soft p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
                  <p.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-primary">{p.role}</p>
                <p className="mt-1 text-base font-bold text-white">{p.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ⑥ セキュリティ */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-center text-2xl font-bold text-navy sm:text-3xl">セキュリティ</h2>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {SECURITY.map((s) => (
            <div key={s.title} className="rounded-2xl border border-gray-200 bg-white p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary-deep">
                <s.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-4 text-sm font-bold text-navy">{s.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ⑦ 今後のロードマップ */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-navy sm:text-3xl">今後のロードマップ</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-600">
            以下は開発予定の機能です。契約・認証情報・実機検証が完了するまでは「対応済み」として提供しません。
          </p>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ROADMAP.map((r) => (
              <div key={r.title} className="flex items-start gap-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                  <r.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-navy">{r.title}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">開発予定</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ⑧ FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-center text-2xl font-bold text-navy sm:text-3xl">よくある質問</h2>
        <div className="mt-10">
          <FaqAccordion items={FAQ_ITEMS} />
        </div>
      </section>

      {/* ⑨ 最終CTA */}
      <section className="bg-navy">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            {brand.tagline}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-gray-400 sm:text-base">
            まずはお問い合わせください。店舗数や現在お使いのツールをお聞かせいただければ、導入についてご案内します。
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/login" className={buttonVariants({ size: 'lg' })}>
              ログイン
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={`mailto:${brand.supportEmail}`}
              className={buttonVariants({ size: 'lg', variant: 'secondary' })}
            >
              <Mail className="h-4 w-4" />
              お問い合わせ
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
