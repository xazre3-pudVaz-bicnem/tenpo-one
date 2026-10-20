'use client';

/**
 * レジ（iPad）ホームの左の列（即会計・伝票明細・入出金・仕入・経費・ドロアオープン・レジクローズ・在庫設定・設定）。
 * 白い四角に機能の色のアイコン、日本語の下に小さく英語、右に ›（2026-10-19 Ronnie の新しいレイアウト）。
 */
import { useTransition } from 'react';
import Link from 'next/link';
import { enqueueDrawerKick } from '@/app/app/pos/print-actions';
import { useToast } from '@/components/ui/toast';
import { NavIcon } from '@/components/layout/nav-icons';
import {
  BillsIcon,
  CashInOutIcon,
  CashRegisterIcon,
  CloseRegisterIcon,
  DrawerIcon,
  SettingsIcon,
  SlipIcon,
  StockIcon,
} from './regi-icons';

export interface RegiTool {
  href: string;
  label: string;
  en: string;
  /** lib/nav.ts のアイコン名（専用アイコンが無いときに使う） */
  icon: string;
  action?: 'drawer';
  /** 赤い件数（仕入・経費 = お知らせ&アラートの件数） */
  badge?: number;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/app/quick-pay': CashRegisterIcon,
  '/app/orders': SlipIcon,
  '/app/cash': CashInOutIcon,
  '/app/expenses': BillsIcon,
  '#drawer': DrawerIcon,
  '/app/cash/close': CloseRegisterIcon,
  '/app/inventory': StockIcon,
  '/app/settings': SettingsIcon,
};

const rowClass =
  'flex min-h-[48px] flex-1 items-center gap-3 rounded-[14px] bg-[#f2f2f7] px-3 text-left transition-colors active:bg-[#e8e8ed] disabled:opacity-50';

function RowBody({ tool }: { tool: RegiTool }) {
  const Icon = ICONS[tool.href];
  return (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.04)]">
        {Icon ? <Icon className="h-[22px] w-[22px]" /> : <NavIcon name={tool.icon} className="h-[21px] w-[21px] text-[#636366]" />}
      </span>
      <span className="min-w-0 flex-1 leading-tight whitespace-nowrap">
        <span className="block text-[15.5px] font-bold text-[#1c1c1e]">{tool.label}</span>
        <span className="block text-[11px] text-[#8e8e93]" style={{ fontFamily: 'var(--font-manrope)' }}>
          {tool.en}
        </span>
      </span>
      {tool.badge != null && tool.badge > 0 && (
        <span
          className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-[#ff3b30] px-1.5 text-[12px] font-extrabold text-white tabular-nums"
          aria-label={`${tool.badge}件`}
        >
          {tool.badge > 99 ? '99+' : tool.badge}
        </span>
      )}
      <svg width="8" height="13" viewBox="0 0 8 13" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M1.5 1.5l5 5-5 5" stroke="#c7c7cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
}

function DrawerRow({ tool, storeId }: { tool: RegiTool; storeId: string | null }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={rowClass}
      disabled={pending || !storeId}
      onClick={() =>
        startTransition(async () => {
          if (!storeId) return;
          const res = await enqueueDrawerKick(storeId);
          if (res.ok) toast('ドロアを開きます');
          else toast(res.error ?? 'ドロアを開けませんでした', 'error');
        })
      }
    >
      <RowBody tool={tool} />
    </button>
  );
}

export function RegiTools({ tools, storeId }: { tools: RegiTool[]; storeId: string | null }) {
  return (
    <nav aria-label="レジの操作" className="flex flex-col gap-2">
      {tools.map((t) =>
        t.action === 'drawer' ? (
          <DrawerRow key={t.href} tool={t} storeId={storeId} />
        ) : (
          <Link key={t.href} href={t.href} className={rowClass}>
            <RowBody tool={t} />
          </Link>
        )
      )}
    </nav>
  );
}
