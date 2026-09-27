import { Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadRegisterReportData } from '@/lib/register-report-loader';
import { layoutRegisterReport, layoutSettlementReport } from '@/lib/register-report';
import { paperRowsFromLines } from '@/lib/receipt-paper';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReceiptPaper } from './receipt-paper';

/**
 * レジクローズの画面に、いま締めたら出る「レジ精算」と「精算情報」を紙そっくりに出す（2026-09-28 Ronnie）。
 * 開局中のセッションがあればその途中集計、無ければ今日の最後に締めたセッション。
 * 数字はレジ精算レシートと同じ（loadRegisterReportData）。印字されるのはレジ締めのとき（本紙）と「精算情報を印刷」（別紙）。
 */
export async function RegisterReportPreview({ sessionId, live }: { sessionId: string; live: boolean }) {
  const supabase = await createClient();
  const loaded = await loadRegisterReportData(supabase, sessionId);
  if (!loaded) return null;
  const main = paperRowsFromLines(layoutRegisterReport(loaded.data, { paperWidth: 80 }));
  const settlement = paperRowsFromLines(layoutSettlementReport(loaded.data, { paperWidth: 80 }));
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle en="Register report">レジ精算（画面）</CardTitle>
        <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <Printer className="h-3.5 w-3.5" />
          {live ? '開局中の途中集計。レジ締めをするとこの内容で本紙が出ます' : '本日の締め時点。本紙はレジ締めのときに出ています'}
        </span>
      </CardHeader>
      <CardContent>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] font-bold text-ink-2">本紙（レジ締めで自動）</p>
            <ReceiptPaper rows={main} />
          </div>
          <div>
            <p className="mb-2 text-[12px] font-bold text-ink-2">別紙「精算情報」（「精算情報を印刷」を押したときだけ）</p>
            <ReceiptPaper rows={settlement} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
