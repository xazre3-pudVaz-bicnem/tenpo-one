import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { yen, formatDateTime } from '@/lib/format';

export interface ClosedRegisterCardData {
  registerName: string;
  openedByName: string;
  closedByName: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
}

/** レジ締め済み（未開局ではないが店舗日次締めは未実施かもしれない）のレジ1台分のカード */
export function RegisterClosedCard({
  session,
  storeDayClosed,
}: {
  session: ClosedRegisterCardData;
  storeDayClosed: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{session.registerName}</CardTitle>
          <p className="mt-1 text-xs text-gray-500">
            開局 {formatDateTime(session.openedAt)}｜担当 {session.openedByName}
            {session.closedAt && (
              <>
                ｜締め {formatDateTime(session.closedAt)}｜締め担当 {session.closedByName}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="gray">レジ締め済み</Badge>
          <Badge tone={storeDayClosed ? 'success' : 'warning'}>
            {storeDayClosed ? '店舗日次締め済み' : '店舗日次締めが未実施'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="釣銭準備金" value={yen(session.openingFloat)} />
          <Stat label="理論現金" value={yen(session.expectedCash)} />
          <Stat label="実現金" value={yen(session.countedCash)} />
          <Stat
            label="差異"
            value={session.difference == null ? '—' : `${session.difference > 0 ? '+' : ''}${yen(session.difference)}`}
            danger={!!session.difference}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${danger ? 'text-danger' : 'text-navy'}`}>{value}</p>
    </div>
  );
}
