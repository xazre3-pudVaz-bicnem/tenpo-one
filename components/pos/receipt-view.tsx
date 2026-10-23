'use client';

import { formatReceiptAddress } from '@/lib/receipt-layout';

import { useMemo, useState } from 'react';
import { ClassicInvoice } from './classic-invoice';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { billSlipLines } from '@/lib/receipt-layout';
import { Input } from '@/components/ui/input';
import type { ReceiptData } from '@/lib/receipts';
import {
  isSplitBalanced,
  ryoshushoSlips,
  splitAmounts as equalSplit,
  splitLabel,
  RYOSHUSHO_SPLIT_MAX,
} from '@/lib/ryoshusho-split';
import { PrintButton } from './print-button';
import { CloudPrintButton } from './cloud-print-button';
import {
  RYOSHUSHO_DEFAULT_PURPOSE,
  RYOSHUSHO_ISSUED_MESSAGE,
  jstShortDateTime,
  type RyoshushoIssueState,
} from '@/lib/ryoshusho-issue';

/** 画面の控えは 80mm 幅のレシートに合わせる */
const PAPER_CLASS = 'max-w-[300px] text-xs';

/**
 * レシート／領収書の画面。
 * - 紙幅の切替（58/80mm）・PDF 保存は出さない。印刷ボタンは下に1つだけ：レシートプリンター（CloudPRNT）へ、
 *   無い店舗だけブラウザ印刷（2026-09-26 Ronnie「レシートプリンターに出るのは当たり前。印刷だけ下に」）
 * - 但し書きは「飲食代として」で固定（入力欄は無し。領収書の中に自動で入る）
 * - 領収書は一度きり。発行済みなら入力とボタンを出さず「発行済み」だけ出す（サーバー側でも弾く）
 */
export function ReceiptView({
  receipt,
  orderId,
  qrDataUrl: _qrDataUrl,
  logPrintJobAction,
  cloudPrntAvailable = false,
  initialTab = 'receipt',
  ryoshushoIssued,
}: {
  receipt: ReceiptData;
  orderId: string;
  qrDataUrl: string;
  logPrintJobAction: (orderId: string, jobType: 'receipt' | 'ryoshusho') => Promise<void>;
  cloudPrntAvailable?: boolean;
  /** 伝票明細の「領収書」ボタンから開いたときは、領収書のタブを最初から出す */
  initialTab?: 'receipt' | 'invoice';
  /** 領収書の発行状況（サーバーで print_jobs から読む） */
  ryoshushoIssued?: RyoshushoIssueState;
}) {
  const [tab, setTab] = useState<'receipt' | 'invoice'>(initialTab);
  const [recipientName, setRecipientName] = useState('');
  /** 但し書きは「飲食代として」固定。画面では入力させず、領収書の中に自動で入る（2026-09-26 Ronnie） */
  const purpose = RYOSHUSHO_DEFAULT_PURPOSE;
  // 領収書の発行済み（サーバーの値 → この画面で出したら即 true）
  const [issued, setIssued] = useState<RyoshushoIssueState>(ryoshushoIssued ?? { issued: false, at: null, count: 0 });
  const invoiceLocked = tab === 'invoice' && issued.issued;
  // 領収書の分割発行。1 のときは今までどおり全額1枚
  const [splitCount, setSplitCount] = useState(1);
  const [amounts, setAmounts] = useState<number[]>([]);

  // 取消済みと0円の明細（飲み放題・コースの中身）は出さない（印字と同じ。2026-09-26 店舗要望）
  const visibleLines = useMemo(() => billSlipLines(receipt.lines.filter((l) => !l.cancelled)), [receipt.lines]);
  const invoiceTaxTotal = useMemo(() => receipt.taxRows.reduce((a, r) => a + r.tax, 0), [receipt.taxRows]);

  // 枚数で割り切れる上限（1枚あたり1円以上）
  const maxSplit = Math.max(1, Math.min(RYOSHUSHO_SPLIT_MAX, Math.floor(receipt.netPaid)));
  const isSplit = splitCount > 1 && amounts.length === splitCount;
  const splitSum = amounts.reduce((a, b) => a + b, 0);
  const balanced = isSplit && isSplitBalanced(amounts, receipt.netPaid);
  const slips = useMemo(
    () => (balanced ? ryoshushoSlips(amounts, invoiceTaxTotal) : []),
    [balanced, amounts, invoiceTaxTotal]
  );

  /** 枚数を変えたら等分でやり直す（端数は1枚目に寄る） */
  const changeSplitCount = (n: number) => {
    setSplitCount(n);
    setAmounts(n > 1 ? equalSplit(receipt.netPaid, n) : []);
  };

  /** 1枚の金額を直したら、差額は最後の1枚で吸収して合計を保つ */
  const changeAmount = (i: number, value: number) => {
    setAmounts((prev) => {
      const next = [...prev];
      next[i] = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
      return next;
    });
  };

  /** 下の印刷ボタン。レシートプリンターがあればそこへ、無い店舗だけブラウザ印刷（AirPrint） */
  const printButton = invoiceLocked ? null : cloudPrntAvailable ? (
    <CloudPrintButton
      orderId={orderId}
      jobType={tab === 'receipt' ? 'receipt' : 'ryoshusho'}
      reissue={receipt.isReissue}
      recipientName={recipientName}
      purpose={purpose}
      splitAmounts={balanced ? amounts : null}
      disabled={tab === 'invoice' && isSplit && !balanced}
      onPrinted={(n) => {
        if (tab === 'invoice') setIssued({ issued: true, at: new Date().toISOString(), count: n });
      }}
      className="h-16 w-full justify-center text-base"
    />
  ) : (
    <PrintButton
      orderId={orderId}
      jobType={tab === 'receipt' ? 'receipt' : 'ryoshusho'}
      logPrintJobAction={(id, jobType) =>
        logPrintJobAction(id, jobType).then(() => {
          if (jobType === 'ryoshusho') setIssued({ issued: true, at: new Date().toISOString(), count: 1 });
        })
      }
    />
  );

  const issuedNotice = invoiceLocked && (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
      <p className="font-bold">
        領収書 発行済み{issued.at && `（${jstShortDateTime(issued.at)}${issued.count > 1 ? `・${issued.count}枚` : ''}）`}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed">{RYOSHUSHO_ISSUED_MESSAGE}。二重発行を防ぐため、再発行はできません。</p>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('receipt')}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-semibold',
              tab === 'receipt' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600'
            )}
          >
            レシート
          </button>
          <button
            type="button"
            onClick={() => setTab('invoice')}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-semibold',
              tab === 'invoice' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600'
            )}
          >
            領収書
          </button>
        </div>

        {/* 紙幅は 80mm 固定・PDF 保存は無し（2026-09-26 Ronnie「要らない」）。印刷ボタンは下に1つ */}
      </div>

      {issuedNotice}

      {tab === 'invoice' && !invoiceLocked && (
        <div className="mb-4 print:hidden">
          <label className="mb-1 block text-sm font-medium text-gray-700">宛名 / Name</label>
          <Input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="お客様名（空欄なら手書き用の空欄で印字）"
            className="h-12"
          />
        </div>
      )}

      {/* 領収書の分割発行。会計は分けず、証憑だけを人数ぶんに分ける。
          既定は「分けない」（全額1枚）。「分ける」を押したときだけ枚数と1枚ずつの金額を出す（2026-09-26 Ronnie）。
          合計は領収額とぴったり同じでないと印刷できない（領収額を超える領収書は違反） */}
      {tab === 'invoice' && !invoiceLocked && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700">分割発行 / Split</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => changeSplitCount(1)}
                className={cn(
                  'h-10 rounded-full px-4 text-sm font-semibold',
                  splitCount === 1 ? 'bg-navy text-white' : 'bg-white text-gray-600 border border-gray-300'
                )}
              >
                分けない
              </button>
              <button
                type="button"
                onClick={() => splitCount === 1 && changeSplitCount(Math.min(2, maxSplit))}
                disabled={maxSplit < 2}
                className={cn(
                  'h-10 rounded-full px-4 text-sm font-semibold disabled:opacity-40',
                  splitCount > 1 ? 'bg-navy text-white' : 'bg-white text-gray-600 border border-gray-300'
                )}
              >
                分ける
              </button>
            </div>
          </div>

          {isSplit && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-700">何枚に分けますか</span>
                <div className="flex flex-wrap gap-1">
                  {[2, 3, 4, 5, 6].filter((n) => n <= maxSplit).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => changeSplitCount(n)}
                      className={cn(
                        'h-10 rounded-full px-3 text-sm font-medium',
                        splitCount === n ? 'bg-navy text-white' : 'bg-white text-gray-600 border border-gray-300'
                      )}
                    >
                      {n}枚
                    </button>
                  ))}
                </div>
                {maxSplit > 6 && (
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={2}
                    max={maxSplit}
                    value={splitCount}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 2 && n <= maxSplit) changeSplitCount(n);
                    }}
                    aria-label="枚数"
                    className="h-10 w-24"
                  />
                )}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {amounts.map((a, i) => (
                  <label key={i} className="text-sm">
                    <span className="mb-1 block text-gray-600">{i + 1}枚目</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={a}
                      onChange={(e) => changeAmount(i, Number(e.target.value))}
                      className="h-11 tabular-nums"
                    />
                  </label>
                ))}
              </div>
              <p className={cn('mt-2 text-sm tabular-nums', balanced ? 'text-gray-600' : 'font-semibold text-danger')}>
                合計 {yen(splitSum)} / 領収額 {yen(receipt.netPaid)}
                {!balanced &&
                  (splitSum > receipt.netPaid
                    ? `　← 領収額を ${yen(splitSum - receipt.netPaid)} 超えています。領収額より多い領収書は出せません`
                    : `　← 差額 ${yen(receipt.netPaid - splitSum)}。合わせないと印刷できません`)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                会計・売上は分かれません。領収書だけを {splitCount} 枚に分けて出します（1枚ずつ「{splitLabel({ index: 1, count: splitCount })}」が入ります）。
                分けて出したあとも、この伝票の領収書は二度と出せません。
              </p>
            </>
          )}
        </div>
      )}

      <div
        className={cn(
          'print-area mx-auto rounded-xl border border-gray-200 bg-white p-4 text-gray-800 shadow-sm',
          tab === 'invoice' ? 'max-w-[730px] overflow-x-auto' : PAPER_CLASS
        )}
      >
        {tab === 'receipt' ? (
          <>
            {receipt.isReissue && (
              <p className="mb-1 text-center text-sm font-bold text-danger">※再発行</p>
            )}
            <div className="text-center">
              <p className="text-[18px] font-bold leading-tight">{receipt.storeName}</p>
              <p className="my-1 font-bold">会計レシート</p>
              {receipt.storeAddress && <p className="whitespace-pre-line">{formatReceiptAddress(receipt.storeAddress)}</p>}
              {receipt.storePhone && <p>TEL {receipt.storePhone}</p>}
              {receipt.registrationNumber && <p>登録番号 {receipt.registrationNumber}</p>}
            </div>
            <div className="grid grid-cols-2 items-baseline gap-y-[1.5mm] leading-tight">
              <span>卓番号</span><strong className="text-right text-[20px]">{receipt.tableName ?? '—'}</strong>
              <span>{receipt.staffName ? `担当 ${receipt.staffName}` : ''}</span><span className="text-right">{receipt.guestCount != null ? `人数 ${receipt.guestCount}名` : ''}</span>
              <span>伝票番号</span><span className="text-right">No.{receipt.orderNo}</span>
              <span>開始日時</span><span className="text-right">{receipt.startedAt ?? '—'}</span>
              {(receipt.completedAt === undefined ? receipt.issuedAt : receipt.completedAt) && <>
                <span>会計日時</span><span className="text-right">{receipt.completedAt === undefined ? receipt.issuedAt : receipt.completedAt}</span>
              </>}
            </div>
            <table className="w-full table-fixed border-collapse text-[12px] leading-[1.4]">
              <colgroup><col /><col className="w-[34px]" /><col className="w-[76px]" /></colgroup>
              <thead className="border-y border-gray-400"><tr>
                <th className="py-1 text-left font-normal">商品名</th><th className="py-1 text-right font-normal">数</th><th className="py-1 text-right font-normal">金額</th>
              </tr></thead>
              <tbody>{visibleLines.map((it, i) => (
                <tr key={i}><td className="truncate py-1 pr-1" title={it.name}>{it.name}</td><td className="py-1 text-right align-top">{it.quantity}</td><td className="py-1 text-right align-top tabular-nums">{yen(it.lineTotal)}</td></tr>
              ))}</tbody>
            </table>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>小計</span>
                <span className="tabular-nums">{yen(receipt.subtotal)}</span>
              </div>
              {receipt.taxRows.map((row) => (
                <div key={row.rate} className="flex justify-between text-[10px] text-gray-500">
                  <span>（内消費税{row.rate}%対象 {yen(row.taxable)}）</span>
                  <span className="tabular-nums">税額 {yen(row.tax)}</span>
                </div>
              ))}
              {receipt.serviceCharge > 0 && (
                <div className="flex justify-between">
                  <span>サービス料</span>
                  <span className="tabular-nums">{yen(receipt.serviceCharge)}</span>
                </div>
              )}
              {receipt.discount > 0 && (
                <div className="flex justify-between">
                  <span>値引き{receipt.couponCode ? `（クーポン: ${receipt.couponCode}）` : ''}</span>
                  <span className="tabular-nums">-{yen(receipt.discount)}</span>
                </div>
              )}
              <div className="flex justify-between border-y border-gray-400 py-2 text-[20px] font-bold">
                <span>合計</span>
                <span className="tabular-nums">{yen(receipt.total)}</span>
              </div>

            </div>
            <div className="mt-2 space-y-0.5">
              {receipt.payments.map((p, i) => (
                <div key={i} className="flex justify-between">
                  <span>{p.label}</span>
                  <span className="tabular-nums">{yen(p.amount)}</span>
                </div>
              ))}
              {receipt.tendered != null && (
                <>
                  <div className="flex justify-between">
                    <span>預り金</span>
                    <span className="tabular-nums">{yen(receipt.tendered)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>お釣り</span>
                    <span className="tabular-nums">{yen(receipt.change)}</span>
                  </div>
                </>
              )}
              {receipt.refundTotal > 0 && (
                <>
                  <div className="flex justify-between text-danger">
                    <span>返金</span>
                    <span className="tabular-nums">-{yen(receipt.refundTotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span>実質お支払い額</span>
                    <span className="tabular-nums">{yen(receipt.netPaid)}</span>
                  </div>
                </>
              )}
            </div>
            {(receipt.pointsEarned != null || receipt.pointsUsed != null || receipt.pointBalance != null) && (
              <>
                <div className="my-2 border-t border-dashed border-gray-300" />
                <div className="space-y-0.5 text-[10px] text-gray-500">
                  {!!receipt.pointsUsed && (
                    <div className="flex justify-between">
                      <span>ポイント利用</span>
                      <span className="tabular-nums">-{receipt.pointsUsed}pt</span>
                    </div>
                  )}
                  {!!receipt.pointsEarned && (
                    <div className="flex justify-between">
                      <span>ポイント付与</span>
                      <span className="tabular-nums">+{receipt.pointsEarned}pt</span>
                    </div>
                  )}
                  {receipt.pointBalance != null && (
                    <div className="flex justify-between">
                      <span>ポイント残高</span>
                      <span className="tabular-nums">{receipt.pointBalance}pt</span>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="my-2 border-t border-dashed border-gray-300" />
            <p className="mt-2 text-center leading-snug">ご来店ありがとうございました<br />またのご来店をお待ちしております</p>

          </>
        ) : (
          <InvoiceBody
            receipt={receipt}
            recipientName={recipientName}
            purpose={purpose}
            amount={receipt.netPaid}
            tax={invoiceTaxTotal}
            label=""
          />
        )}
      </div>

      {/* 印刷ボタンは下に1つだけ（2026-09-26 Ronnie） */}
      {printButton && <div className="mx-auto mt-4 max-w-md print:hidden">{printButton}</div>}

      {/* 分割したときは、実際に出る枚数ぶんの控えを並べて確認できるようにする */}
      {tab === 'invoice' && balanced && slips.length > 1 && (
        <div className="mt-4 print:hidden">
          <p className="mb-2 text-center text-sm font-medium text-gray-600">
            この {slips.length} 枚が印刷されます
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {slips.map((sl) => (
              <div
                key={sl.index}
                className={cn(
                  'rounded-xl border border-gray-200 bg-white p-4 text-gray-800 shadow-sm',
                  'w-full max-w-[730px] overflow-x-auto'
                )}
              >
                <InvoiceBody
                  receipt={receipt}
                  recipientName={recipientName}
                  purpose={purpose}
                  amount={sl.amount}
                  tax={sl.tax}
                  label={splitLabel(sl)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 領収書の中身。分割発行では金額・内消費税・通し番号だけを差し替えて同じ体裁で出す。 */
function InvoiceBody({
  receipt,
  recipientName,
  purpose,
  amount,
  tax,
  label,
}: {
  receipt: ReceiptData;
  recipientName: string;
  purpose: string;
  amount: number;
  tax: number;
  label: string;
}) {
  return <ClassicInvoice receipt={receipt} recipientName={recipientName} purpose={purpose} amount={amount} tax={tax} label={label} />;
}
