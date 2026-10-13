'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, Loader2, Printer, ShieldCheck, Wifi } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { eposErrorLabel, isEpsonMaker, isLocalPrinterHost, printerCertUrl } from '@/lib/direct-print';
import { setDevicePrinter } from '@/app/app/pos/device-printer-actions';
import { postDirect, readDirectPrintConfig, sendToEposPrinter, writeDirectPrintConfig } from '@/components/printing/direct-print-client';

export interface DevicePrinterOption {
  id: string;
  name: string;
  maker: string | null;
  usage: string;
  billSlips: boolean;
  ip: string | null;
}

const USAGE_LABEL: Record<string, string> = { receipt: 'レシート', kitchen: '厨房', label: 'ラベル' };

/**
 * このiPadのプリンター（レジの設定。2026-10-13 Ronnie「Airレジのように、プリンターを選んで、すぐ・速く印刷。EPSON を Wi-Fi で」）。
 *   1. このiPadのレシートを出すプリンターを選ぶ（この端末だけ。店の設定は変えない）
 *   2. EPSON は「Wi-Fi で直接印刷」を ON にすると、この iPad からお店の Wi-Fi でプリンターへ直接送る（速い）。
 *      つながらないときは今まで通りプリンター自身の印刷（Server Direct Print）に任せる。
 */
export function DevicePrinterPanel({ printers, selectedId }: { printers: DevicePrinterOption[]; selectedId: string | null }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<string | null>(selectedId);
  const [pending, startTransition] = useTransition();
  const [direct, setDirect] = useState<string[]>([]);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setDirect(readDirectPrintConfig().printerIds);
    sync();
    window.addEventListener('tenpo-direct-print-changed', sync);
    return () => window.removeEventListener('tenpo-direct-print-changed', sync);
  }, []);

  const receiptPrinters = printers.filter((p) => p.usage === 'receipt' || p.billSlips);
  const epsonPrinters = printers.filter((p) => isEpsonMaker(p.maker));

  const choose = (id: string | null) => {
    const prev = selected;
    setSelected(id);
    startTransition(async () => {
      const res = await setDevicePrinter(id);
      if (!res.ok) {
        setSelected(prev);
        toast(res.error, 'error');
        return;
      }
      const name = printers.find((p) => p.id === id)?.name;
      toast(name ? `このiPadのレシートは「${name}」に出ます` : 'このiPadのレシートは店の既定のプリンターに出ます');
    });
  };

  const toggleDirect = (id: string) => {
    const next = direct.includes(id) ? direct.filter((x) => x !== id) : [...direct, id];
    if (!writeDirectPrintConfig({ printerIds: next })) {
      toast('このiPadに保存できませんでした（プライベートブラウズを切ってください）', 'error');
      return;
    }
    setDirect(next);
    toast(next.includes(id) ? 'Wi-Fi で直接印刷を ON にしました（このiPadだけ）' : 'Wi-Fi で直接印刷を OFF にしました');
  };

  const test = async (p: DevicePrinterOption, kind: 'receipt' | 'drawer') => {
    setTesting(`${p.id}:${kind}`);
    try {
      const res = await postDirect<{ ok: boolean; host?: string; soap?: string; error?: string }>({
        action: 'test',
        printerId: p.id,
        kind,
      });
      if (!res?.ok || !res.host || !res.soap) {
        toast(res?.error ?? '試し印刷のデータを作れませんでした', 'error');
        return;
      }
      const sent = await sendToEposPrinter(res.host, res.soap);
      if (sent.kind === 'printed') toast(kind === 'drawer' ? 'ドロアが開きました（Wi-Fi 直接）' : '印刷できました（Wi-Fi 直接）');
      else if (sent.kind === 'unreachable')
        toast('つながりません。同じ Wi-Fi か、「① 証明書を許可」を済ませたか確かめてください', 'error');
      else if (sent.kind === 'timeout') toast('プリンターの返事がありません', 'error');
      else toast(eposErrorLabel(sent.code), 'error');
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            <Printer className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-bold text-navy">このiPadのレシートプリンター</p>
              <p className="text-xs text-gray-500">
                レシート・領収書・会計伝票・ドロア・レジ精算をどのプリンターに出すか、このiPadだけで選びます（店の設定は変わりません）
              </p>
            </div>
          </div>
          {receiptPrinters.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
              レシート用のプリンターがありません。管理画面（パソコン）の 設定 &gt; レジ・プリンター で追加してください
            </p>
          ) : (
            <div role="radiogroup" aria-label="このiPadのレシートプリンター" className="grid gap-2 sm:grid-cols-2">
              <Choice label="おまかせ（店の既定）" sub="今まで通り" on={selected === null} disabled={pending} onClick={() => choose(null)} />
              {receiptPrinters.map((p) => (
                <Choice
                  key={p.id}
                  label={p.name}
                  sub={`${p.maker ?? 'メーカー未設定'}・${USAGE_LABEL[p.usage] ?? p.usage}${p.ip ? `・${p.ip}` : ''}`}
                  on={selected === p.id}
                  disabled={pending}
                  onClick={() => choose(p.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {epsonPrinters.length > 0 && (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <Wifi className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-bold text-navy">Wi-Fi で直接印刷（EPSON・速い）</p>
                <p className="text-xs text-gray-500">
                  ON にすると、このiPadからお店の Wi-Fi でプリンターへ直接送ります（約1秒）。iPad の画面を閉じているときや、
                  つながらないときは、今まで通りプリンター自身が印刷します
                </p>
              </div>
            </div>
            <ol className="list-decimal space-y-0.5 rounded-lg bg-gray-50 py-2 pr-3 pl-7 text-xs text-gray-600">
              <li>iPad とプリンターを同じ Wi-Fi（お店のネットワーク）につなぐ</li>
              <li>「① 証明書を許可」を押し、開いた画面で「詳細を表示」→「このWebサイトを閲覧」（最初の1回だけ）</li>
              <li>「② 試し印刷」で紙が出たら、「このiPadから直接印刷」を ON</li>
            </ol>
            <ul className="divide-y divide-gray-100">
              {epsonPrinters.map((p) => {
                const ready = isLocalPrinterHost(p.ip);
                const on = direct.includes(p.id);
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{p.name}</p>
                      <p className="text-xs text-gray-500">
                        {USAGE_LABEL[p.usage] ?? p.usage}・
                        {ready ? p.ip : 'IPアドレスが未入力（管理画面 > 設定 > レジ・プリンター で入れてください）'}
                      </p>
                    </div>
                    {ready && (
                      <>
                        <a
                          href={printerCertUrl(p.ip!)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-ink hover:bg-gray-50"
                        >
                          <ShieldCheck className="h-4 w-4" aria-hidden />① 証明書を許可
                        </a>
                        <button
                          type="button"
                          disabled={testing !== null}
                          onClick={() => void test(p, 'receipt')}
                          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-60"
                        >
                          {testing === `${p.id}:receipt` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}② 試し印刷
                        </button>
                        {p.usage === 'receipt' && (
                          <button
                            type="button"
                            disabled={testing !== null}
                            onClick={() => void test(p, 'drawer')}
                            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-60"
                          >
                            {testing === `${p.id}:drawer` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}ドロア
                          </button>
                        )}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          onClick={() => toggleDirect(p.id)}
                          className={cn(
                            'inline-flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold',
                            on ? 'bg-primary text-white' : 'border border-gray-200 bg-white text-gray-600'
                          )}
                        >
                          <span
                            className={cn('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-white/40' : 'bg-gray-200')}
                            aria-hidden
                          >
                            <span
                              className={cn(
                                'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                                on ? 'left-[18px]' : 'left-0.5'
                              )}
                            />
                          </span>
                          このiPadから直接印刷
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Choice({
  label,
  sub,
  on,
  disabled,
  onClick,
}: {
  label: string;
  sub: string;
  on: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-xl border px-4 py-2 text-left disabled:opacity-60',
        on ? 'border-primary bg-primary-soft' : 'border-gray-200 bg-white hover:bg-gray-50'
      )}
    >
      <span
        className={cn(
          'grid h-5 w-5 shrink-0 place-items-center rounded-full border',
          on ? 'border-primary bg-primary text-white' : 'border-gray-300'
        )}
        aria-hidden
      >
        {on && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-bold text-ink">{label}</span>
        <span className="truncate text-xs text-gray-500">{sub}</span>
      </span>
    </button>
  );
}
