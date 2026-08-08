'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { yen, formatMinutes } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PayrollCommissionBreakdown {
  name: string;
  basis: 'tax_excluded' | 'tax_included' | 'store_target';
  method: 'fixed' | 'rate' | 'tiered';
  salesAmount: number;
  rate?: number | null;
  tiers?: { from: number; to: number | null; rate: number; bandAmount: number; amount: number }[];
  achieved?: boolean;
  amount: number;
}

/** 適用期間（給与ルールの effective_from/effective_to）ごとの内訳。期間中に時給等が変わった場合に複数件になる。 */
export interface PayrollPeriodBreakdown {
  effectiveFrom: string;
  effectiveTo: string | null;
  rangeStart: string;
  rangeEnd: string;
  payType: 'monthly' | 'hourly' | 'daily';
  baseAmount: number;
  hourlyBase: number;
  workDays: number;
  basePay: number;
  overtimePay: number;
  nightPay: number;
  holidayPay: number;
}

export interface PayrollItemView {
  id: string;
  profileName: string;
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
  breakdown: {
    days: {
      date: string;
      clockIn: string;
      clockOut: string;
      breakMinutes: number;
      entryType?: string;
      workMinutes: string;
      overtimeMinutes: string;
      nightMinutes: string;
      holidayMinutes?: string;
    }[];
    hourlyBase: number;
    payType: 'monthly' | 'hourly' | 'daily';
    baseAmount: number;
    holidayRate?: number;
    sales: { taxExcluded: number; taxIncluded: number };
    commissions: PayrollCommissionBreakdown[];
    /** 期間跨ぎ昇給などで適用ルールが複数区間に分かれる場合の内訳（v2計算のみ） */
    periods?: PayrollPeriodBreakdown[];
    calcVersion?: string;
  };
}

const PAY_TYPE_LABEL: Record<string, string> = { monthly: '月給', hourly: '時給', daily: '日給' };

export function PayrollItemsTable({ items }: { items: PayrollItemView[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const totals = items.reduce(
    (a, i) => ({
      workDays: a.workDays + i.workDays,
      workMinutes: a.workMinutes + i.workMinutes,
      overtimeMinutes: a.overtimeMinutes + i.overtimeMinutes,
      nightMinutes: a.nightMinutes + i.nightMinutes,
      holidayMinutes: a.holidayMinutes + i.holidayMinutes,
      basePay: a.basePay + i.basePay,
      overtimePay: a.overtimePay + i.overtimePay,
      nightPay: a.nightPay + i.nightPay,
      holidayPay: a.holidayPay + i.holidayPay,
      commutePay: a.commutePay + i.commutePay,
      allowanceTotal: a.allowanceTotal + i.allowanceTotal,
      commissionTotal: a.commissionTotal + i.commissionTotal,
      grossTotal: a.grossTotal + i.grossTotal,
    }),
    {
      workDays: 0, workMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, holidayMinutes: 0,
      basePay: 0, overtimePay: 0, nightPay: 0, holidayPay: 0, commutePay: 0,
      allowanceTotal: 0, commissionTotal: 0, grossTotal: 0,
    }
  );

  const columnCount = 15;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-max text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-600">
          <tr>
            <th className="px-4 py-3 font-medium"></th>
            <th className="px-4 py-3 font-medium whitespace-nowrap">スタッフ</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">勤務日数</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">実働</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">残業</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">深夜</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">休日</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">基本給</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">残業代</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">深夜手当</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">休日手当</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">交通費</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">手当</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">歩合</th>
            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">総支給</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => (
            <Fragment key={item.id}>
              <tr
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => setExpanded((cur) => (cur === item.id ? null : item.id))}
              >
                <td className="px-2 py-3 text-gray-400">
                  {expanded === item.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </td>
                <td className="px-4 py-3 font-medium whitespace-nowrap text-navy">{item.profileName}</td>
                <td className="px-4 py-3 text-right tabular-nums">{item.workDays}日</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(item.workMinutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(item.overtimeMinutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(item.nightMinutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(item.holidayMinutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{yen(item.basePay)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{yen(item.overtimePay)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{yen(item.nightPay)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{yen(item.holidayPay)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{yen(item.commutePay)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{yen(item.allowanceTotal)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{yen(item.commissionTotal)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-navy">{yen(item.grossTotal)}</td>
              </tr>
              {expanded === item.id && (
                <tr className="bg-gray-50/60">
                  <td colSpan={columnCount} className="px-6 py-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold text-gray-500">計算根拠</p>
                        <ul className="space-y-1 text-sm text-gray-700">
                          {item.breakdown.periods && item.breakdown.periods.length > 1 && (
                            <li>
                              <p className="text-xs font-semibold text-gray-500">適用期間の内訳（期間中に給与ルールが変更されています）</p>
                              <ul className="ml-4 mt-0.5 list-disc space-y-0.5 text-xs text-gray-600">
                                {item.breakdown.periods.map((p, i) => (
                                  <li key={i}>
                                    適用期間: {p.rangeStart}〜{p.rangeEnd}（ルール適用開始{p.effectiveFrom}
                                    {p.effectiveTo ? `〜${p.effectiveTo}` : ''}） {PAY_TYPE_LABEL[p.payType]}¥
                                    {p.baseAmount.toLocaleString('ja-JP')} → 基本給{yen(p.basePay)}
                                    {p.overtimePay > 0 && `／残業代${yen(p.overtimePay)}`}
                                    {p.nightPay > 0 && `／深夜手当${yen(p.nightPay)}`}
                                    {p.holidayPay > 0 && `／休日手当${yen(p.holidayPay)}`}
                                  </li>
                                ))}
                              </ul>
                            </li>
                          )}
                          <li>
                            基本給 = {PAY_TYPE_LABEL[item.breakdown.payType]}
                            {item.breakdown.payType === 'hourly'
                              ? `¥${item.breakdown.baseAmount.toLocaleString('ja-JP')} × 実働${formatMinutes(item.workMinutes)}`
                              : `¥${item.breakdown.baseAmount.toLocaleString('ja-JP')}`}
                            {' = '}
                            {yen(item.basePay)}
                          </li>
                          {item.overtimePay > 0 && (
                            <li>
                              残業代 = 割増基礎時給¥{item.breakdown.hourlyBase.toLocaleString('ja-JP')} × 残業
                              {formatMinutes(item.overtimeMinutes)} = {yen(item.overtimePay)}
                            </li>
                          )}
                          {item.nightPay > 0 && (
                            <li>
                              深夜手当 = 割増基礎時給¥{item.breakdown.hourlyBase.toLocaleString('ja-JP')} × 深夜
                              {formatMinutes(item.nightMinutes)} = {yen(item.nightPay)}
                            </li>
                          )}
                          {item.holidayPay > 0 && (
                            <li>
                              休日手当 = 割増基礎時給¥{item.breakdown.hourlyBase.toLocaleString('ja-JP')} ×{' '}
                              {(
                                item.breakdown.payType === 'hourly'
                                  ? (item.breakdown.holidayRate ?? 1.35) - 1
                                  : item.breakdown.holidayRate ?? 1.35
                              ).toFixed(2)}{' '}
                              × 休日{formatMinutes(item.holidayMinutes)} = {yen(item.holidayPay)}
                            </li>
                          )}
                          {item.commutePay > 0 && <li>交通費 = {item.workDays}日分 = {yen(item.commutePay)}</li>}
                          {item.breakdown.commissions.map((c, i) => (
                            <li key={i}>
                              {c.basis === 'store_target' ? (
                                <>
                                  ボーナス（{c.name}） = 店舗売上{yen(c.salesAmount)}
                                  {c.achieved ? ' ≧ 目標達成' : ' ＜ 目標未達'} → {yen(c.amount)}
                                </>
                              ) : c.method === 'tiered' && c.tiers ? (
                                <>
                                  歩合（{c.name}・段階料率） = {c.basis === 'tax_excluded' ? '税抜' : '税込'}売上{yen(c.salesAmount)}
                                  <ul className="ml-4 mt-0.5 list-disc space-y-0.5 text-xs text-gray-500">
                                    {c.tiers.map((t, ti) => (
                                      <li key={ti}>
                                        {yen(t.from)}〜{t.to != null ? yen(t.to) : '上限なし'}：{yen(t.bandAmount)} × {t.rate}% ={' '}
                                        {yen(t.amount)}
                                      </li>
                                    ))}
                                  </ul>
                                  <span className="font-medium">→ 合計 {yen(c.amount)}</span>
                                </>
                              ) : c.method === 'rate' ? (
                                <>
                                  歩合（{c.name}） = {c.basis === 'tax_excluded' ? '税抜' : '税込'}売上{yen(c.salesAmount)} × {c.rate}% →{' '}
                                  {yen(c.amount)}
                                </>
                              ) : (
                                <>
                                  歩合（{c.name}） = {c.basis === 'tax_excluded' ? '税抜' : '税込'}売上{yen(c.salesAmount)} → {yen(c.amount)}
                                </>
                              )}
                            </li>
                          ))}
                          <li className="font-semibold text-navy">総支給 = {yen(item.grossTotal)}</li>
                        </ul>
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-semibold text-gray-500">日別勤怠</p>
                        {item.breakdown.days.length === 0 ? (
                          <p className="text-xs text-gray-400">対象日がありません</p>
                        ) : (
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 text-gray-500">
                                <tr>
                                  <th className="px-2 py-1.5 text-left">日付</th>
                                  <th className="px-2 py-1.5 text-left">出退勤</th>
                                  <th className="px-2 py-1.5 text-right">実働</th>
                                  <th className="px-2 py-1.5 text-right">残業</th>
                                  <th className="px-2 py-1.5 text-right">深夜</th>
                                  <th className="px-2 py-1.5 text-right">休日</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {item.breakdown.days.map((d) => (
                                  <tr key={d.date}>
                                    <td className="px-2 py-1.5 whitespace-nowrap">{d.date}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap">
                                      {d.clockIn}〜{d.clockOut}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{d.workMinutes}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{d.overtimeMinutes}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{d.nightMinutes}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{d.holidayMinutes ?? '0:00'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot className={cn('border-t-2 border-gray-200 bg-gray-50 font-semibold text-navy')}>
          <tr>
            <td className="px-4 py-3" colSpan={2}>
              合計
            </td>
            <td className="px-4 py-3 text-right tabular-nums">{totals.workDays}日</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(totals.workMinutes)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(totals.overtimeMinutes)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(totals.nightMinutes)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(totals.holidayMinutes)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(totals.basePay)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(totals.overtimePay)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(totals.nightPay)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(totals.holidayPay)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(totals.commutePay)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(totals.allowanceTotal)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(totals.commissionTotal)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{yen(totals.grossTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
