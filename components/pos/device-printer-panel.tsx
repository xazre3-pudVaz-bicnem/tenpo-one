'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bluetooth, Cable, Check, Loader2, Printer, Search, ShieldCheck, Wifi } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  BT_MAKER_LABEL,
  eposErrorLabel,
  isEpsonMaker,
  isLikelyPrinter,
  isLocalPrinterHost,
  parseLanTarget,
  printerCertUrl,
  printerDeliveryOf,
  type BluetoothLink,
} from '@/lib/direct-print';
import { nativeBluetooth, nativeLan, type NativeBluetoothDevice } from '@/lib/native-app';
import { addDeviceReceiptPrinter, saveDeviceReceiptPrinterSettings, setDevicePrinter } from '@/app/app/pos/device-printer-actions';
import {
  PRINTER_MAKER_LABEL,
  PRINTER_MAKER_ORDER,
  PRINTER_MODELS,
  AGENT_PRINTER_MODELS,
  deviceMatchesModel,
  discoverKindOf,
  printerModelById,
  printerModelOf,
  type PrinterModel,
} from '@/lib/printer-models';
import { postDirect, readDirectPrintConfig, sendToEposPrinter, writeDirectPrintConfig } from '@/components/printing/direct-print-client';
import { buildSiiAgentPrint, openSiiAgent } from '@/components/printing/sii-agent-client';
import { SII_AGENT_APP_STORE_URL, SII_AGENT_DEVICE_ID } from '@/lib/sii-url-print';
import { printTimingLabel } from '@/lib/print-timing';

export interface DevicePrinterOption {
  id: string;
  name: string;
  maker: string | null;
  usage: string;
  billSlips: boolean;
  ip: string | null;
  /** 印刷を受ける状態か（管理画面で Bluetooth・USB として足しただけのものは、iPad でつなぐまで false） */
  enabled: boolean;
  /** つなぎ方（'bluetooth' / 'usb' / 'lan' / 'wifi' / 'browser'） */
  connection: string | null;
  /** 機種（mC-Print3・TM-m30III など） */
  model?: string | null;
  paperWidthMm?: 58 | 80;
  autoPrint?: boolean;
  drawerKick?: boolean;
}

const isDeviceLink = (p: DevicePrinterOption) => p.connection === 'bluetooth' || p.connection === 'usb';

const USAGE_LABEL: Record<string, string> = { receipt: 'レシート', kitchen: '厨房', label: 'ラベル' };

/**
 * このiPadのプリンター（レジの設定。2026-10-13 Ronnie「Airレジのように、プリンターを選んで、すぐ・速く印刷。EPSON を Wi-Fi で」）。
 *   1. このiPadのレシートを出すプリンターを選ぶ（この端末だけ。店の設定は変えない）
 *   2. EPSON は「Wi-Fi で直接印刷」を ON にすると、この iPad からお店の Wi-Fi でプリンターへ直接送る（速い）。
 *      つながらないときは今まで通りプリンター自身の印刷（Server Direct Print）に任せる。
 */
export function DevicePrinterPanel({
  printers,
  selectedId,
  canAdd = false,
}: {
  printers: DevicePrinterOption[];
  selectedId: string | null;
  /** この iPad から Bluetooth・USB のレシートプリンターを追加できるか（店長以上） */
  canAdd?: boolean;
}) {
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

  // 出し先に選べるのは Wi-Fi・LAN のプリンター（＋いま選んでいるこのiPadの Bluetooth のプリンター）。
  // ほかの iPad とつないだ Bluetooth のプリンターは出さない
  const receiptPrinters = printers.filter(
    (p) => p.enabled && (p.usage === 'receipt' || p.billSlips) && (!isDeviceLink(p) || p.id === selected)
  );
  // Wi-Fi で直接印刷は Wi-Fi・LAN の EPSON だけ（iPad と Bluetooth・USB でつなぐものは下の Bluetooth のカード）
  const epsonPrinters = printers.filter((p) => p.enabled && isEpsonMaker(p.maker) && !isDeviceLink(p));
  // iPad とつなぐレシート機：印刷を受けるもの＋管理画面で Bluetooth・USB として足しただけのもの
  const bluetoothPrinters = printers.filter((p) => p.usage === 'receipt' && (p.enabled || isDeviceLink(p)));

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
    if (!writeDirectPrintConfig({ ...readDirectPrintConfig(), printerIds: next })) {
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
      <BluetoothPrinterForm printers={bluetoothPrinters} canAdd={canAdd} onSelected={(id) => setSelected(id)} />

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            <Printer className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-bold text-navy">レシートの出し先</p>
              <p className="text-xs text-gray-500">
                レシート・領収書・会計伝票・ドロア・レジ精算をどのプリンターに出すか、このiPadだけで選びます（店の設定は変わりません）。
                上の Bluetooth のプリンターをつなぐと、そのプリンターになります
              </p>
            </div>
          </div>
          {receiptPrinters.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
              {canAdd
                ? 'Wi-Fi・LAN のレシートプリンターはありません。iPad の「TENPO ONE」アプリでは上の「プリンター」（Bluetooth）、パソコンでは 設定 > レジ・プリンター で追加できます'
                : 'レシート用のプリンターがありません。管理画面（パソコン）の 設定 > レジ・プリンター で追加してください'}
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



      <LanPrintersCard printers={printers} />

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

/**
 * LAN（有線・Wi-Fi）のプリンターへ、この iPad（TENPO ONE アプリ）から送る（2026-10-16 Ronnie「EPSON と SII RP-F10 を LAN で。
 * どの店でも選べるように」）。SII RP-F10 は自分から印刷を取りに来られないので、レジの iPad が送る。
 * EPSON は Server Direct Print（プリンター自身）でも出るが、その機能が無い機種はこれで送る。厨房・ドリンクの伝票も。
 */
function LanPrintersCard({ printers }: { printers: DevicePrinterOption[] }) {
  const { toast } = useToast();
  const [inApp, setInApp] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setInApp(nativeLan() !== null);
      setIds(readDirectPrintConfig().lan ?? []);
    };
    sync();
    window.addEventListener('tenpo-direct-print-changed', sync);
    return () => window.removeEventListener('tenpo-direct-print-changed', sync);
  }, []);

  const list = printers.filter((p) => {
    if (!p.enabled || (p.connection !== 'lan' && p.connection !== 'wifi')) return false;
    const d = printerDeliveryOf({ maker: p.maker, connection: p.connection });
    return d === 'sdp' || d === 'ipad-lan';
  });
  if (list.length === 0) return null;

  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    if (!writeDirectPrintConfig({ ...readDirectPrintConfig(), lan: next })) {
      toast('このiPadに保存できませんでした', 'error');
      return;
    }
    setIds(next);
    toast(next.includes(id) ? 'この iPad から LAN で送ります（この iPad だけ）' : 'この iPad から LAN で送るのをやめました');
  };

  const test = async (p: DevicePrinterOption, kind: 'receipt' | 'drawer') => {
    const lan = nativeLan();
    if (!lan) return;
    setTesting(`${p.id}:${kind}`);
    try {
      const res = await postDirect<{ ok: boolean; host?: string; port?: number; data?: string; error?: string }>({
        action: 'test-lan',
        printerId: p.id,
        kind,
      });
      if (!res?.ok || !res.host || !res.data) {
        toast(res?.error ?? '試し印刷のデータを作れませんでした', 'error');
        return;
      }
      const sent = await lan.print({ host: res.host, port: res.port, data: res.data });
      if (sent.ok) toast(kind === 'drawer' ? 'ドロアを開きました（LAN）' : '送りました（LAN）。紙が出たか確かめてください');
      else if (sent.code === 'timeout_sent') toast('プリンターの返事がありません。紙が出たか確かめてください', 'error');
      else toast('つながりません。プリンターの電源・LAN ケーブル・IPアドレス、iPad が同じネットワークか確かめてください', 'error');
    } finally {
      setTesting(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <Cable className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-bold text-navy">LAN のプリンター（EPSON・SII RP-F10 など）</p>
            <p className="text-xs text-gray-500">
              この iPad から、お店の LAN（有線・Wi-Fi）でプリンターへ送ります。レシートも厨房・ドリンクの伝票も出ます。
              SII RP-F10 は自分から印刷を取りに来られないので、この方法で出します（レジの iPad は TENPO ONE アプリを開いたままに）
            </p>
          </div>
        </div>
        {!inApp && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            iPad の「TENPO ONE」アプリで使えます（Safari では使えません）。Safari の iPad では、EPSON はプリンター自身（Server Direct Print）で、
            SII RP-F10 のレシートは上の「SII URL Print Agent」で出せます
          </p>
        )}
        <ul className="divide-y divide-gray-100">
          {list.map((p) => {
            const target = parseLanTarget(p.ip);
            const on = ids.includes(p.id);
            const needsIpad = printerDeliveryOf({ maker: p.maker, connection: p.connection }) === 'ipad-lan';
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {p.name}
                    {p.model ? <span className="ml-1 text-xs font-normal text-gray-500">{p.model}</span> : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {p.maker ?? 'メーカー未設定'}・{USAGE_LABEL[p.usage] ?? p.usage}・
                    {target ? `${target.host}${target.port !== 9100 ? `:${target.port}` : ''}` : 'IPアドレスが未入力（管理画面 > 設定 > レジ・プリンター で入れてください）'}
                  </p>
                  <p className={cn('text-xs', needsIpad ? 'font-semibold text-primary' : 'text-gray-400')}>
                    {needsIpad ? 'どれか1台の iPad で「このiPadから送る」を ON にしてください' : 'プリンター自身（Server Direct Print）でも出ます'}
                  </p>
                </div>
                {inApp && target && (
                  <>
                    <button
                      type="button"
                      disabled={testing !== null}
                      onClick={() => void test(p, 'receipt')}
                      className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-60"
                    >
                      {testing === `${p.id}:receipt` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}試し印刷
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
                      onClick={() => toggle(p.id)}
                      className={cn(
                        'inline-flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold',
                        on ? 'bg-primary text-white' : 'border border-gray-200 bg-white text-gray-600'
                      )}
                    >
                      <span className={cn('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-white/40' : 'bg-gray-200')} aria-hidden>
                        <span
                          className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')}
                        />
                      </span>
                      このiPadから送る
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
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


/** 保存してある機種名・メーカー名から、フォームの機種を決める（分からなければメーカーの代表機種） */
function initialModelOf(p: DevicePrinterOption | null): PrinterModel | null {
  if (!p) return null;
  const byName = printerModelOf(p.model);
  if (byName) return byName;
  const maker = (p.maker ?? '').toLowerCase();
  if (maker.includes('star')) return printerModelById('star-mcp31');
  if (maker.includes('epson')) return printerModelById('epson-tm-m30iii');
  return printerModelById(p.paperWidthMm === 58 ? 'escpos-ble-58' : 'escpos-ble-80');
}

/**
 * このiPadのプリンター（Bluetooth）。Airレジの「レジ・プリンター」と同じ並び：
 *   プリンター利用・プリンター（機種）・接続（探す）・レシート紙幅・会計レシート自動印刷・キャッシュドロア利用・試し印刷・保存する
 * 2026-10-14 Ronnie「プリンター選択がいる。日本で人気の Bluetooth のプリンター（Star・EPSON・Brother など）を全部」
 * TENPO ONE レジ アプリの中だけ（Safari では Bluetooth を使えない）。
 */
function BluetoothPrinterForm({
  printers,
  canAdd,
  onSelected,
}: {
  /** この店の iPad とつなぐレシートプリンター（Bluetooth・USB）と、印刷を受けるレシート機 */
  printers: DevicePrinterOption[];
  canAdd: boolean;
  /** このiPadのレシートの出し先が変わった（null＝おまかせ） */
  onSelected: (printerId: string | null) => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [inApp, setInApp] = useState(false);
  const [links, setLinks] = useState<BluetoothLink[]>([]);

  useEffect(() => {
    const sync = () => {
      setInApp(nativeBluetooth() !== null);
      setLinks(readDirectPrintConfig().bluetooth ?? []);
    };
    sync();
    window.addEventListener('tenpo-direct-print-changed', sync);
    return () => window.removeEventListener('tenpo-direct-print-changed', sync);
  }, []);

  // このiPadとつないでいるプリンター（1台）
  const link = links.find((l) => printers.some((p) => p.id === l.printerId)) ?? null;
  const linked = link ? (printers.find((p) => p.id === link.printerId) ?? null) : null;

  const [use, setUse] = useState(false);
  const [modelId, setModelId] = useState('');
  const [paper, setPaper] = useState<58 | 80>(80);
  const [autoPrint, setAutoPrint] = useState(false);
  const [drawer, setDrawer] = useState(true);
  const [found, setFound] = useState<NativeBluetoothDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // つないでいるプリンターの設定をフォームに入れる（読み込み・つなぎ直したとき）
  const linkedKey = linked ? `${linked.id}:${linked.model ?? ''}:${linked.paperWidthMm}:${linked.autoPrint}:${linked.drawerKick}` : '';
  useEffect(() => {
    if (!linked) return;
    const m = initialModelOf(linked);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUse(true);
    setModelId(m?.id ?? '');
    setPaper(linked.paperWidthMm === 58 ? 58 : 80);
    setAutoPrint(linked.autoPrint === true);
    setDrawer(linked.drawerKick !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedKey]);

  const model = printerModelById(modelId);

  const saveLinks = (next: BluetoothLink[]) => {
    if (!writeDirectPrintConfig({ ...readDirectPrintConfig(), bluetooth: next })) {
      toast('このiPadに保存できませんでした', 'error');
      return false;
    }
    setLinks(next);
    return true;
  };

  const chooseModel = (id: string) => {
    const m = printerModelById(id);
    setModelId(id);
    setFound(null);
    if (m) {
      setPaper(m.paper);
      setDrawer(m.drawer);
    }
  };

  const toggleUse = async () => {
    if (!use) {
      setUse(true);
      return;
    }
    // 使わない：このiPadとのつながりを外し、レシートは店の既定（おまかせ）に。店のプリンターの設定は消さない
    setBusy('use');
    try {
      if (link && !saveLinks(links.filter((l) => l.printerId !== link.printerId))) return;
      const res = await setDevicePrinter(null);
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      setUse(false);
      setFound(null);
      onSelected(null);
      router.refresh();
      toast('このiPadのプリンターを使わない設定にしました（レシートは店の既定のプリンター）');
    } finally {
      setBusy(null);
    }
  };

  const search = async () => {
    const bt = nativeBluetooth();
    if (!bt || !model) return;
    setBusy('search');
    setFound(null);
    try {
      const res = await bt.discover(discoverKindOf(model));
      // 選んだメーカーのプリンターだけ（テレビ・イヤホン・パソコンなどは出さない）
      const devices = (res.devices ?? []).filter((d) => deviceMatchesModel(model, d) && isLikelyPrinter(d));
      if (!res.ok || devices.length === 0) {
        toast(
          model.maker === 'escpos'
            ? '見つかりません。プリンターの電源を入れ、iPad の近くでもう一度押してください'
            : '見つかりません。プリンターの電源を入れ、iPad の 設定 > Bluetooth でプリンターをペアリングしてから、もう一度押してください',
          'error'
        );
        return;
      }
      setFound(devices);
    } finally {
      setBusy(null);
    }
  };

  const connect = async (d: NativeBluetoothDevice) => {
    if (!model) return;
    setBusy(`connect:${d.deviceId}`);
    try {
      const res = await addDeviceReceiptPrinter({
        printerId: linked?.id ?? null,
        name: d.name,
        maker: d.maker,
        via: d.via ?? 'bluetooth',
        modelId: model.id,
        paperWidthMm: paper,
        autoPrint,
        drawerKick: drawer,
      });
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      const next: BluetoothLink[] = [
        ...links.filter((l) => l.printerId !== res.printer.id && l.printerId !== linked?.id && l.deviceId !== d.deviceId),
        { printerId: res.printer.id, deviceId: d.deviceId, deviceName: d.name, maker: d.maker, via: d.via ?? 'bluetooth' },
      ];
      if (!saveLinks(next)) return;
      setFound(null);
      onSelected(res.printer.id);
      router.refresh();
      toast(`「${d.name}」とつなぎました。「試し印刷」で確かめてください`);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!linked) {
      toast('先に「プリンターを探す」でプリンターとつないでください', 'error');
      return;
    }
    setBusy('save');
    try {
      const res = await saveDeviceReceiptPrinterSettings({
        printerId: linked.id,
        modelId: model?.id ?? null,
        paperWidthMm: paper,
        autoPrint,
        drawerKick: drawer,
      });
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      router.refresh();
      toast('保存しました');
    } finally {
      setBusy(null);
    }
  };

  const test = async (kind: 'receipt' | 'drawer') => {
    const bt = nativeBluetooth();
    if (!bt || !link) return;
    setBusy(kind);
    const startedAt = performance.now();
    try {
      const res = await postDirect<{ ok: boolean; data?: string; error?: string }>({ action: 'test-bt', printerId: link.printerId, kind });
      if (!res?.ok || !res.data) {
        toast(res?.error ?? '試し印刷のデータを作れませんでした', 'error');
        return;
      }
      const preparedAt = performance.now();
      const sent = await bt.print({ deviceId: link.deviceId, maker: link.maker, via: link.via === 'usb' ? 'usb' : 'bluetooth', data: res.data });
      if (sent.ok) toast(`${kind === 'drawer' ? 'ドロアが開きました' : '印刷できました'}（${printTimingLabel(startedAt, preparedAt, performance.now())}）`);
      else toast(`つながりません（${sent.code ?? 'エラー'}）。プリンターの電源と iPad の Bluetooth を確かめてください`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const off = !use;
  const locked = !canAdd;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-start gap-2 border-b border-gray-100 px-5 py-4">
          <Bluetooth className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-base font-bold text-navy">
              このiPadのプリンター（Bluetooth）
              <span className="ml-1.5 text-xs font-normal text-gray-400">Receipt printer</span>
            </p>
            <p className="text-sm text-gray-500">レシートプリンターとドロアは iPad と Bluetooth でつなぎます（厨房・ドリンクのプリンターは LAN・Wi-Fi）</p>
          </div>
        </div>

        {!inApp ? (
          <SiiAgentForm printers={printers} canAdd={canAdd} onSelected={onSelected} />
        ) : (
          <div className="divide-y divide-gray-100">
            <Row label="プリンター利用" en="Use printer">
              <Switch on={use} disabled={busy !== null || locked} onClick={() => void toggleUse()} label="プリンター利用" />
            </Row>

            <Row label="プリンター" en="Printer model" dim={off}>
              <div className="w-full max-w-xl space-y-2">
                <select
                  value={modelId}
                  disabled={off || locked || busy !== null}
                  onChange={(e) => chooseModel(e.target.value)}
                  className="h-14 w-full rounded-xl border border-gray-200 bg-white px-4 text-base text-ink disabled:bg-gray-50 disabled:text-gray-400"
                  aria-label="プリンターの機種"
                >
                  <option value="">選択してください</option>
                  {PRINTER_MAKER_ORDER.map((maker) => (
                    <optgroup key={maker} label={PRINTER_MAKER_LABEL[maker]}>
                      {PRINTER_MODELS.filter((m) => m.maker === maker).map((m) => (
                        <option key={m.id} value={m.id} disabled={!m.ready}>
                          {m.name}
                          {m.mobile ? '（モバイル）' : ''}
                          {m.ready ? '' : '（準備中）'}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-sm text-gray-500">
                  使えるのは Star・EPSON（Bluetooth）とそのほかの ESC/POS（Bluetooth LE）。SII・Citizen・Brother は準備中です
                </p>
              </div>
            </Row>

            <Row label="接続" en="Connection" dim={off}>
              <div className="w-full max-w-xl space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 text-base text-ink">
                    {link ? (
                      <>
                        <span className="font-bold">{link.deviceName || link.deviceId}</span>
                        <span className="ml-1 text-sm text-gray-500">（{link.via === 'usb' ? 'USB' : 'Bluetooth'}・つないでいます）</span>
                      </>
                    ) : (
                      <span className="text-gray-500">まだつないでいません</span>
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={off || locked || !model || busy !== null}
                    onClick={() => void search()}
                    className="inline-flex h-14 items-center gap-2 rounded-xl border border-primary/40 bg-white px-5 text-base font-bold text-primary hover:bg-primary-soft/40 disabled:opacity-50"
                  >
                    {busy === 'search' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Search className="h-5 w-5" aria-hidden />}
                    {link ? 'つなぎ直す' : 'プリンターを探す'}
                  </button>
                </div>
                {!model && use && <p className="text-sm text-gray-500">先に「プリンター」で機種を選んでください</p>}
                {found && (
                  <div className="rounded-xl border border-primary/30 bg-primary-soft/40 p-3">
                    <p className="px-1 pb-2 text-sm text-gray-600">見つかったプリンター（押すとつなぎます）</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {found.map((d) => (
                        <button
                          key={d.deviceId}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void connect(d)}
                          className="flex min-h-16 flex-col items-start justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-left hover:border-primary disabled:opacity-60"
                        >
                          <span className="flex items-center gap-1.5 text-base font-bold text-ink">
                            {busy === `connect:${d.deviceId}` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                            {d.name}
                          </span>
                          <span className="text-sm text-gray-500">
                            {BT_MAKER_LABEL[d.maker]}・{d.via === 'usb' ? 'USB' : 'Bluetooth'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Row>

            <Row label="レシート紙幅" en="Paper width" dim={off}>
              <div className="flex gap-3" role="radiogroup" aria-label="レシート紙幅">
                {([58, 80] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={paper === w}
                    disabled={off || locked}
                    onClick={() => setPaper(w)}
                    className={cn(
                      'inline-flex h-12 min-w-24 items-center justify-center gap-2 rounded-full border px-5 text-base font-bold disabled:opacity-50',
                      paper === w ? 'border-primary bg-primary-soft text-primary' : 'border-gray-200 bg-white text-gray-600'
                    )}
                  >
                    <span className={cn('h-4 w-4 rounded-full border', paper === w ? 'border-4 border-primary' : 'border-gray-300')} aria-hidden />
                    {w}mm
                  </button>
                ))}
              </div>
            </Row>

            <Row label="会計レシート自動印刷" en="Print receipt after checkout" dim={off}>
              <Switch on={autoPrint} disabled={off || locked} onClick={() => setAutoPrint((v) => !v)} label="会計レシート自動印刷" />
            </Row>

            <Row label="キャッシュドロア利用" en="Cash drawer" dim={off}>
              <Switch on={drawer} disabled={off || locked} onClick={() => setDrawer((v) => !v)} label="キャッシュドロア利用" />
            </Row>

            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <button
                type="button"
                disabled={off || !link || busy !== null}
                onClick={() => void test('receipt')}
                className="inline-flex h-14 items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 text-base font-bold text-ink hover:bg-gray-50 disabled:opacity-50"
              >
                {busy === 'receipt' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
                試し印刷
              </button>
              <button
                type="button"
                disabled={off || !link || !drawer || busy !== null}
                onClick={() => void test('drawer')}
                className="inline-flex h-14 items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 text-base font-bold text-ink hover:bg-gray-50 disabled:opacity-50"
              >
                {busy === 'drawer' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
                ドロアを開く
              </button>
              <span className="flex-1" />
              {locked && <span className="text-sm text-gray-500">プリンターの設定は店長以上のアカウントで変えられます</span>}
              <button
                type="button"
                disabled={off || locked || !link || busy !== null}
                onClick={() => void save()}
                className="inline-flex h-14 min-w-40 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy === 'save' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
                保存する
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Safari で使う SII（セイコー）の Bluetooth プリンター（RP-F10 など）。SII の無料アプリ「SII URL Print Agent」を通す
 * （lib/sii-url-print.ts。2026-10-14 Ronnie「MEAT CROWN 新横浜の Airレジの SII RP-F10 を Bluetooth で。アプリはまだ無いので Safari でも」）。
 * 並びは Airレジ と同じ：プリンター利用・プリンター・接続・レシート紙幅・会計レシート自動印刷・キャッシュドロア利用・試し印刷・保存する
 */
function SiiAgentForm({
  printers,
  canAdd,
  onSelected,
}: {
  printers: DevicePrinterOption[];
  canAdd: boolean;
  onSelected: (printerId: string | null) => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [links, setLinks] = useState<BluetoothLink[]>([]);

  useEffect(() => {
    const sync = () => setLinks(readDirectPrintConfig().bluetooth ?? []);
    sync();
    window.addEventListener('tenpo-direct-print-changed', sync);
    return () => window.removeEventListener('tenpo-direct-print-changed', sync);
  }, []);

  const link = links.find((l) => l.via === 'agent' && printers.some((p) => p.id === l.printerId)) ?? null;
  const linked = link ? (printers.find((p) => p.id === link.printerId) ?? null) : null;

  const [use, setUse] = useState(false);
  const [modelId, setModelId] = useState(AGENT_PRINTER_MODELS[0]?.id ?? '');
  const [paper, setPaper] = useState<58 | 80>(80);
  const [autoPrint, setAutoPrint] = useState(false);
  const [drawer, setDrawer] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const linkedKey = linked ? `${linked.id}:${linked.model ?? ''}:${linked.paperWidthMm}:${linked.autoPrint}:${linked.drawerKick}` : '';
  useEffect(() => {
    if (!linked) return;
    const m = printerModelOf(linked.model);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUse(true);
    if (m?.agent) setModelId(m.id);
    setPaper(linked.paperWidthMm === 58 ? 58 : 80);
    setAutoPrint(linked.autoPrint === true);
    setDrawer(linked.drawerKick !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedKey]);

  const model = printerModelById(modelId);
  const off = !use;
  const locked = !canAdd;

  const saveLinks = (next: BluetoothLink[]) => {
    if (!writeDirectPrintConfig({ ...readDirectPrintConfig(), bluetooth: next })) {
      toast('このiPadに保存できませんでした（プライベートブラウズを切ってください）', 'error');
      return false;
    }
    setLinks(next);
    return true;
  };

  const toggleUse = async () => {
    if (!use) {
      setUse(true);
      return;
    }
    setBusy('use');
    try {
      if (link && !saveLinks(links.filter((l) => l.printerId !== link.printerId))) return;
      const res = await setDevicePrinter(null);
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      setUse(false);
      onSelected(null);
      router.refresh();
      toast('このiPadのプリンターを使わない設定にしました（レシートは店の既定のプリンター）');
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    if (!model) return;
    setBusy('connect');
    try {
      const res = await addDeviceReceiptPrinter({
        printerId: linked?.id ?? null,
        name: model.name,
        maker: 'sii',
        via: 'agent',
        modelId: model.id,
        paperWidthMm: paper,
        autoPrint,
        drawerKick: drawer,
      });
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      const next: BluetoothLink[] = [
        ...links.filter((l) => l.printerId !== res.printer.id && l.printerId !== linked?.id && l.deviceId !== SII_AGENT_DEVICE_ID),
        { printerId: res.printer.id, deviceId: SII_AGENT_DEVICE_ID, deviceName: 'SII URL Print Agent', maker: 'sii', via: 'agent' },
      ];
      if (!saveLinks(next)) return;
      onSelected(res.printer.id);
      router.refresh();
      toast(`「${res.printer.name}」をこのiPadのレシートプリンターにしました。「試し印刷」で確かめてください`);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!linked) return;
    setBusy('save');
    try {
      const res = await saveDeviceReceiptPrinterSettings({
        printerId: linked.id,
        modelId: model?.id ?? null,
        paperWidthMm: paper,
        autoPrint,
        drawerKick: drawer,
      });
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      router.refresh();
      toast('保存しました');
    } finally {
      setBusy(null);
    }
  };

  const test = async (kind: 'receipt' | 'drawer') => {
    if (!link) return;
    setBusy(kind);
    try {
      const res = await postDirect<{ ok: boolean; epos?: string; paper?: number; error?: string }>({
        action: 'test-bt',
        printerId: link.printerId,
        kind,
        format: 'epos',
      });
      if (!res?.ok || !res.epos) {
        toast(res?.error ?? '試し印刷のデータを作れませんでした', 'error');
        return;
      }
      const print = await buildSiiAgentPrint(res.epos, res.paper === 58 ? 58 : 80, { drawerAllowed: true });
      openSiiAgent(print.url);
    } catch {
      toast('試し印刷のデータを作れませんでした', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="divide-y divide-gray-100">
      <div className="space-y-2 px-5 py-4">
        <p className="text-base text-ink">
          Safari では、<span className="font-bold">SII（セイコー）のプリンター</span>を SII の無料アプリ「SII URL Print Agent」を通して使えます。
          <span className="text-gray-500">（Star・EPSON などは iPad の「TENPO ONE」アプリで使えます）</span>
        </p>
        <ol className="list-decimal space-y-1 rounded-lg bg-gray-50 py-3 pr-4 pl-8 text-sm text-gray-600">
          <li>
            App Store で
            <a href={SII_AGENT_APP_STORE_URL} target="_blank" rel="noreferrer" className="mx-1 font-bold text-primary underline">
              SII URL Print Agent
            </a>
            を入れる（無料）
          </li>
          <li>
            Bluetooth：プリンターの電源を切り、電源ボタンを 7 秒押し続ける（ランプが点滅）→ iPad の 設定 &gt; Bluetooth で「RP-F10」を押す
            <br />
            有線LAN：プリンターを LAN ケーブルでお店のルーターにつなぐ（iPad と同じネットワーク）
          </li>
          <li>SII URL Print Agent を開き、「PRINTER SELECT」でプリンターを選ぶ（有線LAN はプリンターの IP アドレス）</li>
          <li>下の「このiPadで使う」→「試し印刷」。Safari が「開きますか？」と聞いたら「開く」。印刷のあとは左上の「◀ Safari」で戻る</li>
        </ol>
      </div>

      <Row label="プリンター利用" en="Use printer">
        <Switch on={use} disabled={busy !== null || locked} onClick={() => void toggleUse()} label="プリンター利用" />
      </Row>

      <Row label="プリンター" en="Printer model" dim={off}>
        <select
          value={modelId}
          disabled={off || locked || busy !== null}
          onChange={(e) => {
            const m = printerModelById(e.target.value);
            setModelId(e.target.value);
            if (m) {
              setPaper(m.paper);
              setDrawer(m.drawer);
            }
          }}
          className="h-14 w-full max-w-xl rounded-xl border border-gray-200 bg-white px-4 text-base text-ink disabled:bg-gray-50 disabled:text-gray-400"
          aria-label="プリンターの機種"
        >
          {AGENT_PRINTER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              SII {m.name}
              {m.mobile ? '（モバイル）' : ''}
            </option>
          ))}
        </select>
      </Row>

      <Row label="接続" en="Connection" dim={off}>
        <div className="flex w-full max-w-xl flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-base text-ink">
            {link && linked ? (
              <>
                <span className="font-bold">{linked.name}</span>
                <span className="ml-1 text-sm text-gray-500">（SII URL Print Agent・このiPadで使っています）</span>
              </>
            ) : (
              <span className="text-gray-500">まだ使っていません</span>
            )}
          </p>
          <button
            type="button"
            disabled={off || locked || !model || busy !== null}
            onClick={() => void connect()}
            className="inline-flex h-14 items-center gap-2 rounded-xl border border-primary/40 bg-white px-5 text-base font-bold text-primary hover:bg-primary-soft/40 disabled:opacity-50"
          >
            {busy === 'connect' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Bluetooth className="h-5 w-5" aria-hidden />}
            {link ? 'もう一度つなぐ' : 'このiPadで使う'}
          </button>
        </div>
      </Row>

      <Row label="レシート紙幅" en="Paper width" dim={off}>
        <div className="flex gap-3" role="radiogroup" aria-label="レシート紙幅">
          {([58, 80] as const).map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={paper === w}
              disabled={off || locked}
              onClick={() => setPaper(w)}
              className={cn(
                'inline-flex h-12 min-w-24 items-center justify-center gap-2 rounded-full border px-5 text-base font-bold disabled:opacity-50',
                paper === w ? 'border-primary bg-primary-soft text-primary' : 'border-gray-200 bg-white text-gray-600'
              )}
            >
              <span className={cn('h-4 w-4 rounded-full border', paper === w ? 'border-4 border-primary' : 'border-gray-300')} aria-hidden />
              {w}mm
            </button>
          ))}
        </div>
      </Row>

      <Row label="会計レシート自動印刷" en="Print receipt after checkout" dim={off}>
        <Switch on={autoPrint} disabled={off || locked} onClick={() => setAutoPrint((v) => !v)} label="会計レシート自動印刷" />
      </Row>

      <Row label="キャッシュドロア利用" en="Cash drawer" dim={off}>
        <Switch on={drawer} disabled={off || locked} onClick={() => setDrawer((v) => !v)} label="キャッシュドロア利用" />
      </Row>

      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button
          type="button"
          disabled={off || !link || busy !== null}
          onClick={() => void test('receipt')}
          className="inline-flex h-14 items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 text-base font-bold text-ink hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'receipt' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
          試し印刷
        </button>
        <button
          type="button"
          disabled={off || !link || !drawer || busy !== null}
          onClick={() => void test('drawer')}
          className="inline-flex h-14 items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 text-base font-bold text-ink hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'drawer' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
          ドロアを開く
        </button>
        <span className="flex-1" />
        {locked && <span className="text-sm text-gray-500">プリンターの設定は店長以上のアカウントで変えられます</span>}
        <button
          type="button"
          disabled={off || locked || !link || busy !== null}
          onClick={() => void save()}
          className="inline-flex h-14 min-w-40 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'save' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
          保存する
        </button>
      </div>
    </div>
  );
}

/** Airレジの設定と同じ 1 行（左に項目名、右に操作） */
function Row({ label, en, dim, children }: { label: string; en: string; dim?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center', dim && 'opacity-60')}>
      <div className="sm:w-60 sm:shrink-0">
        <p className="text-base font-bold text-ink">{label}</p>
        <p className="text-xs text-gray-400">{en}</p>
      </div>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

function Switch({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('relative h-9 w-16 shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-primary' : 'bg-gray-300')}
    >
      <span className={cn('absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-all', on ? 'left-8' : 'left-1')} />
    </button>
  );
}
