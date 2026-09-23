'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavGroup, NavItem, NavTile } from '@/lib/nav';
import { enqueueDrawerKick } from '@/app/app/pos/print-actions';
import { useToast } from '@/components/ui/toast';
import { NavIcon } from './nav-icons';

const STORAGE_KEY = 'tenpo-nav-collapsed';

function isItemActive(pathname: string, href: string): boolean {
  if (href.startsWith('#')) return false;
  if (href === '/app/accounting' || href === '/app/cash') {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * PC用左メニュー（白地・日英併記）。D&DREAM レジ v32 の構成:
 *   最上段に「オーダー・会計」「店舗台帳」の大きなタイル → レジ業務の行 → 業務ドメインの折りたたみグループ。
 * 折りたたみ状態は localStorage に保持し、現在地を含むグループは常に展開する。
 */
const HOME_PATH = '/app/dashboard';

export function Sidebar({
  tiles,
  groups,
  alertCount,
  currentStoreId,
  iconFirst = false,
  homeOnly = false,
}: {
  tiles: NavTile[];
  groups: NavGroup[];
  alertCount: number;
  currentStoreId: string | null;
  /** タイルのアイコンを左に置く（レジ端末。パソコンは文字が左のまま） */
  iconFirst?: boolean;
  /** レジ端末：左メニューはホーム画面だけに出し、開いた画面は全幅で使う */
  homeOnly?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // SSRとのhydration不一致を避けるためマウント後に復元する（effect本体での同期setStateを避けてタスクへ遅延）
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setCollapsed(JSON.parse(raw));
      } catch {
        // 破損した保存値は無視
      }
      setLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const toggle = (label: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage不可環境では永続化しない
      }
      return next;
    });
  };

  // レジ：ホーム画面だけに出す。開いた画面は全幅で使い、戻るのは上部バーの「ホーム」
  if (homeOnly && pathname !== HOME_PATH) return null;

  return (
    <aside
      className="fixed top-[58px] bottom-0 left-0 z-30 hidden w-[250px] flex-col border-r border-line bg-white lg:flex"
      aria-label="メインナビゲーション"
    >
      <nav className="flex-1 overflow-y-auto">
        {tiles.length > 0 && (
          <div className="border-b border-line">
            {tiles.map((t) => {
              const active = t.match.some((m) => pathname === m || pathname.startsWith(m + '/'));
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 border-b border-line px-[18px] py-4 text-royal transition-colors last:border-b-0',
                    // レジは下の一覧と縦を揃えるためアイコンを左に。パソコンは今まで通り文字が左
                    iconFirst ? 'justify-start' : 'flex-row-reverse justify-between',
                    active ? 'bg-iris-soft' : 'hover:bg-lilac-soft'
                  )}
                >
                  <span
                    className={cn(
                      'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
                      active ? 'bg-iris text-white' : 'bg-iris-soft text-iris'
                    )}
                  >
                    <NavIcon name={t.icon} className="h-6 w-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[17px] leading-tight font-bold whitespace-nowrap">{t.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-3">{t.en}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {groups.map((group, gi) => {
          const hasActive = group.items.some((i) => isItemActive(pathname, i.href));
          // 業務グループは既定で折りたたむ（保存値の読込前も同じ状態で描画してちらつきを防ぐ）。
          // 現在地を含むグループは常に展開する。
          const isCollapsed = group.label
            ? (loaded ? (collapsed[group.label] ?? true) : true) && !hasActive
            : false;

          return (
            <div key={group.label ?? gi}>
              {group.label && (
                <button
                  type="button"
                  onClick={() => toggle(group.label!)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between border-b border-line bg-lilac-soft px-[18px] py-2 text-left text-xs font-bold text-ink-2 hover:text-royal"
                >
                  <span>
                    {group.label}
                    {group.en && <span className="en-inline">{group.en}</span>}
                  </span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                </button>
              )}
              {!isCollapsed && (
                <ul>
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavRow
                        item={item}
                        active={isItemActive(pathname, item.href)}
                        count={item.badge === 'alerts' ? alertCount : 0}
                        storeId={currentStoreId}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function RowBody({ item, count }: { item: NavItem; count: number }) {
  return (
    <>
      <NavIcon name={item.icon} className="h-[21px] w-[21px] shrink-0 text-ink-3 transition-colors group-hover:text-iris group-aria-[current=page]:text-iris" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        <span className="en-sub group-aria-[current=page]:text-royal">{item.en}</span>
      </span>
      {count > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-extrabold text-white tabular-nums">
          {count > 99 ? '99+' : count}
        </span>
      )}
      {!item.action && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-wisteria" />}
    </>
  );
}

const rowClass =
  'group flex w-full items-center gap-3 border-b border-line px-[18px] py-2.5 text-left text-[15px] leading-snug font-medium text-ink-2 transition-colors hover:bg-lilac-soft hover:text-royal aria-[current=page]:bg-iris-soft aria-[current=page]:font-bold aria-[current=page]:text-royal';

function NavRow({
  item,
  active,
  count,
  storeId,
}: {
  item: NavItem;
  active: boolean;
  count: number;
  storeId: string | null;
}) {
  if (item.action === 'drawer') return <DrawerRow item={item} storeId={storeId} />;
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={rowClass}>
      <RowBody item={item} count={count} />
    </Link>
  );
}

/** ドロアオープン（レシートプリンタ経由でキャッシュドロアを開く） */
function DrawerRow({ item, storeId }: { item: NavItem; storeId: string | null }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={cn(rowClass, 'disabled:opacity-50')}
      disabled={pending || !storeId}
      title={storeId ? undefined : '店舗を選択してください'}
      onClick={() =>
        startTransition(async () => {
          if (!storeId) return;
          const res = await enqueueDrawerKick(storeId);
          if (res.ok) toast('ドロアを開きます');
          else toast(res.error ?? 'ドロアを開けませんでした', 'error');
        })
      }
    >
      <RowBody item={item} count={0} />
    </button>
  );
}
