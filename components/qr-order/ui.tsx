'use client';

import { cn } from '@/lib/utils';

/**
 * QR画面だけで使う小さな部品。
 * /app（.theme-regi）のテーマはこの画面に掛からないため、承認済みレイアウトの配色を
 * ここで明示する（プラム #241436 / 藤色 #f6f3fb / アイリス #7b3fe4）。
 */

/** 各タブ冒頭の見出し（英字のeyebrow＋和文タイトル＋説明） */
export function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="px-5 pb-4 pt-6">
      <p className="font-num text-[11px] font-semibold tracking-[0.18em] text-ink-3">{eyebrow}</p>
      <h1 className="mt-2 text-[22px] font-bold leading-tight text-ink">{title}</h1>
      {description && <p className="mt-2 text-xs leading-relaxed text-ink-3">{description}</p>}
    </div>
  );
}

/** 画面の主ボタン（アイリス・角丸大） */
export function PrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-iris px-4 py-3 text-sm font-bold text-white',
        'transition active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100',
        className
      )}
    >
      {children}
    </button>
  );
}

/** 合計金額のまとめ帯 */
export function BillSummary({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="mx-5 my-5 flex items-center justify-between gap-3 rounded-2xl bg-lilac px-5 py-4">
      <span className="text-xs font-semibold text-iris">{label}</span>
      <b className="font-num text-[22px] font-extrabold tabular-nums text-[#59356f]">{amount}</b>
    </div>
  );
}

/** 空状態・注意書き */
export function QrEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-6 py-12 text-center text-[13px] leading-loose text-ink-3">{children}</p>;
}

export function QrNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('px-5 pb-5 text-[11px] leading-relaxed text-ink-3', className)}>{children}</p>;
}

/** 通信に失敗したことを隠さずに伝えるための赤い帯 */
export function QrError({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-5 mb-3 rounded-xl bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger">{children}</p>
  );
}

/** 写真が無い商品のイラスト（プロトタイプの dish-art と同じ器／グラス） */
export function DishArt({ drink, className }: { drink?: boolean; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('grid h-[76px] w-full place-items-center rounded-lg bg-lilac text-[#9a77c0]', className)}
    >
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="h-10 w-10">
        {drink ? (
          <>
            <path d="M13 14h20l-3 25H16zM20 14l3-9h9M13 22h19" />
            <path d="M20 28v6M24 28v6" />
          </>
        ) : (
          <>
            <ellipse cx="24" cy="28" rx="19" ry="10" />
            <ellipse cx="24" cy="27" rx="13" ry="6" />
            <path d="M17 16c-4-4 4-5 0-9M24 14c-4-4 4-5 0-9M31 16c-4-4 4-5 0-9" />
          </>
        )}
      </svg>
    </div>
  );
}
