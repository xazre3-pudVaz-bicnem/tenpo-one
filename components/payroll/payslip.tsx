import { yen, formatDate, formatMinutes } from '@/lib/format';
import { PayslipPrintButton } from './payslip-print-button';

export interface PayslipData {
  runTitle: string;
  runType: 'salary' | 'bonus';
  periodStart: string | null;
  periodEnd: string | null;
  paymentDate: string | null;
  profileName: string;
  organizationName: string | null;
  workDays: number;
  workMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  basePay: number;
  overtimePay: number;
  nightPay: number;
  holidayPay: number;
  commutePay: number;
  allowanceTotal: number;
  commissionTotal: number;
  grossTotal: number;
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td className="py-1.5 text-gray-600">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{yen(value)}</td>
    </tr>
  );
}

/** 給与明細（本人ビュー）。1枚レイアウトで .print-area を用いて印刷する */
export function Payslip({ data }: { data: PayslipData }) {
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <PayslipPrintButton />
      </div>
      <div className="print-area mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-8 text-sm text-navy print:mt-0 print:max-w-none print:border-0">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4">
          <div>
            <h1 className="text-lg font-bold">{data.runType === 'bonus' ? '賞与明細書' : '給与明細書'}</h1>
            <p className="mt-1 text-xs text-gray-500">{data.runTitle}</p>
            <p className="mt-1 text-xs text-gray-500">
              {data.runType === 'bonus'
                ? `支給日: ${formatDate(data.paymentDate)}`
                : `対象期間: ${formatDate(data.periodStart)} 〜 ${formatDate(data.periodEnd)}`}
            </p>
          </div>
          <div className="text-right text-xs text-gray-500">
            {data.organizationName && <p>{data.organizationName}</p>}
            <p className="mt-1 text-sm font-medium text-navy">{data.profileName} 様</p>
          </div>
        </div>

        {data.runType === 'bonus' ? (
          <div className="rounded-lg bg-navy px-4 py-4 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">賞与支給額</span>
              <span className="text-2xl font-bold tabular-nums">{yen(data.grossTotal)}</span>
            </div>
          </div>
        ) : (
          <>
            <section className="mb-5">
              <h2 className="mb-2 text-xs font-semibold text-gray-500">勤怠情報</h2>
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-gray-50 p-3">
                  <dt className="text-xs text-gray-500">出勤日数</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{data.workDays}日</dd>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <dt className="text-xs text-gray-500">実働時間</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{formatMinutes(data.workMinutes)}</dd>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <dt className="text-xs text-gray-500">残業時間</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{formatMinutes(data.overtimeMinutes)}</dd>
                </div>
              </dl>
            </section>

            <section className="mb-5">
              <h2 className="mb-2 text-xs font-semibold text-gray-500">支給内訳</h2>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  <Row label="基本給" value={data.basePay} />
                  <Row label="残業手当" value={data.overtimePay} />
                  <Row label="深夜手当" value={data.nightPay} />
                  <Row label="休日手当" value={data.holidayPay} />
                  <Row label="交通費" value={data.commutePay} />
                  <Row label="諸手当" value={data.allowanceTotal} />
                  <Row label="歩合給" value={data.commissionTotal} />
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-semibold text-navy">
                    <td className="py-2">支給合計</td>
                    <td className="py-2 text-right tabular-nums">{yen(data.grossTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>

            <section className="mb-5">
              <h2 className="mb-2 text-xs font-semibold text-gray-500">控除</h2>
              <p className="mb-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                税・社会保険料の控除は今後対応予定です。現時点での控除額は0円として表示しています。
              </p>
              <table className="w-full text-sm">
                <tbody>
                  <Row label="控除合計" value={0} />
                </tbody>
              </table>
            </section>

            <div className="rounded-lg bg-navy px-4 py-4 text-white">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">差引支給額</span>
                <span className="text-2xl font-bold tabular-nums">{yen(data.grossTotal)}</span>
              </div>
            </div>
          </>
        )}

        <p className="mt-6 text-center text-[10px] text-gray-400">
          本明細は概算の試算です。税金・社会保険料・年末調整は含まれません。正式な計算は社会保険労務士・税理士へご確認ください。
        </p>
      </div>
    </div>
  );
}
