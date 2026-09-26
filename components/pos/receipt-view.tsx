'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
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
  qrDataUrl,
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

  const visibleLines = useMemo(() => receipt.lines.filter((l) => !l.cancelled), [receipt.lines]);
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
            placeholder="お客様名（空欄なら「上様」）"
            className="h-12"
          />
        </div>
      )}

      {/* 領収書の分割発行。会計は分けず、証憑だけを人数ぶんに分ける */}
      {tab === 'invoice' && !invoiceLocked && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700">分割発行</span>
            <div className="flex flex-wrap gap-1">
              {[1, 2, 3, 4, 5, 6].filter((n) => n <= maxSplit).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => changeSplitCount(n)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium',
                    splitCount === n ? 'bg-navy text-white' : 'bg-white text-gray-600 border border-gray-300'
                  )}
                >
                  {n === 1 ? '分けない' : `${n}枚`}
                </button>
              ))}
            </div>
            {maxSplit > 6 && (
              <Input
                type="number"
                min={2}
                max={maxSplit}
                value={splitCount > 1 ? splitCount : ''}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 2 && n <= maxSplit) changeSplitCount(n);
                }}
                placeholder="枚数"
                className="w-24"
              />
            )}
          </div>

          {isSplit && (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {amounts.map((a, i) => (
                  <label key={i} className="text-sm">
                    <span className="mb-1 block text-gray-600">{i + 1}枚目</span>
                    <Input
                      type="number"
                      min={1}
                      value={a}
                      onChange={(e) => changeAmount(i, Number(e.target.value))}
                      className="tabular-nums"
                    />
                  </label>
                ))}
              </div>
              <p
                className={cn(
                  'mt-2 text-sm tabular-nums',
                  balanced ? 'text-gray-600' : 'font-semibold text-danger'
                )}
              >
                合計 {yen(splitSum)} / 領収額 {yen(receipt.netPaid)}
                {!balanced && <>　← 差額 {yen(receipt.netPaid - splitSum)}。合わせないと印刷できません</>}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                会計・売上は分かれません。領収書だけを {splitCount} 枚に分けて出します（1枚ずつ「{splitLabel({ index: 1, count: splitCount })}」が入ります）。
              </p>
            </>
          )}
        </div>
      )}

      <div
        className={cn(
          'print-area mx-auto rounded-xl border border-gray-200 bg-white p-4 text-gray-800 shadow-sm',
          PAPER_CLASS
        )}
      >
        {tab === 'receipt' ? (
          <>
            {receipt.isReissue && (
              <p className="mb-1 text-center text-sm font-bold text-danger">※再発行</p>
            )}
            <div className="text-center">
              <p className="text-sm font-bold">{receipt.storeName}</p>
              {receipt.storeAddress && <p>{receipt.storeAddress}</p>}
              {receipt.storePhone && <p>TEL {receipt.storePhone}</p>}
              {receipt.headerMessage && <p className="mt-1 whitespace-pre-line">{receipt.headerMessage}</p>}
            </div>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <p>注文番号 #{receipt.orderNo}{receipt.tableName && <>　卓 {receipt.tableName}</>}</p>
            <p>{receipt.issuedAt}</p>
            {(receipt.registerName || receipt.staffName) && (
              <p className="text-[10px] text-gray-500">
                {receipt.registerName && <>レジ: {receipt.registerName}　</>}
                {receipt.staffName && <>担当: {receipt.staffName}</>}
              </p>
            )}
            <div className="my-2 border-t border-dashed border-gray-300" />
            <table className="w-full">
              <tbody>
                {visibleLines.map((it, i) => (
                  <tr key={i}>
                    <td className="py-0.5 align-top">
                      {it.name}
                      {it.modifiers.length > 0 && (
                        <div className="pl-2 text-[10px] text-gray-500">
                          {it.modifiers.map((m, mi) => (
                            <div key={mi}>
                              ＋{m.name}
                              {m.price > 0 && <> {yen(m.price)}</>}
                            </div>
                          ))}
                        </div>
                      )}
                      <br />
                      <span className="text-[10px] text-gray-500">
                        {yen(it.unitPrice)} × {it.quantity}
                      </span>
                    </td>
                    <td className="py-0.5 text-right align-top tabular-nums">{yen(it.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>小計</span>
                <span className="tabular-nums">{yen(receipt.subtotal)}</span>
              </div>
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
              <div className="flex justify-between text-sm font-bold">
                <span>合計</span>
                <span className="tabular-nums">{yen(receipt.total)}</span>
              </div>
              {receipt.taxRows.map((row) => (
                <div key={row.rate} className="flex justify-between text-[10px] text-gray-500">
                  <span>（内消費税{row.rate}%対象 {yen(row.taxable)}）</span>
                  <span className="tabular-nums">税額 {yen(row.tax)}</span>
                </div>
              ))}
            </div>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <div className="space-y-0.5">
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
            {receipt.registrationNumber && (
              <>
                <div className="my-2 border-t border-dashed border-gray-300" />
                <p>登録番号 {receipt.registrationNumber}</p>
              </>
            )}
            {receipt.footerMessage && (
              <p className="mt-2 whitespace-pre-line text-center">{receipt.footerMessage}</p>
            )}
            <div className="mt-3 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- レシート内埋め込みのdata URI画像。next/imageの最適化は不要かつ非対応 */}
              <img src={qrDataUrl} alt="取引照会用QRコード" width={80} height={80} />
            </div>
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
                  PAPER_CLASS
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
  return (
    <>
      <p className="text-center text-sm font-bold">領収書{label && <span className="ml-1 font-normal">{label}</span>}</p>
      {/* 発行元は上（2026-09-26 Ronnie）。印字（lib/receipt-markup.ts 等）と同じ並び */}
      <div className="mt-1 text-center">
        <p className="font-bold">{receipt.storeName}</p>
        {receipt.storeAddress && <p>{receipt.storeAddress}</p>}
        {receipt.storePhone && <p>TEL {receipt.storePhone}</p>}
        {receipt.registrationNumber && <p>登録番号 {receipt.registrationNumber}</p>}
      </div>
      <div className="my-2 border-t border-dashed border-gray-300" />
      <p className="border-b border-gray-400 pb-1 text-sm">
        {recipientName ? `${recipientName} 様` : '　　　　　　　様'}
      </p>
      {/* 一部返金がある場合は実質お支払い額（netPaid）を表示する。receipt.total のままだと
          返金分を含んだ金額が「領収」した金額として証憑に残ってしまう */}
      <p className="mt-3 text-center text-lg font-bold tabular-nums">{yen(amount)}−</p>
      <p className="mt-1 text-center text-[10px] text-gray-500">（税込）</p>
      <div className="my-2 border-t border-dashed border-gray-300" />
      <p>但し {purpose}</p>
      <p className="mt-1">上記正に領収いたしました</p>
      <div className="my-2 border-t border-dashed border-gray-300" />
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>内消費税</span>
        <span className="tabular-nums">{yen(tax)}</span>
      </div>
      {label && (
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>合計 {yen(receipt.netPaid)} のうち</span>
          <span>{label.replace(/[()]/g, '')}</span>
        </div>
      )}
      <p className="mt-2">{receipt.issuedAt}</p>
      {receipt.staffName && <p>担当 {receipt.staffName}</p>}
      {/* 印鑑欄（右寄せ）。印字では罫線の枠（lib/receipt-layout.ts stampBoxLines） */}
      <div className="mt-2 flex justify-end">
        <div className="flex h-[72px] w-[72px] items-start justify-center rounded-sm border border-gray-500 pt-1 text-[10px] text-gray-500">
          印
        </div>
      </div>
    </>
  );
}
