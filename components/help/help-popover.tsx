'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { HelpCircle, X } from 'lucide-react';
import { findHelpEntry } from './help-content';
import type { PosShortcut } from '@/components/pos/shortcuts';

const FALLBACK_POS_SHORTCUTS: PosShortcut[] = [
  { key: 'F2', label: 'F2', description: '商品検索欄にフォーカス' },
  { key: 'F4', label: 'F4', description: '会計ダイアログを開く' },
  { key: 'Escape', label: 'Esc', description: '開いているダイアログを閉じる' },
];

/** TopBar に配置するヘルプポップオーバー。現在のpathnameに応じて内容を切り替える */
export function HelpPopover() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [posShortcuts, setPosShortcuts] = useState<PosShortcut[]>(FALLBACK_POS_SHORTCUTS);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isPos = pathname.startsWith('/app/pos');
  const entry = findHelpEntry(pathname);

  useEffect(() => {
    if (!isPos) return;
    let active = true;
    // pos/shortcuts.ts はPOS担当エージェントが並行して作成中のため、ビルド時の強依存を避け動的に読み込む
    import('@/components/pos/shortcuts')
      .then((mod) => {
        if (active && Array.isArray(mod.POS_SHORTCUTS)) setPosShortcuts(mod.POS_SHORTCUTS);
      })
      .catch(() => {
        if (active) setPosShortcuts(FALLBACK_POS_SHORTCUTS);
      });
    return () => {
      active = false;
    };
  }, [isPos]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // pathname が変わったら開閉状態をリセットする（Effectではなくレンダー中に調整する）
  const [syncedPathname, setSyncedPathname] = useState(pathname);
  if (pathname !== syncedPathname) {
    setSyncedPathname(pathname);
    setOpen(false);
  }

  if (!entry) return null;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="この画面のヘルプ"
        aria-expanded={open}
        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${entry.title}のヘルプ`}
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-semibold text-navy">{entry.title}でできること</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="閉じる"
              className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-gray-600">
            {entry.points.map((p, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-gray-300">・</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>

          {isPos && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400">
                ショートカット
              </p>
              <ul className="space-y-1 text-xs text-gray-600">
                {posShortcuts.map((s) => (
                  <li key={s.key} className="flex items-center gap-2">
                    <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
                      {s.label}
                    </kbd>
                    <span>{s.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
