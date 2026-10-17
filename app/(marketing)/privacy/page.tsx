import type { Metadata } from 'next';
import { brand } from '@/lib/brand';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: 'プライバシーポリシー',
  description:
    `${brand.name}（運営: ${brand.company}）におけるお客様情報の取得・利用目的・第三者提供・安全管理措置等を定めるプライバシーポリシーです。`,
  ...(siteUrl ? { alternates: { canonical: '/privacy' } } : {}),
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <h1 className="text-3xl font-bold text-navy">プライバシーポリシー</h1>

      <div className="prose-sm mt-10 space-y-8 text-sm leading-relaxed text-gray-700">
        <p>
          {brand.company}（以下「当社」といいます）は、当社が提供するクラウド型店舗管理システム「{brand.name}」（以下「本サービス」といいます）における、お客様の個人情報の取扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」といいます）を定めます。
        </p>

        <section>
          <h2 className="text-lg font-bold text-navy">1. 事業者情報</h2>
          <p className="mt-2">
            運営事業者: {brand.company}<br />
            お問い合わせ先: {brand.supportEmail}
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">2. 取得する情報</h2>
          <p className="mt-2">当社は、本サービスの提供にあたり、以下の情報を取得することがあります。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>契約企業のご担当者様の氏名・メールアドレス・電話番号</li>
            <li>本サービスをご利用になるスタッフの氏名・メールアドレス・勤怠情報等</li>
            <li>店舗をご利用になるお客様（エンドユーザー）の氏名・電話番号・予約履歴・来店履歴等</li>
            <li>決済・売上・請求書等の取引に関する情報</li>
            <li>本サービスの利用状況に関するログ情報</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">3. 利用目的</h2>
          <p className="mt-2">取得した情報は、以下の目的の範囲内で利用します。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>本サービスの提供・維持・改善のため</li>
            <li>契約企業様との連絡・サポート対応のため</li>
            <li>利用料金の請求・精算のため</li>
            <li>不正利用の防止、本サービスの安全な運用のため</li>
            <li>法令に基づく対応のため</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">4. 第三者提供</h2>
          <p className="mt-2">
            当社は、法令に定める場合を除き、あらかじめお客様の同意を得ることなく、第三者に個人情報を提供しません。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">5. 業務委託</h2>
          <p className="mt-2">
            当社は、利用目的の達成に必要な範囲内において、個人情報の取扱いの全部または一部を委託する場合があります。この場合、委託先に対して適切な監督を行います。主な委託先は、データの保管・サーバー運用のためのクラウドサービス事業者、およびスマートフォン・タブレットへの通知の配信を行う Apple Inc.（Apple Push Notification service）です。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">6. 安全管理措置</h2>
          <p className="mt-2">
            当社は、取り扱う個人情報の漏えい・滅失・毀損の防止その他の安全管理のため、アクセス制御・通信の暗号化・操作履歴の記録等、必要かつ適切な措置を講じます。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">7. 開示等の請求</h2>
          <p className="mt-2">
            お客様は、当社が保有する自己の個人情報について、開示・訂正・利用停止等を請求することができます。ご希望の場合は、下記のお問い合わせ先までご連絡ください。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">8. Cookie等の利用</h2>
          <p className="mt-2">
            本サービスは、ログイン状態の維持や店舗選択状態の保持のため、Cookieを利用します。Cookieには個人を特定する情報は含まれません。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">9. iPhone・iPad アプリ（{brand.name}）について</h2>
          <p className="mt-2">
            {brand.name} の iPhone・iPad アプリ（以下「本アプリ」といいます）は、店舗のスタッフ・オーナーが本サービスを使うためのアプリです。本アプリは、以下の端末の機能を、お客様が許可した場合に限り、記載の目的のためだけに使います。
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>カメラ：お店の QR コードの読み取り（ハンディのログイン）、レシート・請求書の撮影</li>
            <li>写真：レシート・請求書の写真を選んで添付するとき</li>
            <li>ローカルネットワーク：店内の Wi-Fi・LAN のレシートプリンター・キッチンプリンターとの接続</li>
            <li>Bluetooth：Bluetooth のレシートプリンター（キャッシュドロア）との接続</li>
            <li>通知：新しい注文・呼び出し・予約などのお知らせ。通知の配信のため、端末の通知用の識別子（デバイストークン）を当社のサーバーに保存します</li>
          </ul>
          <p className="mt-2">
            撮影・選択した写真は、お客様が添付したときだけ本サービスに送信されます。本アプリは、広告の表示、広告目的の追跡（他社のアプリやウェブサイトをまたいだ追跡）、位置情報の取得、端末の連絡先の読み取りを行いません。各機能の許可は、端末の「設定」アプリからいつでも取り消すことができます。
          </p>
          <p className="mt-2">
            本アプリのアカウントは、本サービスの契約企業が発行・管理します。アカウントの削除をご希望の場合は、所属する企業の管理者、または下記のお問い合わせ先までご連絡ください。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">10. 本ポリシーの改定</h2>
          <p className="mt-2">
            当社は、必要に応じて本ポリシーを改定することがあります。改定後のポリシーは、本ページに掲載した時点から効力を生じるものとします。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-navy">11. お問い合わせ窓口</h2>
          <p className="mt-2">
            本ポリシーに関するお問い合わせは、{brand.supportEmail} までご連絡ください。
          </p>
        </section>

        <p className="text-right text-xs text-gray-500">2026年10月17日 改定</p>
      </div>
    </div>
  );
}
