import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

/** レポート用の任意期間指定フォーム（GET送信・JS不要）。store等の他パラメータはhiddenで維持する。 */
export function PeriodForm({
  action,
  from,
  to,
  hidden,
}: {
  action: string;
  from: string;
  to: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} method="get" className="flex w-full flex-wrap items-end gap-2">
      {Object.entries(hidden ?? {}).map(([k, v]) => v != null && <input key={k} type="hidden" name={k} value={v} />)}
      <div className="min-w-0 flex-1 sm:flex-none">
        <Label htmlFor="from" className="text-xs">
          開始日
        </Label>
        <Input id="from" type="date" name="from" defaultValue={from} className="h-9 w-full text-xs sm:w-36" />
      </div>
      <div className="min-w-0 flex-1 sm:flex-none">
        <Label htmlFor="to" className="text-xs">
          終了日
        </Label>
        <Input id="to" type="date" name="to" defaultValue={to} className="h-9 w-full text-xs sm:w-36" />
      </div>
      <Button type="submit" variant="secondary" size="sm">
        任意期間で表示
      </Button>
    </form>
  );
}
