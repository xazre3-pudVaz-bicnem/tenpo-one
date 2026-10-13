'use client';

import { useEffect, useState, useTransition } from 'react';
import { Bluetooth, Check, Loader2, Printer, ShieldCheck, Wifi } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  BT_MAKER_LABEL,
  bluetoothMakerOf,
  eposErrorLabel,
  isEpsonMaker,
  isLocalPrinterHost,
  printerCertUrl,
  type BluetoothLink,
} from '@/lib/direct-print';
import { nativeBluetooth, type NativeBluetoothDevice } from '@/lib/native-app';
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

      <BluetoothCard printers={receiptPrinters.filter((p) => p.usage === 'receipt')} onLinked={(id) => choose(id)} />

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

/**
 * Bluetooth のレシートプリンター（＋ドロア）。TENPO ONE レジ アプリの中だけで使える（Safari では Bluetooth を使えない）。
 * 2026-10-13 Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth。チケットプリンターは LAN・Wi-Fi。Airレジ・funfo と同じ」
 */
function BluetoothCard({ printers, onLinked }: { printers: DevicePrinterOption[]; onLinked: (printerId: string) => void }) {
  const { toast } = useToast();
  const [inApp, setInApp] = useState(false);
  const [links, setLinks] = useState<BluetoothLink[]>([]);
  const [finding, setFinding] = useState<string | null>(null);
  const [found, setFound] = useState<{ printerId: string; devices: NativeBluetoothDevice[] } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setInApp(nativeBluetooth() !== null);
      setLinks(readDirectPrintConfig().bluetooth ?? []);
    };
    sync();
    window.addEventListener('tenpo-direct-print-changed', sync);
    return () => window.removeEventListener('tenpo-direct-print-changed', sync);
  }, []);

  const save = (next: BluetoothLink[]) => {
    if (!writeDirectPrintConfig({ ...readDirectPrintConfig(), bluetooth: next })) {
      toast('このiPadに保存できませんでした', 'error');
      return false;
    }
    setLinks(next);
    return true;
  };

  const find = async (p: DevicePrinterOption) => {
    const bt = nativeBluetooth();
    const maker = bluetoothMakerOf(p.maker);
    if (!bt || !maker) return;
    // 種類が分からない（その他）ときは全部探す
    setFinding(p.id);
    setFound(null);
    try {
      const res = await bt.discover(maker === 'escpos' ? 'all' : maker);
      const devices = res.devices ?? [];
      if (!res.ok || devices.length === 0) {
        toast('見つかりません。プリンターの電源を入れ、iPad の 設定 > Bluetooth でペアリング（USB はケーブルをつなぐ）してから、もう一度押してください', 'error');
        return;
      }
      setFound({ printerId: p.id, devices });
    } finally {
      setFinding(null);
    }
  };

  const link = (p: DevicePrinterOption, d: NativeBluetoothDevice) => {
    const next: BluetoothLink[] = [
      ...links.filter((l) => l.printerId !== p.id),
      { printerId: p.id, deviceId: d.deviceId, deviceName: d.name, maker: d.maker, via: d.via ?? 'bluetooth' },
    ];
    if (!save(next)) return;
    setFound(null);
    onLinked(p.id);
    toast(`「${p.name}」を ${d.via === 'usb' ? 'USB' : 'Bluetooth'}（${d.name}）でつなぎました`);
  };

  const unlink = (p: DevicePrinterOption) => {
    if (save(links.filter((l) => l.printerId !== p.id))) toast(`「${p.name}」の Bluetooth を外しました`);
  };

  const test = async (p: DevicePrinterOption, l: BluetoothLink, kind: 'receipt' | 'drawer') => {
    const bt = nativeBluetooth();
    if (!bt) return;
    setTesting(`${p.id}:${kind}`);
    try {
      const res = await postDirect<{ ok: boolean; data?: string; error?: string }>({ action: 'test-bt', printerId: p.id, kind });
      if (!res?.ok || !res.data) {
        toast(res?.error ?? '試し印刷のデータを作れませんでした', 'error');
        return;
      }
      const sent = await bt.print({ deviceId: l.deviceId, maker: l.maker, via: l.via, data: res.data });
      if (sent.ok) toast(kind === 'drawer' ? 'ドロアが開きました' : '印刷できました');
      else toast(`つながりません（${sent.code ?? 'エラー'}）。プリンターの電源と iPad の Bluetooth を確かめてください`, 'error');
    } finally {
      setTesting(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <Bluetooth className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-bold text-navy">iPad とつなぐレシートプリンター（＋ドロア）：Bluetooth・USB</p>
            <p className="text-xs text-gray-500">
              レシートプリンターとドロアは iPad と Bluetooth・USB、厨房・ドリンクのプリンターは LAN・Wi-Fi でつなぎます
              （Star mC-Print3・EPSON・SII RP-F10・そのほかの ESC/POS）
            </p>
          </div>
        </div>
        {!inApp ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
            Bluetooth・USB は「TENPO ONE レジ」アプリで使えます（Safari では使えません）。アプリはいま準備中です
          </p>
        ) : printers.length === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
            レシートプリンターがありません。管理画面（パソコン）の 設定 &gt; レジ・プリンター で、メーカー（Star・EPSON・SII・ESC/POS）と
            つなぎ方（Bluetooth・USB）を選んで追加してください
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {printers.map((p) => {
              const l = links.find((x) => x.printerId === p.id);
              return (
                <li key={p.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{p.name}</p>
                      <p className="text-xs text-gray-500">
                        {BT_MAKER_LABEL[bluetoothMakerOf(p.maker) ?? 'escpos']}・
                        {l ? `つないでいる機械：${l.deviceName || l.deviceId}（${l.via === 'usb' ? 'USB' : 'Bluetooth'}）` : 'まだつないでいません'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={finding !== null}
                      onClick={() => void find(p)}
                      className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-60"
                    >
                      {finding === p.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      {l ? 'つなぎ直す' : 'プリンターを探す'}
                    </button>
                    {l && (
                      <>
                        <button
                          type="button"
                          disabled={testing !== null}
                          onClick={() => void test(p, l, 'receipt')}
                          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-60"
                        >
                          {testing === `${p.id}:receipt` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}試し印刷
                        </button>
                        <button
                          type="button"
                          disabled={testing !== null}
                          onClick={() => void test(p, l, 'drawer')}
                          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-60"
                        >
                          {testing === `${p.id}:drawer` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}ドロア
                        </button>
                        <button
                          type="button"
                          onClick={() => unlink(p)}
                          className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-gray-500 hover:bg-gray-50"
                        >
                          外す
                        </button>
                      </>
                    )}
                  </div>
                  {found?.printerId === p.id && (
                    <div className="rounded-lg border border-primary/30 bg-primary-soft/40 p-2">
                      <p className="px-1 pb-1 text-xs text-gray-600">見つかったプリンター（押すとつなぎます）</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {found.devices.map((d) => (
                          <button
                            key={d.deviceId}
                            type="button"
                            onClick={() => link(p, d)}
                            className="flex min-h-12 flex-col items-start justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-primary"
                          >
                            <span className="text-sm font-bold text-ink">{d.name}</span>
                            <span className="text-xs text-gray-500">
                              {BT_MAKER_LABEL[d.maker]}・{d.via === 'usb' ? 'USB' : 'Bluetooth'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
