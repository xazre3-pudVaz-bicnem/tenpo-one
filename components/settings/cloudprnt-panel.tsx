'use client';

import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Copy, Check, Printer, Inbox, RefreshCw, Loader2, Wifi, WifiOff, CircleAlert, Smartphone, ChefHat, Receipt,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  setCloudPrntConfig,
  regenerateCloudPrntToken,
  enqueueCloudPrntTest,
} from '@/app/app/settings/printers/actions';

export interface CloudPrntPrinter {
  id: string;
  name: string;
  /** メーカー名（'EPSON' / 'Star' 等）。接続方式の判定に使う。 */
  maker: string;
  model: string;
  usage: 'receipt' | 'kitchen';
  cloudprntEnabled: boolean;
  cloudprntToken: string | null;
  drawerKick: boolean;
  drawerCommand: string;
  paperWidthMm: number;
  pollIntervalSeconds: number;
  lastPolledAt: string | null;
  macAddress: string | null;
  kitchenStations: string[];
  pendingJobs: number;
}

const STATIONS: { key: string; label: string }[] = [
  { key: 'kitchen', label: 'キッチン（フード）' },
  { key: 'drink', label: 'ドリンク' },
  { key: 'grill', label: '焼き場（焼き鳥）' },
  { key: 'dessert', label: 'デザート' },
];

/**
 * メーカーごとの接続方式。
 * Star は CloudPRNT、EPSON（TM-m30III-H 等のTMインテリジェント機）は Server Direct Print で、
 * どちらも「プリンタが定期的にTENPO ONEへ問い合わせて印刷データを受け取る」同じ考え方。
 */
function makerKind(maker: string): 'epson' | 'star' {
  return /epson/i.test(maker) ? 'epson' : 'star';
}

const PROTOCOL = {
  star: { path: 'cloudprnt', label: 'CloudPRNT', urlField: 'CloudPRNT「サーバーURL」', app: 'Star Quick Setup Utility' },
  epson: {
    path: 'epson',
    label: 'Server Direct Print',
    urlField: 'Server Direct Print「サーバー1 URL」',
    app: 'Epson TM Utility',
  },
} as const;

/** 接続中とみなす最終通信からの経過（ポーリング間隔の数倍に余裕を持たせる） */
const ONLINE_WITHIN_MS = 60_000;
/** 画面を開いている間、接続状態を取り直す間隔 */
const REFRESH_MS = 10_000;

// 相対時刻の表示に使う時計。描画中に Date.now() を呼ばないよう外部ストアとして持つ。
let clockNow = 0;
function subscribeClock(onChange: () => void) {
  const tick = () => {
    clockNow = Date.now();
    onChange();
  };
  const first = setTimeout(tick, 0);
  const timer = setInterval(tick, 5_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
const getClock = () => clockNow;
const getServerClock = () => 0;

type Status = 'checking' | 'online' | 'offline' | 'never' | 'disabled';

function statusOf(p: CloudPrntPrinter, now: number): Status {
  if (!p.cloudprntEnabled) return 'disabled';
  if (!p.lastPolledAt) return 'never';
  if (now === 0) return 'checking';
  return now - new Date(p.lastPolledAt).getTime() <= ONLINE_WITHIN_MS ? 'online' : 'offline';
}

function ago(iso: string, now: number): string {
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.round(sec / 60)}分前`;
  if (sec < 86400) return `${Math.round(sec / 3600)}時間前`;
  return new Date(iso).toLocaleString('ja-JP');
}

export function CloudPrntPanel({
  storeId,
  siteUrl,
  printers,
  setupQrById,
}: {
  storeId: string;
  siteUrl: string;
  printers: CloudPrntPrinter[];
  setupQrById: Record<string, string>;
}) {
  const router = useRouter();
  const anyEnabled = printers.some((p) => p.cloudprntEnabled);

  // 画面を開いている間は接続状態を定期的に取り直す（電源を入れると「接続中」に変わるのが見える）
  useEffect(() => {
    if (!anyEnabled) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [anyEnabled, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>プリンター接続</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">
          Star mC-Print3（CloudPRNT）や EPSON TM-m30III-H（Server Direct Print）等を TENPO ONE につなぎます。レシート機は会計時のレシートとドロア開放、
          キッチン機は注文が入ると厨房伝票を<strong>自動で</strong>印刷します（レジ端末が起動していなくてもQR注文の伝票が出ます）。
          プリンタがインターネットにつながっていれば、店内LANの設定は不要です。
        </p>
        {!siteUrl && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            公開URL（環境変数 <code className="font-mono">NEXT_PUBLIC_SITE_URL</code>）が未設定のため、接続用URLを生成できません。
          </div>
        )}
        {printers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-xs text-gray-500">
            上の「プリンター」で用途「レシート」または「厨房」のプリンタを登録すると、ここで接続できます。
          </div>
        ) : (
          printers.map((p) => (
            <PrinterRow key={p.id} storeId={storeId} siteUrl={siteUrl} printer={p} setupQr={setupQrById[p.id] ?? null} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, printer, now }: { status: Status; printer: CloudPrntPrinter; now: number }) {
  switch (status) {
    case 'online':
      return (
        <Badge tone="success">
          <Wifi className="mr-1 inline h-3 w-3" />
          接続中
        </Badge>
      );
    case 'offline':
      return (
        <Badge tone="warning">
          <WifiOff className="mr-1 inline h-3 w-3" />
          オフライン（最終通信 {printer.lastPolledAt ? ago(printer.lastPolledAt, now) : '-'}）
        </Badge>
      );
    case 'never':
      return (
        <Badge tone="danger">
          <CircleAlert className="mr-1 inline h-3 w-3" />
          未接続（プリンタから一度も通信がありません）
        </Badge>
      );
    case 'checking':
      return <Badge tone="gray">確認中…</Badge>;
    default:
      return <Badge tone="gray">未使用</Badge>;
  }
}

function PrinterRow({
  storeId,
  siteUrl,
  printer,
  setupQr,
}: {
  storeId: string;
  siteUrl: string;
  printer: CloudPrntPrinter;
  setupQr: string | null;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(printer.cloudprntEnabled);
  const [drawerCommand, setDrawerCommand] = useState(printer.drawerCommand);
  const [pollInterval, setPollInterval] = useState(printer.pollIntervalSeconds);
  const [stations, setStations] = useState<string[]>(printer.kitchenStations);
  const [copied, setCopied] = useState(false);
  const now = useSyncExternalStore(subscribeClock, getClock, getServerClock);

  const isKitchen = printer.usage === 'kitchen';
  const status = statusOf({ ...printer, cloudprntEnabled: enabled }, now);
  const protocol = PROTOCOL[makerKind(printer.maker)];
  const pollUrl =
    siteUrl && printer.cloudprntToken ? `${siteUrl}/api/${protocol.path}/${printer.cloudprntToken}` : '';

  const run = (fn: () => Promise<{ error?: string }>, okMsg: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast(res.error, 'error');
      else {
        toast(okMsg);
        router.refresh();
      }
    });

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(pollUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  const toggleStation = (key: string) =>
    setStations((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold text-navy">
            {isKitchen ? <ChefHat className="h-4 w-4 text-gray-400" /> : <Receipt className="h-4 w-4 text-gray-400" />}
            {printer.name}
            <span className="text-xs font-normal text-gray-400">
              {isKitchen ? '厨房伝票' : 'レシート'}
              {printer.model ? `・${printer.model}` : ''}
            </span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={status} printer={printer} now={now} />
            {printer.pendingJobs > 0 && <Badge tone="gray">印刷待ち {printer.pendingJobs}件</Badge>}
            {status === 'online' && printer.macAddress && (
              <span className="text-xs text-gray-400">MAC {printer.macAddress}</span>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.checked;
              setEnabled(v);
              run(() => setCloudPrntConfig({ id: printer.id, storeId, enabled: v }), v ? '有効化しました' : '無効化しました');
            }}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          このプリンタを使う
        </label>
      </div>

      {enabled && (
        <div className="space-y-4">
          {status === 'never' &&
            (makerKind(printer.maker) === 'epson' ? (
              <EpsonSetupGuide setupQr={setupQr} />
            ) : (
              <SetupGuide setupQr={setupQr} />
            ))}
          {status === 'offline' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              以前はつながっていましたが、現在プリンタから通信がありません。電源・LANケーブル・用紙切れ・
              店舗のインターネット回線を確認してください。復旧すると自動で「接続中」に戻ります。
            </div>
          )}

          <div>
            <Label>接続用URL（プリンタの {protocol.urlField} に設定）</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={pollUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="secondary" size="sm" onClick={copyUrl} disabled={!pollUrl}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {isKitchen && (
            <div>
              <Label>このプリンタで印刷する伝票</Label>
              <div className="flex flex-wrap gap-3">
                {STATIONS.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={stations.includes(s.key)}
                      onChange={() => toggleStation(s.key)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                商品カテゴリの「提供場所」（メニュー設定）に合わせて振り分けます。追加・数量変更・取消も伝票に出ます。
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`poll-${printer.id}`}>問い合わせ間隔（秒）</Label>
              <Input
                id={`poll-${printer.id}`}
                type="number"
                min={1}
                max={60}
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
              />
            </div>
            {!isKitchen &&
              printer.drawerKick &&
              // EPSON機はピン番号で指定するため、コマンド文字列ではなく接続ピンを選ばせる
              (protocol.path === 'epson' ? (
                <div>
                  <Label htmlFor={`drawer-${printer.id}`}>ドロアの接続ピン（開かない場合に変更）</Label>
                  <Select
                    id={`drawer-${printer.id}`}
                    value={drawerCommand.includes('2') ? '[drawer: 2]' : '[drawer: 1]'}
                    onChange={(e) => setDrawerCommand(e.target.value)}
                  >
                    <option value="[drawer: 1]">2番ピン（通常）</option>
                    <option value="[drawer: 2]">5番ピン</option>
                  </Select>
                </div>
              ) : (
                <div>
                  <Label htmlFor={`drawer-${printer.id}`}>ドロア開放コマンド（開かない場合に変更）</Label>
                  <Input
                    id={`drawer-${printer.id}`}
                    value={drawerCommand}
                    onChange={(e) => setDrawerCommand(e.target.value)}
                    className="font-mono text-xs"
                    placeholder="[drawer: 1]"
                  />
                </div>
              ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() =>
                run(
                  () =>
                    setCloudPrntConfig({
                      id: printer.id,
                      storeId,
                      enabled: true,
                      drawerCommand,
                      pollIntervalSeconds: pollInterval,
                      ...(isKitchen ? { kitchenStations: stations } : {}),
                    }),
                  '保存しました'
                )
              }
              disabled={pending}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => run(() => enqueueCloudPrntTest(printer.id, storeId, 'receipt'), 'テスト印刷を送りました')}
              disabled={pending}
              title={status === 'online' ? undefined : 'プリンタが接続されると印刷されます（10分以内）'}
            >
              <Printer className="h-4 w-4" />
              テスト印刷
            </Button>
            {!isKitchen && printer.drawerKick && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => run(() => enqueueCloudPrntTest(printer.id, storeId, 'drawer'), 'ドロア開放を送りました')}
                disabled={pending}
              >
                <Inbox className="h-4 w-4" />
                ドロアを開く
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm('再発行すると現在の接続用URLは使えなくなり、プリンタ側の再設定が必要です。続行しますか？')) {
                  run(() => regenerateCloudPrntToken(printer.id, storeId), 'URLを再発行しました');
                }
              }}
              disabled={pending}
            >
              <RefreshCw className="h-4 w-4" />
              URLを再発行
            </Button>
          </div>
          {status !== 'online' && (
            <p className="text-xs text-gray-500">
              ※ テスト印刷・ドロアはプリンタが接続されたときに実行されます。長時間つながらない場合は自動で取り消されます
              （ドロア2分・テスト10分）。接続したとたんに何枚も出ることはありません。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * EPSON（TMインテリジェント機）の接続手順。
 * Server Direct Print の設定はプリンタ内蔵の設定画面（Web Config）で行うため、
 * まずプリンタをネットワークにつなぎ、IPアドレスをブラウザで開くところまでを案内する。
 */
function EpsonSetupGuide({ setupQr }: { setupQr: string | null }) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary-soft/40 p-4">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-navy">
        <Smartphone className="h-4 w-4" />
        EPSONプリンタを接続する（約5分）
      </p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <ol className="flex-1 list-decimal space-y-1.5 pl-4 text-sm text-gray-700">
          <li>
            プリンタをネットワークにつなぐ
            <span className="block text-xs text-gray-500">
              LANケーブルを挿すのが確実です。Wi-Fiの場合はスマホアプリ「Epson TM Utility」の Wi-Fi Setup Wizard から設定します
            </span>
          </li>
          <li>
            プリンタの<strong>IPアドレス</strong>を調べる
            <span className="block text-xs text-gray-500">
              用紙をセットして電源を入れ直すと、IPアドレス入りのステータスシートが印字されます（Epson TM Utility の
              View Printer Status でも確認できます）
            </span>
          </li>
          <li>
            同じネットワークのパソコン・スマホのブラウザで <strong>http://プリンタのIP</strong> を開く（Web Config）
            <span className="block text-xs text-gray-500">初期ユーザー名 epson / パスワードはプリンタのシリアル番号（機種により異なります）</span>
          </li>
          <li>
            「Server Direct Print」→ <strong>有効</strong>、サーバー1のURLに右のQRで開いたURLを貼り付け、間隔を
            <strong>3秒</strong>にする
            <span className="block text-xs text-gray-500">ID・パスワードは空欄のまま（TENPO ONE側はURLで認証します）</span>
          </li>
          <li>
            設定を<strong>保存してプリンタを再起動</strong>
          </li>
          <li>数十秒でこの表示が「接続中」に変わります（画面は自動で更新されます）</li>
        </ol>
        {setupQr && (
          <div className="flex shrink-0 flex-col items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={setupQr}
              alt="接続用URLをスマホで開くQRコード"
              className="h-36 w-36 rounded-lg border border-gray-200 bg-white p-1"
            />
            <p className="text-center text-xs text-gray-500">
              スマホのカメラで読むと
              <br />
              URLのコピー画面が開きます
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        プリンタがインターネットに出られることが必要です。以前の設置場所の固定IPが残っていると、店内では印刷できても
        TENPO ONE につながりません。その場合はWeb Configの「TCP/IP」でIPアドレスを自動取得（DHCP）にしてください。
      </p>
    </div>
  );
}

/** 一度も通信が無いときの接続手順。原因の大半はプリンタ側のネットワーク設定。 */
function SetupGuide({ setupQr }: { setupQr: string | null }) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary-soft/40 p-4">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-navy">
        <Smartphone className="h-4 w-4" />
        スマホでプリンタを接続する（約3分）
      </p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <ol className="flex-1 list-decimal space-y-1.5 pl-4 text-sm text-gray-700">
          <li>
            スマホに Star 公式アプリ「<strong>Star Quick Setup Utility</strong>」を入れる（App Store / Google Play）
          </li>
          <li>
            プリンタの電源を入れ、アプリから <strong>Bluetooth</strong> で接続する
            <span className="block text-xs text-gray-500">Bluetooth非搭載の機種（例: MCP31L）は USB ケーブルで接続するか、下のパソコン手順で設定</span>
          </li>
          <li>
            「ネットワーク」→ IPアドレスを <strong>自動取得（DHCP）</strong> にする
            <span className="block text-xs text-gray-500">
              以前の設置場所（dinii等）の固定IPが残っていると、店内では印刷できてもインターネットに出られず接続できません
            </span>
          </li>
          <li>
            「CloudPRNT」→ <strong>有効</strong>、サーバーURLに右のQRで開いたURLを貼り付け、間隔を5秒にする
            <span className="block text-xs text-gray-500">ユーザー名・パスワードは空欄のまま</span>
          </li>
          <li>
            設定を<strong>保存してプリンタを再起動</strong>
          </li>
          <li>数十秒でこの表示が「接続中」に変わります（画面は自動で更新されます）</li>
        </ol>
        {setupQr && (
          <div className="flex shrink-0 flex-col items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setupQr} alt="接続用URLをスマホで開くQRコード" className="h-36 w-36 rounded-lg border border-gray-200 bg-white p-1" />
            <p className="text-center text-xs text-gray-500">
              スマホのカメラで読むと
              <br />
              URLのコピー画面が開きます
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        パソコンから設定する場合は、プリンタの設定画面（http://プリンタのIP、初期ID root / パスワード public）の
        「クラウドプリント」で同じ内容を入力し、Submit → 左メニュー「保存」→ 再起動してください（Submitだけでは保存されません）。
      </p>
    </div>
  );
}
