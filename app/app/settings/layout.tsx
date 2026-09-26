import { requireMember } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { featureForRoute } from '@/lib/features';
import { canWriteAccounting } from '@/components/accounting/roles';
import { SettingsShell, type SettingsIconKey, type SettingsNavGroup, type SettingsNavItem } from '@/components/settings/settings-nav';

type Row = SettingsNavItem & { visible: boolean };

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // 各設定ページ側で権限を強制するため、ここでは表示判定のみ行う
  const ctx = await requireMember();
  const role = ctx.role;
  const featureOn = (href: string) => {
    const f = featureForRoute(href);
    return !f || !ctx.disabledFeatures.has(f);
  };

  // 各グループを「まとめ」1つにする（2026-09-27 Ronnie「設定は全部メニューみたいにまとめてきれいに」）。
  // 左メニューには 店舗／メニュー／デバイス管理／予約・顧客／会計／運用・管理 の6つだけ。中の画面は上のタブで切り替える
  const groups: { label: string; en: string; icon: SettingsIconKey; rows: Row[] }[] = [
    {
      label: '店舗',
      en: 'Store',
      icon: 'store',
      rows: [
        { href: '/app/settings/store', label: '店舗情報', en: 'Store', icon: 'store', description: '名称・住所・連絡先・紹介文・公開予約URL', visible: true, hubDefault: true },
        { href: '/app/settings/hours', label: '営業時間・休業日', en: 'Hours', icon: 'hours', description: '曜日別の営業時間、定休日、臨時休業の設定', visible: true },
        { href: '/app/settings/clerks', label: 'POS担当者', en: 'Clerks', icon: 'clerks', description: '会計時に選ぶ担当者名の登録（アカウント不要）', visible: true },
        { href: '/app/settings/company', label: '企業情報', en: 'Company', icon: 'company', description: '会社名・住所・連絡先・請求情報の管理', visible: can(role, 'org.settings') },
      ],
    },
    {
      // 2026-09-23 dinii と同じく メニュー／プラン／オプション／カテゴリ を別の画面に分けた（全店舗共通）
      label: 'メニュー',
      en: 'Menu',
      icon: 'menu',
      rows: [
        { href: '/app/settings/menu', label: 'メニュー', en: 'Menu', icon: 'menu', description: '単品の商品の登録、価格、英語名、売切管理', visible: can(role, 'menu.manage'), exact: true },
        { href: '/app/settings/plans', label: 'プラン', en: 'Plans', icon: 'plans', description: 'コース・飲み放題・食べ放題の価格と時間', visible: can(role, 'menu.manage') },
        { href: '/app/settings/options', label: 'オプション', en: 'Options', icon: 'options', description: 'サイズ・トッピング等の選択肢と追加料金', visible: true },
        { href: '/app/settings/categories', label: 'カテゴリ', en: 'Categories', icon: 'categories', description: 'カテゴリの追加・名前・色と、キッチン／ドリンク／焼き場への振り分け', visible: can(role, 'menu.manage') },
        { href: '/app/settings/menu-book', label: 'メニューブック', en: 'Menu book', icon: 'menubook', description: 'ハンディ・お客様QRのカテゴリの並び順と出し方、プランで出すカテゴリ', visible: can(role, 'menu.manage') },
        { href: '/app/settings/menu-bulk', label: '一括編集', en: 'Bulk edit', icon: 'bulk', description: '商品名・カテゴリ・価格・表示・売切を表でまとめて変更', visible: can(role, 'menu.manage') },
        { href: '/app/settings/dynamic-pricing', label: 'ダイナミックプライシング', en: 'Dynamic pricing', icon: 'dynamic', description: '曜日・時間帯で値段を自動で変える（ハッピーアワー・深夜料金）', visible: can(role, 'menu.manage') },
      ],
    },
    {
      label: 'デバイス管理',
      en: 'Devices',
      icon: 'printers',
      rows: [
        // メニュー一覧から移したので、設定の中から開けるようにする（2026-09-23 要望）
        { href: '/app/pos/settings', label: 'レジの設定', en: 'Register settings', icon: 'printers', description: '厨房伝票・品切れ・メニュー・QR・ハンディなど、レジで変える設定', visible: can(role, 'pos.order'), matchActive: false },
        { href: '/app/settings/printers', label: 'ハードウェア', en: 'Hardware', icon: 'printers', description: 'レジ端末とレシート・厨房プリンター、キャッシュドロアの設定', visible: true },
        { href: '/app/settings/handy-qr', label: 'iPhoneハンディ', en: 'Handy QR', icon: 'qr', description: 'お店に1つの固定QRでハンディにログイン（お店のWi-Fiだけ・外に出ると自動ログアウト）', visible: true },
        { href: '/app/settings/handy', label: 'ハンディ端末', en: 'Handy devices', icon: 'handy', description: 'スマホをQRコードでハンディとして登録・解除する', visible: true },
        { href: '/app/settings/tables/qr-print', label: 'テーブルQRコード', en: 'TableCode', icon: 'qr', description: '全テーブルのQR注文コードをまとめて印刷（1卓ずつの発行・停止はテーブル・フロアから）', visible: true },
      ],
    },
    {
      label: '予約・顧客',
      en: 'Booking',
      icon: 'booking',
      rows: [
        { href: '/app/settings/reservation-book', label: 'ご予約台帳設定', en: 'Reservation book', icon: 'booking', description: 'グルメサイト（食べログ・ホットペッパー・ぐるなび…）の予約を自動で台帳に取り込む', visible: true },
        { href: '/app/settings/booking', label: '予約受付ルール', en: 'Booking rules', icon: 'booking', description: '予約枠間隔・受付期間・キャンセル期限', visible: true },
        { href: '/app/settings/tables', label: 'テーブル・フロア', en: 'Tables', icon: 'tables', description: 'フロア構成、テーブルの席数・種別・利用停止', visible: true, exact: true },
        { href: '/app/staff', label: 'スタッフ・権限', en: 'Staff', icon: 'staff', description: 'スタッフの招待・役割（権限）・利用停止', visible: can(role, 'staff.manage') && featureOn('/app/staff'), matchActive: false },
      ],
    },
    {
      label: '会計',
      en: 'Payments',
      icon: 'payments',
      rows: [
        { href: '/app/settings/payments', label: '決済・端末', en: 'Payments', icon: 'payments', description: 'Stripe接続・決済端末・予約事前決済', visible: true },
        { href: '/app/settings/tax', label: '税率', en: 'Tax', icon: 'tax', description: '税率マスタの登録・既定税率の設定', visible: true },
        { href: '/app/settings/accounts', label: '勘定科目', en: 'Accounts', icon: 'accounts', description: '複式簿記の勘定科目マスタの登録', visible: canWriteAccounting(role) },
        { href: '/app/settings/approvals', label: '承認ルール', en: 'Approvals', icon: 'approvals', description: '金額帯別の必要承認ロール・自己承認可否の設定', visible: can(role, 'org.settings') },
      ],
    },
    {
      label: '運用・管理',
      en: 'Operations',
      icon: 'integrations',
      rows: [
        { href: '/app/settings/loyalty', label: '会員・ポイント', en: 'Loyalty', icon: 'loyalty', description: 'ポイント付与率・利用設定（例: 100円=1pt）', visible: can(role, 'org.settings') },
        { href: '/app/settings/alerts', label: '異常検知の閾値', en: 'Alerts', icon: 'alerts', description: '現金差異・値引率・原価率・人件費率などの閾値', visible: true },
        { href: '/app/settings/import', label: 'データ取込', en: 'Import', icon: 'import', description: 'CSVから商品・顧客・仕入先・在庫品目を一括登録', visible: can(role, 'org.settings') },
        { href: '/app/settings/integrations', label: '連携', en: 'Integrations', icon: 'integrations', description: '決済・プリンター・外部サービス連携の状態確認', visible: true },
        { href: '/app/settings/audit', label: '監査ログ', en: 'Audit log', icon: 'audit', description: '権限変更・停止・設定変更などの操作履歴', visible: can(role, 'audit.view') },
      ],
    },
  ];

  const hubs: SettingsNavItem[] = groups
    .map((g) => {
      const kids = g.rows.filter((r) => r.visible).map(({ visible: _visible, ...item }) => item);
      if (kids.length === 0) return null;
      const hub: SettingsNavItem = {
        href: kids[0].href,
        label: g.label,
        en: g.en,
        icon: g.icon,
        description: kids.map((k) => k.label).join('・'),
        hub: true,
        children: kids,
        hubDefault: kids.some((k) => k.hubDefault),
      };
      return hub;
    })
    .filter((h): h is SettingsNavItem => h !== null);
  // 見出しなしの1グループ（まとめ6つだけの一覧）
  const navGroups: SettingsNavGroup[] = [{ label: '', en: '', items: hubs }];

  return <SettingsShell groups={navGroups}>{children}</SettingsShell>;
}
