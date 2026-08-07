import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

/**
 * オンボーディング完了後も、スキップした手順が残っている場合にダッシュボードへ表示する再開カード。
 * onboarding.completed=true かつ 完了率100%未満のときのみ呼び出し元で表示する。
 */
export function SetupProgressCard({ percent }: { percent: number }) {
  return (
    <Card className="mb-5 border-primary/30 bg-primary-soft/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy">初期設定はあと少しです（完了 {percent}%）</p>
          <p className="mt-1 text-xs text-gray-600">スキップした項目を仕上げると、より使いやすくなります。</p>
          <div className="mt-2 h-1.5 w-48 max-w-full rounded-full bg-white">
            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <Link
          href="/app/onboarding"
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-deep"
        >
          設定を再開する
        </Link>
      </CardContent>
    </Card>
  );
}
