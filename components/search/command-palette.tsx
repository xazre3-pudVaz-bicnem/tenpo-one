'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { can, type PermissionAction, type Role } from '@/lib/permissions';
import { globalSearch, type SearchResultGroup } from './actions';

interface StaticCommand {
  id: string;
  label: string;
  href: string;
  permission?: PermissionAction;
}

function todayJstDate(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function staticCommands(): StaticCommand[] {
  const today = todayJstDate();
  return [
    { id: 'nav-dashboard', label: 'ダッシュボード', href: '/app/dashboard', permission: 'dashboard.view' },
    { id: 'nav-reservation-new', label: '新規予約', href: '/app/reservations/list', permission: 'reservations.write' },
    { id: 'nav-reservation-today', label: '本日の予約', href: `/app/reservations/list?from=${today}&to=${today}`, permission: 'reservations.view' },
    { id: 'nav-pos', label: 'POSを開く', href: '/app/pos', permission: 'pos.order' },
    { id: 'nav-inventory', label: '在庫', href: '/app/inventory', permission: 'inventory.view' },
    { id: 'nav-invoice-add', label: '請求書を追加', href: '/app/invoices', permission: 'documents.write' },
    { id: 'nav-settings', label: '設定', href: '/app/settings', permission: 'store.settings' },
  ];
}

interface PaletteContextValue {
  open: () => void;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function useCommandPalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error('CommandPaletteProvider の内側で使用してください');
  return ctx;
}

/** app/app/layout.tsx にマウントする。開閉状態を保持し、Cmd/Ctrl+K のグローバル監視も行う */
export function CommandPaletteProvider({ role, children }: { role: Role | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <PaletteContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {open && <PaletteModal role={role} onClose={() => setOpen(false)} />}
    </PaletteContext.Provider>
  );
}

/** TopBar に配置する検索トリガーボタン */
export function CommandPaletteTrigger() {
  const { open } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={open}
      className="hidden items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 sm:flex"
      aria-label="検索を開く"
    >
      <Search className="h-3.5 w-3.5" />
      <span>検索</span>
      <kbd className="rounded border border-gray-300 bg-gray-50 px-1 py-0.5 font-mono text-[10px] text-gray-400">⌘K</kbd>
    </button>
  );
}

/** モバイル等、テキストヒントを出さない小さい検索ボタン */
export function CommandPaletteIconTrigger() {
  const { open } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={open}
      aria-label="検索を開く"
      className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 sm:hidden"
    >
      <Search className="h-5 w-5" />
    </button>
  );
}

function PaletteModal({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await globalSearch(q);
        if (requestId.current === id) setGroups(result);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // 2文字未満のときは直前の検索結果が残っていても表示しない
  const effectiveGroups = useMemo(() => (query.trim().length >= 2 ? groups : []), [query, groups]);

  const commands = useMemo(() => {
    const list = staticCommands().filter((c) => !c.permission || can(role, c.permission));
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.label.toLowerCase().includes(q));
  }, [role, query]);

  const flatItems = useMemo(() => {
    const items: { key: string; label: string; sublabel?: string; href: string }[] = commands.map((c) => ({
      key: c.id,
      label: c.label,
      href: c.href,
    }));
    for (const g of effectiveGroups) {
      for (const item of g.items) {
        items.push({ key: `${g.key}-${item.id}`, label: item.title, sublabel: item.subtitle, href: item.href });
      }
    }
    return items;
  }, [commands, effectiveGroups]);

  // 検索結果の内容が変わったら選択位置をレンダー中にリセットする（Effectは使わない）
  const itemsKey = `${query}:${flatItems.length}`;
  const [syncedItemsKey, setSyncedItemsKey] = useState(itemsKey);
  if (itemsKey !== syncedItemsKey) {
    setSyncedItemsKey(itemsKey);
    setActiveIndex(0);
  }

  const navigateTo = useCallback(
    (href: string) => {
      router.push(href);
      onClose();
    },
    [router, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = flatItems[activeIndex];
      if (target) navigateTo(target.href);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-20 sm:pt-28">
      <div className="absolute inset-0 bg-navy/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="検索"
        className="relative z-10 max-h-[70vh] w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="検索、または移動したい画面を入力…"
            className="h-8 w-full border-0 bg-transparent text-sm text-navy outline-none placeholder:text-gray-400"
            aria-label="検索キーワード"
          />
          {pending && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
        </div>

        <div className="max-h-[55vh] overflow-y-auto py-2">
          {commands.length > 0 && (
            <ResultSection
              label="移動"
              items={commands.map((c) => ({ key: c.id, label: c.label, href: c.href }))}
              flatItems={flatItems}
              activeIndex={activeIndex}
              onSelect={navigateTo}
            />
          )}

          {effectiveGroups.map((g) => (
            <ResultSection
              key={g.key}
              label={g.label}
              items={g.items.map((item) => ({
                key: `${g.key}-${item.id}`,
                label: item.title,
                sublabel: item.subtitle,
                href: item.href,
              }))}
              flatItems={flatItems}
              activeIndex={activeIndex}
              onSelect={navigateTo}
            />
          ))}

          {query.trim().length >= 2 && !pending && effectiveGroups.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-gray-400">一致する結果が見つかりませんでした</p>
          )}
          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="px-4 py-6 text-center text-xs text-gray-400">2文字以上入力すると検索します</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" />
            決定
          </span>
          <span>Esc 閉じる</span>
        </div>
      </div>
    </div>
  );
}

function ResultSection({
  label,
  items,
  flatItems,
  activeIndex,
  onSelect,
}: {
  label: string;
  items: { key: string; label: string; sublabel?: string; href: string }[];
  flatItems: { key: string; label: string; sublabel?: string; href: string }[];
  activeIndex: number;
  onSelect: (href: string) => void;
}) {
  return (
    <div className="px-2 py-1">
      <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      {items.map((item) => {
        const flatIndex = flatItems.findIndex((f) => f.key === item.key);
        const active = flatIndex === activeIndex;
        return (
          <button
            key={item.key}
            type="button"
            onMouseEnter={() => {}}
            onClick={() => onSelect(item.href)}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm',
              active ? 'bg-primary-soft text-primary-deep' : 'text-navy hover:bg-gray-50'
            )}
          >
            <span className="min-w-0 truncate">{item.label}</span>
            {item.sublabel && <span className="shrink-0 text-xs text-gray-400">{item.sublabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
