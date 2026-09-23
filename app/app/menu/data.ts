import { visibleNavGroups, visibleNavTiles, type NavGroup, type NavItem, type NavTile } from '@/lib/nav';
import type { Role } from '@/lib/permissions';

/**
 * レジ（iPad）の並び（2026-09-23 要望）。
 * レジ端末（/register-login でログイン）の左メニューと、幅が狭いときのメニュー一覧の両方で使う。
 * パソコン（メール＋パスワード）の左メニューは lib/nav.ts のまま変えない。
 */

/** この一覧には出さず、それぞれの画面の中に置いたもの */
const MOVED_OUT_OF_MENU = new Set([
  '/app/pos', // → テーブル一覧の「テイクアウト」ボタン
  '/app/handy', // → 設定 > iPhoneハンディ
  '/app/pos/settings', // → 設定 > デバイス管理
  '/app/scan', // → 入金出金・仕入・経費 の中から撮る
  '/app/inventory', // → 「仕入・在庫」の中へ（下で入れ直す）
  '/app/staff', // → 設定 > 予約・顧客（スタッフ・権限）
  '/app/dashboard', // → 上部バーの「ホーム」ボタンとロゴから開く（スマホは下部ナビにもある）
]);

/**
 * 元の位置から動かす行（大きなタイルにはせず、他と同じ大きさのまま。2026-09-23 要望）。
 *   入出金     … 一覧の先頭
 *   仕入・経費 … レジクローズの手前
 */
const MOVED_IN_LIST = ['/app/cash', '/app/expenses'];
const FIRST_IN_LIST = '/app/cash';
const EXPENSES = '/app/expenses';
const BEFORE_EXPENSES = '/app/cash/close';

/** 「在庫設定」を入れ直すグループ */
const PURCHASING_GROUP = '仕入・在庫';

/** 集計（店舗運営・仕入・在庫・経理・管理・チームをまとめた画面） */
export const SUMMARY_ITEM: NavItem = {
  href: '/app/menu/summary',
  label: '集計',
  en: 'Reports & admin',
  icon: 'chart',
};

/** 集計ボタンを差し込む位置（この href の手前に入れる） */
const SUMMARY_BEFORE = '/app/notifications';

export interface MenuLayout {
  /** 上の大きなタイル */
  tiles: NavTile[];
  /** 一覧の先頭グループ（レジ業務）。集計ボタンを含む */
  main: NavItem[];
  /** 集計の中に入るグループ */
  summaryGroups: NavGroup[];
}

export function menuLayout(
  role: Role | null,
  disabledFeatures?: ReadonlySet<string>,
  /** ドロアオープンなどの操作行を残すか（左メニューは残す。メニュー一覧の画面では押せないので外す） */
  options?: { keepActions?: boolean }
): MenuLayout {
  const allGroups = visibleNavGroups(role, disabledFeatures);
  const byHref = new Map(allGroups.flatMap((g) => g.items).map((i) => [i.href, i]));

  const tiles: NavTile[] = visibleNavTiles(role, disabledFeatures);
  const firstItem = byHref.get(FIRST_IN_LIST);
  const expensesItem = byHref.get(EXPENSES);

  const trimmed = allGroups
    .map((g) => ({
      ...g,
      // ドロアオープン等の操作行は左メニューだけ（メニュー一覧の画面からは押せない）
      items: g.items.filter(
        (i) =>
          (options?.keepActions || !i.action) &&
          !MOVED_OUT_OF_MENU.has(i.href) &&
          !MOVED_IN_LIST.includes(i.href)
      ),
    }))
    .filter((g) => g.items.length > 0);

  const listed = [...(trimmed.find((g) => g.label === null)?.items ?? [])];
  // 仕入・経費 は レジクローズ の手前へ（無ければ末尾）
  if (expensesItem) {
    const at = listed.findIndex((i) => i.href === BEFORE_EXPENSES);
    listed.splice(at < 0 ? listed.length : at, 0, expensesItem);
  }
  const main = firstItem ? [firstItem, ...listed] : listed;
  const summaryGroups = trimmed
    .filter((g) => g.label !== null)
    .map((g) => {
      if (g.label !== PURCHASING_GROUP) return g;
      // 「在庫設定」は「仕入・在庫」の先頭に入れる
      const inventory = byHref.get('/app/inventory');
      return inventory ? { ...g, items: [inventory, ...g.items] } : g;
    });

  // 集計ボタンは アラート の手前（＝設定とアラートの間）に入れる
  const at = main.findIndex((i) => i.href === SUMMARY_BEFORE);
  const withSummary =
    summaryGroups.length === 0
      ? main
      : at < 0
        ? [...main, SUMMARY_ITEM]
        : [...main.slice(0, at), SUMMARY_ITEM, ...main.slice(at)];

  return { tiles, main: withSummary, summaryGroups };
}
