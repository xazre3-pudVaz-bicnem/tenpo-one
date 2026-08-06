import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

/**
 * 期間絞込フォーム（GET送信・JS不要）。tab等の他パラメータはhidden inputで維持する。
 * 追加の絞込UI（承認状態・科目セレクト等）は children で渡す。
 */
export function PeriodFilter({
  action,
  hidden,
  from,
  to,
  children,
}: {
  action: string;
  hidden?: Record<string, string | undefined>;
  from: string;
  to: string;
  children?: React.ReactNode;
}) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
      {Object.entries(hidden ?? {}).map(
        ([k, v]) => v != null && <input key={k} type="hidden" name={k} value={v} />
      )}
      <div>
        <Label htmlFor="from">開始日</Label>
        <Input id="from" type="date" name="from" defaultValue={from} className="w-40" />
      </div>
      <div>
        <Label htmlFor="to">終了日</Label>
        <Input id="to" type="date" name="to" defaultValue={to} className="w-40" />
      </div>
      {children}
      <Button type="submit" variant="secondary" size="md">
        絞り込む
      </Button>
    </form>
  );
}
