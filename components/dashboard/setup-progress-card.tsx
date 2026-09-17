import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * オンボーディング完了後も、スキップした手順が残っている場合にダッシュボードへ表示する再開バナー。
 * onboarding.completed=true かつ 完了率100%未満のときのみ呼び出し元で表示する。
 * 余白は呼び出し元（ホームの縦並び gap）で取る。
 */
export function SetupProgressCard({ percent }: { percent: number }) {
  return (
    <section
      aria-label="初期設定の進捗"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-wisteria bg-iris-soft/60 px-4 py-2.5"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
        <p className="text-sm font-bold text-royal">
          初期設定はあと少しです<span className="ml-1 tabular-nums">（完了 {percent}%）</span>
        </p>
        <div
          className="h-1.5 w-40 max-w-full rounded-full bg-white"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="初期設定の完了率"
        >
          <div className="h-1.5 rounded-full bg-iris" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-ink-2">スキップした項目を仕上げると、より使いやすくなります。</p>
      </div>
      <Link href="/app/onboarding" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
        設定を再開する
      </Link>
    </section>
  );
}
