import type { Metadata } from 'next';
import { brand } from '@/lib/brand';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: '利用規約',
  description:
    `${brand.name}（運営: ${brand.company}）のご利用にあたっての規約です。アカウント管理・禁止事項・料金・免責事項等を定めています。`,
  ...(siteUrl ? { alternates: { canonical: '/terms' } } : {}),
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <h1 className="text-3xl font-bold text-navy">利用規約</h1>

      <p className="mt-4 rounded-lg bg-warning-soft px-4 py-3 text-xs text-warning">
        （本文書はひな形です。正式表記は事業者確認後に差し替えてください）
      </p>

      <div className="prose-sm mt-10 space-y-8 text-sm leading-relaxed text-gray-700">
        <p>
          本利用規約（以下「本規約」といいます）は、{brand.company}（以下「当社」といいます）が提供するクラウド型店舗管理システム「{brand.name}」（以下「本サービス」といいます）の利用条件を定めるものです。ご契約企業様（以下「契約者」といいます）は、本規約に同意のうえ本サービスをご利用ください。
        </p>

        <section>
          <h2 className="text-lg font-bold text-navy">第1条（定義）</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>「契約者」とは、当社との間で本サービスの利用契約を締結した企業を指します。</li>
            <li>「利用者」とは、契約者が発行するアカウントにより本サービスを利用する契約者の従業員等を指します。</li>
            <li>「店舗データ」とは、利用者が本サービスに入力・登録した予約・売上・顧客等のデータを指します。</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">第2条（アカウント管理）</h2>
          <p className="mt-2">
            契約者は、利用者のアカウント発行・権限設定・利用停止を自らの責任において管理するものとします。アカウント情報の管理不備により生じた損害について、当社は責任を負いません。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">第3条（禁止事項）</h2>
          <p className="mt-2">利用者は、本サービスの利用にあたり、以下の行為を行ってはならないものとします。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>法令または公序良俗に違反する行為</li>
            <li>当社または第三者の権利を侵害する行為</li>
            <li>本サービスの不正利用、または不正アクセスを試みる行為</li>
            <li>他の契約者・利用者になりすます行為</li>
            <li>本サービスの運営を妨害する行為</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">第4条（料金と支払）</h2>
          <p className="mt-2">
            本サービスの利用料金は、契約者ごとに締結する契約条件に基づき定めるものとします。料金プランおよび支払方法の詳細は、契約締結時に別途ご案内します。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">第5条（データの取扱い・バックアップ）</h2>
          <p className="mt-2">
            店舗データの権利は契約者に帰属します。当社は、店舗データについて合理的な範囲でバックアップ体制を維持しますが、あらゆるデータ消失を防止することを保証するものではありません。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">第6条（サービス内容の変更・停止）</h2>
          <p className="mt-2">
            当社は、本サービスの内容を予告のうえ変更することがあります。また、システムメンテナンスその他やむを得ない事由がある場合、本サービスの提供を一時的に停止することがあります。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">第7条（免責事項）</h2>
          <p className="mt-2">
            当社は、本サービスに事実上または法律上の瑕疵がないことを明示的にも黙示的にも保証しません。本サービスの給与試算機能は試算値の提供にとどまり、法定の給与計算・税務申告を代替するものではありません。当社は、契約者が本サービスを利用したことにより生じた損害について、当社の故意または重過失による場合を除き、責任を負いません。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">第8条（解約）</h2>
          <p className="mt-2">
            契約者は、当社所定の手続きにより本サービスの利用契約を解約できます。解約後の店舗データの取扱いについては、契約条件に基づき別途定めます。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">第9条（準拠法・管轄裁判所）</h2>
          <p className="mt-2">
            本規約の解釈にあたっては日本法を準拠法とします。本サービスに関して紛争が生じた場合には、当社の本店所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">お問い合わせ</h2>
          <p className="mt-2">
            本規約に関するお問い合わせは、{brand.supportEmail} までご連絡ください。
          </p>
        </section>
      </div>
    </div>
  );
}
