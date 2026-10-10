import type { PermissionAction, Role } from '@/lib/permissions';
import { can } from '@/lib/permissions';
import { featureForRoute } from '@/lib/features';
import { isPhoneUserAgent, nativeAppMode } from '@/lib/device-kind';
import { ACCOUNTING_WRITE_ROLES } from '@/components/accounting/roles';

/**
 * 新しい管理画面（パソコン）— 2026-10-10 Ronnie「管理画面を新しいデザインに。ボタンは全部動くように。
 * iPad（レジ）とハンディは今のまま。変えないで、気をつけて」。
 *
 * - まずは試し：会社のオーナー（org_owner）が、パソコンのブラウザで「新しい管理画面を試す」を押したときだけ出る（cookie）。
 * - レジのアカウント（iPad）・ハンディ・スマホ・iPad の画面は、ON にしても絶対に出さない（今のまま）。
 * - 画面の URL・データ・権限は今のまま。新しいのは左メニュー・ホーム・店舗ナウ・設定の一覧だけ。
 * - デザインの元：Design「TENPO ONE 管理画面 レイアウト案」。
 */
export const ADMIN_V2_COOKIE = 'tenpo_admin_v2';

interface ViewerLike {
  role: Role | null;
  isRegisterDevice?: boolean;
  isHandyDevice?: boolean;
}

/** パソコンのブラウザか（iPad・Android タブレット・スマホ・TENPO ONE アプリは false） */
export function isDesktopUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return false;
  if (nativeAppMode(userAgent)) return false;
  if (isPhoneUserAgent(userAgent)) return false;
  if (ua.includes('ipad')) return false;
  if (ua.includes('android')) return false;
  return true;
}

/**
 * iPad の Safari（「デスクトップ用サイト」が既定）は Mac と同じ名乗り（Macintosh）なので、User-Agent だけでは分からない。
 * 画面のタッチ（navigator.maxTouchPoints > 1）で見分ける（Mac は 0）。サーバーでは分からないので画面側から渡す。
 */
export function isIpadDesktopMode(userAgent: string | null | undefined, touchPoints: number | null | undefined): boolean {
  return /macintosh/i.test(userAgent ?? '') && (touchPoints ?? 0) > 1;
}

/**
 * 新しい管理画面を試せる人（会社のオーナーのパソコンだけ。レジ・ハンディのアカウントは不可）。
 * touchPoints を渡したとき（画面側・ボタン）は、Mac を名乗る iPad も不可（2026-10-10 Ronnie「iPad とハンディは絶対に変えない」）。
 */
export function canTryAdminV2(
  ctx: ViewerLike,
  userAgent: string | null | undefined,
  touchPoints?: number | null
): boolean {
  return (
    ctx.role === 'org_owner' &&
    ctx.isRegisterDevice !== true &&
    ctx.isHandyDevice !== true &&
    isDesktopUserAgent(userAgent) &&
    !isIpadDesktopMode(userAgent, touchPoints)
  );
}

/** cookie も見て、新しい管理画面を出すか */
export function adminV2On(ctx: ViewerLike, cookieValue: string | null | undefined, userAgent: string | null | undefined): boolean {
  return cookieValue === '1' && canTryAdminV2(ctx, userAgent);
}

// =====================================================================
// 左メニュー
// =====================================================================

export interface V2Link {
  href: string;
  label: string;
  permission?: PermissionAction;
  roles?: Role[];
  /** リンクではなくその場で動くもの（テイクアウトの伝票を作る・ドロアを開く） */
  action?: 'takeout' | 'drawer';
}

export interface V2Nested {
  key: string;
  label: string;
  links: V2Link[];
}

export interface V2Group {
  key: string;
  label: string;
  icon: string;
  links: V2Link[];
  /** グループの中でさらに開くもの（店舗台帳の「設定」） */
  nested?: V2Nested;
}

export interface V2Section {
  /** 区切りの見出し（null は見出しなし） */
  label: string | null;
  groups: V2Group[];
}

/** 一番上の2つ（開かないリンク） */
export const V2_TOP_LINKS: { href: string; label: string; icon: string }[] = [
  { href: '/app/dashboard', label: 'ホーム', icon: 'grid' },
  { href: '/app/now', label: '店舗ナウ', icon: 'store' },
];

/** 設定の区分の下のリンク（開かない） */
export const V2_STAFF_LINK = { href: '/app/staff', label: 'スタッフ・権限', icon: 'shield', permission: 'staff.manage' as PermissionAction };

/**
 * いまの管理画面（lib/nav.ts）の画面をひとつも抜かさず並べ直したもの。
 * アラートは左に出さず、上のベルから（2026-10-10 Ronnie）。
 * tests/admin-v2.test.ts が「今の左メニューの画面がどれかに入っているか」を確かめる。
 */
export const V2_SECTIONS: V2Section[] = [
  {
    label: null,
    groups: [
      {
        key: 'daicho',
        label: '店舗台帳',
        icon: 'calendar',
        links: [
          { href: '/app/reservations', label: '予約台帳（タイムライン）', permission: 'reservations.view' },
          { href: '/app/reservations/calendar', label: 'カレンダー', permission: 'reservations.view' },
          { href: '/app/reservations/list', label: '予約一覧', permission: 'reservations.view' },
          { href: '/app/customers', label: '顧客台帳', permission: 'customers.view' },
        ],
        nested: {
          key: 'daichoSettings',
          label: '設定',
          links: [
            { href: '/app/settings/store', label: '基本設定（店舗情報）', permission: 'store.settings' },
            { href: '/app/settings/hours', label: '営業時間・休業日', permission: 'store.settings' },
            { href: '/app/settings/plans', label: 'コース', permission: 'menu.manage' },
            { href: '/app/settings/tables', label: 'テーブル・レイアウト', permission: 'store.settings' },
            { href: '/app/settings/booking', label: '予約受付（ネット予約）', permission: 'store.settings' },
            { href: '/app/settings/reservation-book', label: '予約経路・グルメサイト連携', permission: 'store.settings' },
            { href: '/app/settings/payments', label: 'オンライン決済', permission: 'store.settings' },
          ],
        },
      },
    ],
  },
  {
    label: '数字',
    groups: [
      {
        key: 'sales',
        label: '売上',
        icon: 'receipt',
        links: [
          { href: '/app/orders', label: '伝票明細', permission: 'pos.order' },
          { href: '/app/reports', label: 'レポート', permission: 'reports.view' },
          { href: '/app/daily-reports', label: '日報', permission: 'dashboard.view' },
        ],
      },
      {
        key: 'management',
        label: '経営',
        icon: 'trend',
        links: [
          { href: '/app/settlement', label: '月次清算', permission: 'reports.view' },
          { href: '/app/budgets', label: '予算管理', permission: 'reports.view' },
        ],
      },
    ],
  },
  {
    label: 'お金・書類',
    groups: [
      {
        key: 'cash',
        label: '現金・小口',
        icon: 'wallet',
        links: [
          { href: '/app/cash', label: 'レジ入出金', permission: 'register.operate' },
          { href: '/app/cash?tab=petty', label: '小口現金', permission: 'register.operate' },
          { href: '/app/cash/close', label: 'レジクローズ', permission: 'register.operate' },
          { href: '/app/cash?tab=closings', label: '締め履歴', permission: 'register.operate' },
        ],
      },
      {
        key: 'docs',
        label: '経費・請求書・領収書',
        icon: 'file',
        links: [
          { href: '/app/expenses', label: '仕入・経費', permission: 'cash.write' },
          { href: '/app/invoices', label: '請求書', permission: 'documents.write' },
          { href: '/app/scan', label: '領収書・レシート', permission: 'documents.write' },
          { href: '/app/invoices?tab=documents', label: '書類ボックス', permission: 'documents.write' },
        ],
      },
      {
        key: 'accounting',
        label: '経理',
        icon: 'book',
        links: [
          { href: '/app/accounting', label: '仕訳', permission: 'csv.export' },
          { href: '/app/accounting/auto', label: '自動仕訳', permission: 'csv.export' },
          { href: '/app/accounting/ledger', label: '帳簿', permission: 'csv.export' },
          { href: '/app/accounting/statements', label: '財務レポート', permission: 'csv.export' },
          { href: '/app/accounting/banks', label: '銀行口座', permission: 'csv.export' },
          { href: '/app/reconciliation', label: '照合', permission: 'csv.export' },
          { href: '/app/accounting/assets', label: '固定資産', permission: 'csv.export' },
        ],
      },
    ],
  },
  {
    label: 'お店を動かす',
    groups: [
      {
        key: 'register',
        label: 'レジ・現場',
        icon: 'monitor',
        links: [
          { href: '/app/floor', label: 'オーダー・会計', permission: 'tables.operate' },
          { href: '/app/quick-pay', label: '即会計', permission: 'pos.checkout' },
          { href: '/app/handy', label: 'ハンディ', permission: 'pos.order' },
          { href: '#takeout', label: 'テイクアウト', permission: 'pos.order', action: 'takeout' },
          { href: '/app/kitchen', label: 'キッチン', permission: 'pos.order' },
          { href: '#drawer', label: 'ドロアオープン', permission: 'pos.checkout', action: 'drawer' },
          { href: '/app/pos/settings', label: 'レジの設定', permission: 'pos.order' },
        ],
      },
      {
        key: 'purchasing',
        label: '仕入・在庫',
        icon: 'package',
        links: [
          { href: '/app/vendors', label: '仕入先', permission: 'vendors.manage' },
          { href: '/app/purchases', label: '発注', permission: 'vendors.manage' },
          { href: '/app/inventory', label: '在庫', permission: 'inventory.view' },
          { href: '/app/costing', label: '原価管理', permission: 'menu.manage' },
        ],
      },
      {
        key: 'customers',
        label: 'お客様',
        icon: 'heart',
        links: [
          { href: '/app/customers', label: '顧客', permission: 'customers.view' },
          { href: '/app/coupons', label: 'クーポン', permission: 'menu.manage' },
          { href: '/app/settings/loyalty', label: '会員・ポイント', permission: 'org.settings' },
        ],
      },
      {
        key: 'labor',
        label: '労務',
        icon: 'users',
        links: [
          { href: '/app/attendance', label: '勤怠・打刻', permission: 'attendance.punch' },
          { href: '/app/shifts', label: 'シフト', permission: 'attendance.punch' },
          { href: '/app/employees', label: '従業員', permission: 'staff.manage' },
          { href: '/app/leave', label: '有給休暇', permission: 'attendance.punch' },
          { href: '/app/payroll', label: '給与・歩合', permission: 'attendance.punch' },
          { href: '/app/payroll/nencho', label: '年末調整', permission: 'staff.manage' },
        ],
      },
      {
        key: 'team',
        label: '店舗内共有',
        icon: 'message',
        links: [
          { href: '/app/tasks', label: 'タスク・引継ぎ', permission: 'dashboard.view' },
          { href: '/app/announcements', label: 'お知らせ', permission: 'dashboard.view' },
          { href: '/app/manuals', label: 'マニュアル', permission: 'dashboard.view' },
        ],
      },
    ],
  },
  {
    label: '設定',
    groups: [
      {
        key: 'settings',
        label: '設定',
        icon: 'gear',
        links: [
          { href: '/app/settings-all', label: '設定の一覧', permission: 'dashboard.view' },
          { href: '/app/settings-all#store', label: '店舗', permission: 'dashboard.view' },
          { href: '/app/settings-all#menu', label: 'メニュー', permission: 'dashboard.view' },
          { href: '/app/settings-all#devices', label: '機器・印刷', permission: 'dashboard.view' },
          { href: '/app/settings-all#seats', label: '予約・席', permission: 'dashboard.view' },
          { href: '/app/settings-all#money', label: 'お金・税', permission: 'dashboard.view' },
          { href: '/app/settings-all#company', label: '会社・データ', permission: 'dashboard.view' },
        ],
      },
    ],
  },
];

function linkAllowed(link: V2Link, role: Role | null, disabled?: ReadonlySet<string>): boolean {
  if (link.roles && !(role && link.roles.includes(role))) return false;
  if (link.permission && !can(role, link.permission)) return false;
  if (disabled && !link.href.startsWith('#')) {
    const feature = featureForRoute(link.href.split(/[?#]/)[0]);
    if (feature && disabled.has(feature)) return false;
  }
  return true;
}

/** 権限・機能フラグで絞った左メニュー（中身が0のグループ・区分は出さない） */
export function visibleV2Sections(role: Role | null, disabled?: ReadonlySet<string>): V2Section[] {
  return V2_SECTIONS.map((s) => ({
    ...s,
    groups: s.groups
      .map((g) => {
        const links = g.links.filter((l) => linkAllowed(l, role, disabled));
        const nestedLinks = g.nested ? g.nested.links.filter((l) => linkAllowed(l, role, disabled)) : [];
        return {
          ...g,
          links,
          nested: g.nested && nestedLinks.length > 0 ? { ...g.nested, links: nestedLinks } : undefined,
        };
      })
      .filter((g) => g.links.length > 0 || !!g.nested),
  })).filter((s) => s.groups.length > 0);
}

/** リンクの場所（? と # を外したパス） */
export function linkPath(href: string): string {
  return href.split(/[?#]/)[0];
}

/** いま開いている画面が、どのグループ（と中の設定）にあるか。左メニューで最初から開いておくのに使う */
export function v2OpenKeysForPath(pathname: string, sections: V2Section[] = V2_SECTIONS): string[] {
  let best: { keys: string[]; len: number } | null = null;
  for (const s of sections) {
    for (const g of s.groups) {
      const candidates: { href: string; keys: string[] }[] = [
        ...g.links.map((l) => ({ href: l.href, keys: [g.key] })),
        ...(g.nested ? g.nested.links.map((l) => ({ href: l.href, keys: [g.key, g.nested!.key] })) : []),
      ];
      for (const c of candidates) {
        if (c.href.startsWith('#')) continue;
        const path = linkPath(c.href);
        if (pathname === path || pathname.startsWith(path + '/')) {
          if (!best || path.length > best.len) best = { keys: c.keys, len: path.length };
        }
      }
    }
  }
  return best?.keys ?? [];
}

// =====================================================================
// 設定の一覧（「管理画面だけ」の印つき）
// =====================================================================

export interface V2Setting {
  href: string;
  label: string;
  description: string;
  /** iPad（レジ）からは変えられない（パソコンの管理画面だけ） */
  adminOnly: boolean;
  note?: string;
  permission?: PermissionAction;
  roles?: Role[];
}

export interface V2SettingSection {
  /** ページ内の場所（#store など） */
  id: string;
  label: string;
  items: V2Setting[];
}

/**
 * 設定の一覧。「管理画面だけ」は、コードで iPad（レジのアカウント）から変えられないもの:
 *   lib/admin-only-settings.ts（ハードウェア・一括編集・予約受付ルール・テーブル・フロア）、
 *   各画面の isRegisterDevice の止め（厨房伝票・来店経路・決済・レシート/インボイス・固定費/給料）、
 *   レジのアカウント（店長）の役割では開けないもの（企業情報・承認ルール・会員ポイント・データ取込・勘定科目）。
 */
export const V2_SETTINGS: V2SettingSection[] = [
  {
    id: 'store',
    label: '店舗',
    items: [
      { href: '/app/settings/store', label: '店舗情報', description: '名前・住所・紹介文・予約ページのURL', adminOnly: false, permission: 'store.settings' },
      { href: '/app/settings/hours', label: '営業時間・休業日', description: '曜日ごとの時間・定休日・臨時休業', adminOnly: false, permission: 'store.settings' },
      { href: '/app/settings/clerks', label: 'POS担当者', description: '会計で選ぶ担当者の名前', adminOnly: false, note: 'オーナーの変更は管理画面だけ', permission: 'store.settings' },
      { href: '/app/settings/company', label: '企業情報', description: '会社名・住所・請求の情報', adminOnly: true, permission: 'org.settings' },
    ],
  },
  {
    id: 'menu',
    label: 'メニュー',
    items: [
      { href: '/app/settings/menu', label: 'メニュー', description: '商品・値段・英語名', adminOnly: false, permission: 'menu.manage' },
      { href: '/app/settings/plans', label: 'プラン', description: 'コース・飲み放題・食べ放題の値段と時間', adminOnly: false, permission: 'menu.manage' },
      { href: '/app/settings/options', label: 'オプション', description: 'サイズ・トッピングと追加料金', adminOnly: false },
      { href: '/app/settings/categories', label: 'カテゴリ', description: '厨房・ドリンク・焼き場への振り分け', adminOnly: false, permission: 'menu.manage' },
      { href: '/app/settings/menu-book', label: 'メニューブック', description: 'ハンディ・お客様QRの並び順と出し方', adminOnly: false, permission: 'menu.manage' },
      { href: '/app/pos/sold-out', label: '品切れ', description: 'その日の品切れ', adminOnly: false, permission: 'pos.order' },
      { href: '/app/settings/dynamic-pricing', label: 'ダイナミックプライシング', description: '曜日・時間で値段を自動で変える', adminOnly: false, permission: 'menu.manage' },
      { href: '/app/settings/menu-bulk', label: '一括編集', description: '商品名・値段・表示・売切を表でまとめて変更', adminOnly: true, permission: 'menu.manage' },
    ],
  },
  {
    id: 'devices',
    label: '機器・印刷',
    items: [
      { href: '/app/settings/printers', label: 'ハードウェア', description: 'レジ端末・レシート/厨房プリンター・キャッシュドロア', adminOnly: true, permission: 'store.settings' },
      { href: '/app/pos/settings', label: '厨房伝票', description: '伝票の分け方・商品名の言語・文字の大きさ', adminOnly: true, permission: 'pos.order' },
      { href: '/app/settings/handy-qr', label: 'iPhoneハンディ', description: 'お店の固定QRでハンディにログイン', adminOnly: false, permission: 'store.settings' },
      { href: '/app/settings/handy', label: 'ハンディ端末', description: 'スマホをハンディとして登録・解除', adminOnly: false, permission: 'store.settings' },
      { href: '/app/settings/tables/qr-print', label: 'テーブルQRコード', description: '全テーブルのQR注文コードをまとめて印刷', adminOnly: false, permission: 'store.settings' },
    ],
  },
  {
    id: 'seats',
    label: '予約・席',
    items: [
      { href: '/app/settings/reservation-book', label: '予約台帳設定', description: 'グルメサイトの予約を台帳に自動で取り込む・予約経路', adminOnly: false, permission: 'store.settings' },
      { href: '/app/settings/booking', label: '予約受付ルール', description: '予約枠・受付期間・キャンセル期限・リマインダー', adminOnly: true, permission: 'store.settings' },
      { href: '/app/settings/tables', label: 'テーブル・フロア', description: 'フロアの形・席数・種別・利用停止', adminOnly: true, permission: 'store.settings' },
      { href: '/app/pos/settings', label: '来店経路', description: 'お客様情報のボタン（使わないサイトを外す）', adminOnly: true, permission: 'pos.order' },
    ],
  },
  {
    id: 'money',
    label: 'お金・税',
    items: [
      { href: '/app/settings/payments', label: '決済・端末', description: 'カード決済・決済端末・予約の事前決済', adminOnly: true, permission: 'store.settings' },
      { href: '/app/settings/store', label: 'レシート・インボイス', description: 'レシートの文言・登録番号（店舗情報の中）', adminOnly: true, permission: 'store.settings' },
      { href: '/app/settings/tax', label: '税率', description: '税率と、いつも使う税率', adminOnly: false, permission: 'store.settings' },
      { href: '/app/settings/accounts', label: '勘定科目', description: '仕訳で使う科目', adminOnly: true, roles: ACCOUNTING_WRITE_ROLES },
      { href: '/app/settings/approvals', label: '承認ルール', description: '金額ごとに誰が承認するか', adminOnly: true, permission: 'org.settings' },
      { href: '/app/settlement', label: '固定費・給料', description: '月次清算の家賃・電気・水道・給料', adminOnly: true, permission: 'reports.view' },
    ],
  },
  {
    id: 'company',
    label: '会社・データ',
    items: [
      { href: '/app/settings/loyalty', label: '会員・ポイント', description: 'ポイントの付け方・使い方', adminOnly: true, permission: 'org.settings' },
      { href: '/app/settings/import', label: 'データ取込', description: 'CSVで商品・顧客・仕入先をまとめて登録', adminOnly: true, permission: 'org.settings' },
      { href: '/app/settings/integrations', label: '連携', description: '決済・プリンター・外部サービスの状態', adminOnly: false, permission: 'store.settings' },
      { href: '/app/settings/alerts', label: '異常検知の閾値', description: '現金の差額・値引率・原価率の注意ライン', adminOnly: false, permission: 'store.settings' },
      { href: '/app/settings/audit', label: '監査ログ', description: '誰が・いつ・何を変えたか', adminOnly: false, permission: 'audit.view' },
      { href: '/app/staff', label: 'スタッフ・権限', description: '招待・役割・利用停止', adminOnly: false, permission: 'staff.manage' },
    ],
  },
];

/** その人が開ける設定だけ（中身が0の区分は出さない） */
export function visibleV2Settings(role: Role | null): V2SettingSection[] {
  return V2_SETTINGS.map((s) => ({
    ...s,
    items: s.items.filter((i) => {
      if (i.roles) return !!role && i.roles.includes(role);
      return !i.permission || can(role, i.permission);
    }),
  })).filter((s) => s.items.length > 0);
}
