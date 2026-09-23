import type { Metadata } from 'next';
import Link from 'next/link';
import { LogOut, ChevronRight } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { visibleNavGroups, visibleNavTiles } from '@/lib/nav';
import { ROLE_LABELS } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { NavIcon } from '@/components/layout/nav-icons';
import { signOut } from '@/app/app/actions';

export const metadata: Metadata = { title: 'メニュー' };

/** メニュー一覧からは出さず、それぞれの画面の中に置いたもの */
const MOVED_OUT_OF_MENU = new Set([
  '/app/pos', // → テーブル一覧の「テイクアウト」ボタン
  '/app/handy', // → 設定 > iPhoneハンディ
  '/app/pos/settings', // → 設定 > デバイス管理
  '/app/scan', // → 入金出金 / 仕入・経費 の中から撮る
  '/app/inventory', // → 「仕入・在庫」の中へ（下で入れ直す）
]);

/** 「在庫設定」を入れ直すグループ。このグループ自体も上へ持ち上げる */
const PURCHASING_GROUP = '仕入・在庫';

/**
 * 上のタイルに上げるもの（2026-09-23 要望。iPad でよく使うため）。
 * 並びは 入金出金 → 仕入・経費。下の一覧からは重ねて出さない。
 */
const TOP_ROW = ['/app/cash', '/app/expenses'];

export default async function MenuPage() {
  const ctx = await requireMember();
  const allGroups = visibleNavGroups(ctx.role, ctx.disabledFeatures);
  // 「入金出金」「仕入・経費」は権限・機能フラグで出ている場合だけタイルにする
  const byHref = new Map(allGroups.flatMap((g) => g.items).map((i) => [i.href, i]));
  const topRowTiles = TOP_ROW.map((href) => byHref.get(href)).filter((i) => i !== undefined);
  const tiles = [...visibleNavTiles(ctx.role, ctx.disabledFeatures), ...topRowTiles];
  const trimmed = allGroups
    .map((g) => ({
      ...g,
      // ドロアオープン等の操作行はレジ端末の左メニューでのみ扱う。
      // 2026-09-23 要望（パソコンの左メニューはそのまま、この一覧からだけ外す）:
      //   「即会計」   → テーブル一覧の「テイクアウト」ボタンへ
      //   「ハンディ」 → 設定 > iPhoneハンディ の中へ
      //   「レジの設定」→ 設定 > デバイス管理 へ
      //   「スキャン」 → 入金出金・仕入・経費 の中へ
      //   「在庫設定」 → 「仕入・在庫」の中へ（下で入れ直す）
      items: g.items.filter((i) => !i.action && !MOVED_OUT_OF_MENU.has(i.href) && !TOP_ROW.includes(i.href)),
    }))
    .filter((g) => g.items.length > 0);

  // 「在庫設定」を「仕入・在庫」の先頭に入れ、そのグループを一覧の上へ持ち上げる
  const inventory = byHref.get('/app/inventory');
  const purchasingAt = trimmed.findIndex((g) => g.label === PURCHASING_GROUP);
  const groups =
    purchasingAt < 0
      ? trimmed
      : [
          { ...trimmed[purchasingAt], items: inventory ? [inventory, ...trimmed[purchasingAt].items] : trimmed[purchasingAt].items },
          ...trimmed.filter((_, i) => i !== purchasingAt),
        ];

  return (
    <div>
      <PageHeader title="メニュー" />

      <div className="mb-5 rounded-xl border border-gray-200 bg-white px-4 py-4">
        <p className="text-sm font-semibold text-navy">{ctx.displayName}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {ROLE_LABELS[ctx.role]}
          {ctx.organizationName ? `｜${ctx.organizationName}` : ''}
        </p>
      </div>

      {tiles.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          {tiles.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-white px-4 py-4 text-royal shadow-card active:bg-iris-soft"
            >
              <span className="min-w-0">
                <span className="block text-base font-bold">{t.label}</span>
                <span className="block text-xs text-ink-3">{t.en}</span>
              </span>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-iris-soft text-iris">
                <NavIcon name={t.icon} className="h-5 w-5" />
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">
                {group.label}
              </p>
            )}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <ul className="divide-y divide-gray-100">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-navy active:bg-gray-50"
                    >
                      <NavIcon name={item.icon} className="h-5 w-5 shrink-0 text-gray-500" />
                      <span className="flex-1">
                        {item.label}
                        <span className="en-sub">{item.en}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <form action={signOut} className="mt-6">
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-danger active:bg-gray-50"
        >
          <LogOut className="h-4 w-4" />
          ログアウト
        </button>
      </form>
    </div>
  );
}
