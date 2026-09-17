'use client';

/** 印刷・PDF（ブラウザの印刷ダイアログ。.print-area の台帳部分だけが出力される） */
export function PrintButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {children}
    </button>
  );
}
