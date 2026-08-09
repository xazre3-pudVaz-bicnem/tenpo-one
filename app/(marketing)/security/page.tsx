import type { Metadata } from 'next';
import { Mail } from 'lucide-react';
import {
  Building2,
  UserCog,
  ScrollText,
  LogOut,
  UploadCloud,
  DatabaseBackup,
  ShieldAlert,
} from 'lucide-react';
import { brand } from '@/lib/brand';
import { buttonVariants } from '@/components/ui/button';
import { SectionHeading, Breadcrumbs, FinalCta } from '@/components/marketing/primitives';
import { Reveal } from '@/components/marketing/reveal';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: 'セキュリティ',
  description:
    `${brand.name}のセキュリティ設計をご紹介します。企業単位のデータ分離、ロール別権限制御、監査ログ、バックアップ・復旧の方針など、店舗データを守るための設計方針を掲載しています。`,
  ...(siteUrl ? { alternates: { canonical: '/security' } } : {}),
};

interface SecurityTopic {
  icon: typeof Building2;
  eyebrow: string;
  title: string;
  description: string;
}

const TOPICS: SecurityTopic[] = [
  {
    icon: Building2,
    eyebrow: '01',
    title: '企業ごとにデータを分離する設計',
    description:
      `${brand.name}は1つのデータベースで複数の契約企業のデータを取り扱いますが、注文・顧客・売上などの主要なデータは、企業ID単位でアクセスできる範囲を区切っています。他社のデータをIDで直接指定してもデータベース側で拒否される設計で、企業間でデータが混ざらないよう境界を強制しています（この仕組みは技術的には「行レベルセキュリティ（RLS）」と呼ばれます）。`,
  },
  {
    icon: UserCog,
    eyebrow: '02',
    title: '9段階のロールで、見える範囲・できる操作を分ける',
    description:
      '契約企業オーナー・本社管理者・本社経理担当・エリアマネージャー・店長・副店長・一般スタッフ・アルバイト・外部税理士等、9段階のロールを用意し、閲覧・登録・承認・削除といった操作をロールごとに制御します。全店舗を横断できる本社ロールと、自店舗の業務に絞られる店舗ロールを分けることで、必要な人に必要な範囲だけ情報を届けます。権限の確認は画面表示だけでなく、サーバー側・データベース側でも重ねて行う設計です。',
  },
  {
    icon: ScrollText,
    eyebrow: '03',
    title: '重要な操作は記録し、あとから確認できる',
    description:
      '金額の確定・返金・勤怠の修正・請求書の操作・取消（VOID）など、業務上重要な操作は監査ログに記録されます。誰が・いつ・何を行ったかを後から確認できるほか、確定した会計データ（入金・返金の記録等）は物理的に削除できない設計にしており、誤操作からの復旧性を高めています。',
  },
  {
    icon: LogOut,
    eyebrow: '04',
    title: '利用停止・退職したユーザーを、次のアクセスから遮断',
    description:
      'アカウントが利用停止となったユーザーや退職したユーザーは、次回のアクセス時点でシステムから遮断されます。ロールや所属店舗が変更された場合も、次のリクエストから新しい権限が反映されます。契約企業自体が利用停止・解約となった場合も、ログインができない状態に切り替わります。',
  },
  {
    icon: UploadCloud,
    eyebrow: '05',
    title: 'アップロードファイルを検証し、企業ごとにアクセスを制御',
    description:
      '請求書・領収書などのアップロードは、ファイルの種類・拡張子・サイズをサーバー側で検証しています。保存場所も契約企業ごとに区切られており、非公開の書類は自社が保存したファイルのみ閲覧できる設計です。他社が保存したファイルは、URLを推測しても取得できません。書類の共有には有効期限付きのURLを用い、期限が切れれば無効になります。',
  },
  {
    icon: DatabaseBackup,
    eyebrow: '06',
    title: '定期的なバックアップと、時点復旧を前提とした設計',
    description:
      'データベースは定期的なバックアップに加え、特定時点への復旧（ポイント・イン・タイム・リカバリ）を前提とした復旧設計を行っています。復旧にかかる時間や許容できるデータ損失の範囲については社内で目標値を定めていますが、これはあくまで目標であり、保証された値ではありません。正式な保持期間・バックアップ方式は、データベース基盤（Supabase）のプラン契約内容に応じて確定します。',
  },
  {
    icon: ShieldAlert,
    eyebrow: '07',
    title: '会計や返金などの重要処理は、中途半端な状態を残さない',
    description:
      '会計の確定・返金・レジ締め・給与確定などの重要な処理は、途中で例外的なエラーが発生した場合でも処理全体を取り消し、一部だけ反映された不整合な状態を残さない設計にしています。障害発生時は、エラーIDを画面に表示し、社内の記録と突き合わせて原因を追跡できるようにしています。',
  },
];

export default function SecurityPage() {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ホーム', ...(siteUrl ? { item: siteUrl } : {}) },
        { '@type': 'ListItem', position: 2, name: 'セキュリティ' },
      ],
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero */}
      <section className="bg-surface">
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-10">
          <Breadcrumbs items={[{ label: 'ホーム', href: '/' }, { label: 'セキュリティ' }]} />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Security</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-navy sm:text-4xl">
            お客様の店舗データを、企業単位で分離して守る
          </h1>
          <p className="mt-5 text-base leading-relaxed text-gray-600">
            {brand.name}は、複数の飲食店企業に同時にご利用いただくクラウドサービスです。売上・顧客・勤怠・給与といった
            機密性の高いデータを扱うため、企業間の分離、権限による操作制御、重要操作の記録、バックアップ・復旧を
            前提とした設計を行っています。このページでは、その考え方を分かりやすくご紹介します。
          </p>
        </div>
      </section>

      {/* Topics */}
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {TOPICS.map((topic, i) => (
          <Reveal key={topic.title} delay={i * 60}>
            <section className="border-t border-gray-100 py-12 first:border-t-0 sm:py-14">
              <div className="flex items-start gap-4 sm:gap-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-deep">
                  <topic.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <SectionHeading eyebrow={topic.eyebrow} title={topic.title} align="left" />
                  <p className="mt-4 text-sm leading-relaxed text-gray-600 sm:text-base">{topic.description}</p>
                </div>
              </div>
            </section>
          </Reveal>
        ))}
      </div>

      {/* Note + inline contact */}
      <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6 sm:pb-20">
        <div className="rounded-2xl bg-surface p-6 text-center sm:p-8">
          <p className="text-sm font-medium text-navy">
            セキュリティに関するご質問やご確認事項がございましたら、お気軽にお問い合わせください。
          </p>
          <a href={`mailto:${brand.supportEmail}`} className={`${buttonVariants({ size: 'lg' })} mt-4`}>
            <Mail className="h-4 w-4" />
            セキュリティについてお問い合わせ
          </a>
        </div>
        <p className="mt-8 text-center text-xs leading-relaxed text-gray-400">
          ※ 記載は現時点の設計・運用方針です。
        </p>
      </div>

      <FinalCta />
    </>
  );
}
