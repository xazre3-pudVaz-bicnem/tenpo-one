'use client';

import { useMemo, useState } from 'react';
import { FileDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { Input } from '@/components/ui/input';
import type { ReceiptData } from '@/lib/receipts';
import { PrintButton } from './print-button';

type PaperWidth = 58 | 80;

/** 58mm/80mm切替に応じた幅・フォントサイズのプリセット */
const WIDTH_CLASSES: Record<PaperWidth, string> = {
  58: 'max-w-[220px] text-[10.5px]',
  80: 'max-w-[300px] text-xs',
};

export function ReceiptView({
  receipt,
  orderId,
  qrDataUrl,
  logPrintJobAction,
}: {
  receipt: ReceiptData;
  orderId: string;
  qrDataUrl: string;
  logPrintJobAction: (orderId: string, jobType: 'receipt' | 'ryoshusho') => Promise<void>;
}) {
  const [tab, setTab] = useState<'receipt' | 'invoice'>('receipt');
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(80);
  const [recipientName, setRecipientName] = useState('');
  const [purpose, setPurpose] = useState('お品代として');

  const visibleLines = useMemo(() => receipt.lines.filter((l) => !l.cancelled), [receipt.lines]);
  const invoiceTaxTotal = useMemo(() => receipt.taxRows.reduce((a, r) => a + r.tax, 0), [receipt.taxRows]);

  const handlePdfSave = () => {
    window.print();
    void logPrintJobAction(orderId, tab === 'receipt' ? 'receipt' : 'ryoshusho');
  };

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

        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-gray-100 p-0.5 text-xs">
            {([58, 80] as PaperWidth[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setPaperWidth(w)}
                className={cn(
                  'rounded-full px-3 py-1 font-medium transition-colors',
                  paperWidth === w ? 'bg-white text-navy shadow-sm' : 'text-gray-500'
                )}
              >
                {w}mm
              </button>
            ))}
          </div>

          <div className="group relative inline-block print:hidden">
            <button
              type="button"
              onClick={handlePdfSave}
              className="flex h-14 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-navy hover:bg-gray-50"
            >
              <FileDown className="h-5 w-5" />
              PDFで保存
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden w-64 rounded-lg bg-navy px-3 py-2 text-xs leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block"
            >
              印刷ダイアログの「PDFに保存」を選択して保存してください（専用のPDF生成は行っていません。ブラウザ標準の印刷機能を案内しています）
            </div>
          </div>

          <PrintButton
            orderId={orderId}
            jobType={tab === 'receipt' ? 'receipt' : 'ryoshusho'}
            logPrintJobAction={logPrintJobAction}
          />
        </div>
      </div>

      {tab === 'invoice' && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 print:hidden">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">宛名</label>
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="お客様名（空欄可）"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">但し書き</label>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>
        </div>
      )}

      <div
        className={cn(
          'print-area mx-auto rounded-xl border border-gray-200 bg-white p-4 text-gray-800 shadow-sm',
          WIDTH_CLASSES[paperWidth]
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
            <p>注文番号 #{receipt.orderNo}</p>
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
          <>
            <p className="text-center text-sm font-bold">領収書</p>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <p className="border-b border-gray-400 pb-1 text-sm">
              {recipientName ? `${recipientName} 様` : '　　　　　　　様'}
            </p>
            {/* 一部返金がある場合は実質お支払い額（netPaid）を表示する。receipt.total のままだと
                返金分を含んだ金額が「領収」した金額として証憑に残ってしまう */}
            <p className="mt-3 text-center text-lg font-bold tabular-nums">{yen(receipt.netPaid)}−</p>
            <p className="mt-1 text-center text-[10px] text-gray-500">（税込）</p>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <p>但し {purpose} として</p>
            <p className="mt-1">上記正に領収いたしました</p>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>内消費税</span>
              <span className="tabular-nums">{yen(invoiceTaxTotal)}</span>
            </div>
            <p className="mt-2">{receipt.issuedAt}</p>
            <p className="mt-2 font-bold">{receipt.storeName}</p>
            {receipt.storeAddress && <p>{receipt.storeAddress}</p>}
            {receipt.storePhone && <p>TEL {receipt.storePhone}</p>}
            {receipt.registrationNumber && <p>登録番号 {receipt.registrationNumber}</p>}
          </>
        )}
      </div>
    </div>
  );
}
