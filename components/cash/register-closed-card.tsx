'use client';

import { useTransition } from 'react';
import { Printer } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { yen, formatDateTime } from '@/lib/format';
import { reprintRegisterReport } from '@/app/app/cash/actions';
import { toUserMessage } from '@/lib/action-error';

export interface ClosedRegisterCardData {
  id: string;
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

/**
 * レジ締め済み（未開局ではないが店舗日次締めは未実施かもしれない）のレジ1台分のカード。
 * 締め時に自動で出るレジ精算レシートが出なかったとき（紙切れ・プリンター未接続）のために再印刷ボタンを持つ。
 */
export function RegisterClosedCard({
  session,
  storeDayClosed,
  canOperate = false,
}: {
  session: ClosedRegisterCardData;
  storeDayClosed: boolean;
  /** レジ操作権限（再印刷ボタンの表示） */
  canOperate?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleReprint = () => {
    startTransition(async () => {
      try {
        const result = await reprintRegisterReport(session.id);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }
        toast('レジ精算レシートを印刷しています');
      } catch (err) {
        toast(toUserMessage(err, '再印刷に失敗しました'), 'error');
      }
    });
  };

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
        {canOperate && (
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={handleReprint} disabled={pending}>
              <Printer className="h-4 w-4" />
              {pending ? '印刷中…' : '精算レシートを再印刷 / Reprint'}
            </Button>
          </div>
        )}
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
