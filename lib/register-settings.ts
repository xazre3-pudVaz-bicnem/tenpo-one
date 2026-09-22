/**
 * レジの設定（POSレジ・フロア・注文画面から開く /app/pos/settings）に並べる項目（純関数・テスト対象）。
 * 2026-09-21 店舗要望「レジから今までのこと（厨房伝票・メニュー・品切れ・QR など）を変えられるように」。
 * 設定は各画面にあるが、レジからは場所が分かりにくかったため、レジの言葉でまとめて並べる。
 * ここから開いた画面には ?from=register を付け、設定画面の上に「レジの設定に戻る」を出す。
 */
import { can, type PermissionAction, type Role } from './permissions';

/** レジの設定の画面 */
export const REGISTER_SETTINGS_PATH = '/app/pos/settings';

/** レジの設定から開いた印（クエリ from の値） */
export const FROM_REGISTER = 'register';

export interface RegisterSettingLink {
  id: string;
  title: string;
  description: string;
  /** 開く画面（クエリ付きも可） */
  href: string;
  /** 開いた先の画面が求める権限（無い人には押せない形で出す） */
  permission: PermissionAction;
}

export interface RegisterSettingSection {
  id: string;
  title: string;
  en: string;
  links: RegisterSettingLink[];
}

/**
 * 並び: レジでよく変えるもの（品切れ・メニュー）→ キッチン・ドリンク → テーブル・QR → ハンディ・担当者 → 予約・営業時間。
 * 厨房伝票（分け方・文字の大きさ・商品名の言語）は画面の先頭でその場で変える（ここには入れない）。
 */
export const REGISTER_SETTING_SECTIONS: readonly RegisterSettingSection[] = [
  {
    id: 'menu',
    title: 'メニュー',
    en: 'Menu',
    links: [
      {
        id: 'sold-out',
        title: '品切れ（売切・販売再開）',
        description: '売切にした商品は、レジ・ハンディ・お客様QRで注文できなくなります',
        href: '/app/pos/sold-out',
        permission: 'pos.order',
      },
      {
        id: 'menu-items',
        title: '商品の追加・編集',
        description: '商品名・値段・英語名・カテゴリ・販売時間',
        href: '/app/settings/menu',
        permission: 'menu.manage',
      },
      {
        id: 'plan-items',
        title: 'プラン（コース・飲み放題）',
        description: 'コース・飲み放題・食べ放題の価格と時間（フロアの残り時間・L.O.）',
        href: '/app/settings/plans',
        permission: 'menu.manage',
      },
      {
        id: 'categories',
        title: 'カテゴリの追加・名前',
        description: 'カテゴリの追加・名前・色',
        href: '/app/settings/categories',
        permission: 'menu.manage',
      },
      {
        id: 'item-order',
        title: '商品の並び順',
        description: 'カテゴリごとに矢印で並べ替え（レジ・ハンディ・お客様QRで同じ順）',
        href: '/app/settings/menu-book?tab=items',
        permission: 'menu.manage',
      },
      {
        id: 'category-order',
        title: 'カテゴリの順番・ハンディ／QRでの出し方',
        description: 'いつも出す／プランのときだけ／ランチだけ／スタッフだけ／出さない',
        href: '/app/settings/menu-book?tab=categories',
        permission: 'menu.manage',
      },
      {
        id: 'pages',
        title: 'ページ（タブのまとめ方）',
        description: 'SOUP・APPETIZER・SALAD のように、続くカテゴリを1つのタブにまとめる',
        href: '/app/settings/menu-book?tab=pages',
        permission: 'menu.manage',
      },
      {
        id: 'plans',
        title: 'プランで出すカテゴリ',
        description: '飲み放題 A・AB・ABC やコースごとに、ハンディ・お客様QRに出すカテゴリ',
        href: '/app/settings/menu-book?tab=plans',
        permission: 'menu.manage',
      },
      {
        id: 'lunch',
        title: 'ランチの時間',
        description: 'ランチだけのカテゴリを出す時間帯',
        href: '/app/settings/menu-book?tab=lunch',
        permission: 'menu.manage',
      },
      {
        id: 'options',
        title: '選択肢（サイズ・トッピング）',
        description: '商品に付ける選択肢と追加料金',
        href: '/app/settings/options',
        permission: 'store.settings',
      },
    ],
  },
  {
    id: 'kitchen',
    title: 'キッチン・ドリンク',
    en: 'Kitchen & drink',
    links: [
      {
        id: 'stations',
        title: 'ドリンク機・キッチン機への振り分け',
        description: 'カテゴリごとに出す厨房プリンター（カテゴリの「KDSステーション振り分け」）',
        href: '/app/settings/categories',
        permission: 'menu.manage',
      },
      {
        id: 'printers',
        title: 'プリンターのテスト印刷・接続',
        description: 'レシート・キッチン・ドリンクのプリンター',
        href: '/app/settings/printers',
        permission: 'store.settings',
      },
    ],
  },
  {
    id: 'tables',
    title: 'テーブル・QR',
    en: 'Tables & QR',
    links: [
      {
        id: 'qr-print',
        title: 'テーブルQRをまとめて印刷',
        description: 'A4 に6枚ずつ。貼り替え用（QRの中身は変わりません）',
        href: '/app/settings/tables/qr-print',
        permission: 'store.settings',
      },
      {
        id: 'tables',
        title: 'テーブル・フロア',
        description: '席数・利用停止・1卓ずつのQRの発行',
        href: '/app/settings/tables',
        permission: 'store.settings',
      },
    ],
  },
  {
    id: 'handy',
    title: 'ハンディ・担当者',
    en: 'Handy & clerks',
    links: [
      {
        id: 'handy-qr',
        title: 'iPhoneハンディ（QRでログイン）',
        description: 'お店に1つの固定QR。お店のWi-Fiで読むとハンディが開き、Wi-Fiの外に3分でログアウト',
        href: '/app/settings/handy-qr',
        permission: 'store.settings',
      },
      {
        id: 'handy',
        title: 'ハンディ端末の登録・解除',
        description: 'スマホを QR コードでハンディとして登録する',
        href: '/app/settings/handy',
        permission: 'store.settings',
      },
      {
        id: 'clerks',
        title: 'POS担当者',
        description: 'レジ・ハンディで選ぶ担当者名',
        href: '/app/settings/clerks',
        permission: 'store.settings',
      },
    ],
  },
  {
    id: 'booking',
    title: '予約・営業時間',
    en: 'Booking & hours',
    links: [
      {
        id: 'booking',
        title: '予約受付ルール',
        description: '予約枠の間隔（15分・30分など）・受付期間・キャンセル期限',
        href: '/app/settings/booking',
        permission: 'store.settings',
      },
      {
        id: 'hours',
        title: '営業時間・休業日',
        description: '曜日ごとの営業時間・定休日・臨時休業',
        href: '/app/settings/hours',
        permission: 'store.settings',
      },
    ],
  },
];

/** 注文画面から開いたときの伝票 id（UUID だけ受け付ける） */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerOrderId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/** 開く画面のURLに「レジの設定から開いた」印（と、戻り先の伝票）を付ける */
export function withFromRegister(href: string, orderId?: string | null): string {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set('from', FROM_REGISTER);
  const order = registerOrderId(orderId);
  if (order) params.set('order', order);
  return `${path}?${params.toString()}`;
}

/** レジの設定の画面（伝票から開いたときは、その伝票に戻れるように持ち回る） */
export function registerSettingsUrl(orderId?: string | null): string {
  const order = registerOrderId(orderId);
  return order ? `${REGISTER_SETTINGS_PATH}?order=${order}` : REGISTER_SETTINGS_PATH;
}

/** POSレジに戻るURL（伝票から開いたときはその伝票） */
export function registerBackUrl(orderId?: string | null): string {
  const order = registerOrderId(orderId);
  return order ? `/app/pos?order=${order}` : '/app/pos';
}

export interface RegisterSettingLinkView extends RegisterSettingLink {
  allowed: boolean;
  url: string;
}

export interface RegisterSettingSectionView extends Omit<RegisterSettingSection, 'links'> {
  links: RegisterSettingLinkView[];
}

/** ロールに合わせて押せる／押せないを付けた一覧 */
export function registerSettingSections(role: Role | null, orderId?: string | null): RegisterSettingSectionView[] {
  return REGISTER_SETTING_SECTIONS.map((section) => ({
    ...section,
    links: section.links.map((link) => ({
      ...link,
      allowed: can(role, link.permission),
      url: withFromRegister(link.href, orderId),
    })),
  }));
}

/** 権限の短い説明（押せない項目に出す） */
export function permissionHint(permission: PermissionAction): string {
  switch (permission) {
    case 'menu.manage':
    case 'store.settings':
      return '店長以上が変更できます';
    default:
      return '権限がありません';
  }
}
