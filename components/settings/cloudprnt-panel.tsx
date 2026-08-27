'use client';

import { useState, useTransition } from 'react';
import { Copy, Check, Printer, Inbox, RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  setCloudPrntConfig,
  regenerateCloudPrntToken,
  enqueueCloudPrntTest,
} from '@/app/app/settings/printers/actions';

export interface CloudPrntPrinter {
  id: string;
  name: string;
  cloudprntEnabled: boolean;
  cloudprntToken: string | null;
  drawerKick: boolean;
  drawerCommand: string;
  paperWidthMm: number;
  pollIntervalSeconds: number;
  lastPolledAt: string | null;
}

export function CloudPrntPanel({
  storeId,
  siteUrl,
  printers,
}: {
  storeId: string;
  siteUrl: string;
  printers: CloudPrntPrinter[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>レシートプリンター（CloudPRNT）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">
          Star mC-Print3 等の CloudPRNT 対応機を接続します。プリンタ側に下の<strong>ポーリングURL</strong>を設定すると、
          プリンタが定期的にこのサーバへ問い合わせ、会計時のレシート印字・キャッシュドロア開放を実行します。
          店舗LAN情報の登録は不要です（プリンタがインターネットに接続できればOK）。
        </p>
        {!siteUrl && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            公開URL（環境変数 <code className="font-mono">NEXT_PUBLIC_SITE_URL</code>）が未設定のため、ポーリングURLを生成できません。
          </div>
        )}
        {printers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-xs text-gray-500">
            上の「プリンター」でレシート用プリンタを登録すると、ここでCloudPRNTを有効化できます。
          </div>
        ) : (
          printers.map((p) => (
            <CloudPrntRow key={p.id} storeId={storeId} siteUrl={siteUrl} printer={p} />
          ))
        )}
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 leading-relaxed">
          <p className="font-semibold text-gray-600">プリンタ側の設定手順（mC-Print3）</p>
          <p>1. プリンタをネットワーク接続（有線LAN/Wi-Fi）。</p>
          <p>2. プリンタのWeb設定画面 → CloudPRNT を有効化。</p>
          <p>3. サーバURLに上の「ポーリングURL」を貼付。ポーリング間隔を設定（例: 5秒）。</p>
          <p>4. 「テスト印刷」を押し、数秒後にレシートが出れば接続成功です。</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CloudPrntRow({
  storeId,
  siteUrl,
  printer,
}: {
  storeId: string;
  siteUrl: string;
  printer: CloudPrntPrinter;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(printer.cloudprntEnabled);
  const [drawerCommand, setDrawerCommand] = useState(printer.drawerCommand);
  const [pollInterval, setPollInterval] = useState(printer.pollIntervalSeconds);
  const [copied, setCopied] = useState(false);

  const pollUrl = siteUrl && printer.cloudprntToken ? `${siteUrl}/api/cloudprnt/${printer.cloudprntToken}` : '';

  const run = (fn: () => Promise<{ error?: string }>, okMsg: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast(res.error, 'error');
      else toast(okMsg);
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

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-navy">{printer.name}</p>
          <p className="text-xs text-gray-500">
            用紙 {printer.paperWidthMm}mm ・ ドロア {printer.drawerKick ? '有効' : '無効'} ・{' '}
            {printer.lastPolledAt
              ? `最終通信 ${new Date(printer.lastPolledAt).toLocaleString('ja-JP')}`
              : '未通信'}
          </p>
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
          CloudPRNTを使う
        </label>
      </div>

      {enabled && (
        <div className="space-y-3">
          <div>
            <Label>ポーリングURL（プリンタのCloudPRNT設定に貼付）</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={pollUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="secondary" size="sm" onClick={copyUrl} disabled={!pollUrl}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`poll-${printer.id}`}>ポーリング間隔（秒）</Label>
              <Input
                id={`poll-${printer.id}`}
                type="number"
                min={1}
                max={60}
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor={`drawer-${printer.id}`}>ドロア開放コマンド（機種で調整可）</Label>
              <Input
                id={`drawer-${printer.id}`}
                value={drawerCommand}
                onChange={(e) => setDrawerCommand(e.target.value)}
                className="font-mono text-xs"
                placeholder="[drawer: 1]"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() =>
                run(
                  () => setCloudPrntConfig({ id: printer.id, storeId, enabled: true, drawerCommand, pollIntervalSeconds: pollInterval }),
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
              onClick={() => run(() => enqueueCloudPrntTest(printer.id, storeId, 'receipt'), 'テスト印刷をキューに追加しました')}
              disabled={pending}
            >
              <Printer className="h-4 w-4" />
              テスト印刷
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => run(() => enqueueCloudPrntTest(printer.id, storeId, 'drawer'), 'ドロア開放をキューに追加しました')}
              disabled={pending || !printer.drawerKick}
              title={printer.drawerKick ? undefined : 'このプリンタはドロアキックが無効です'}
            >
              <Inbox className="h-4 w-4" />
              ドロアを開く
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm('トークンを再発行すると現在のポーリングURLは無効になります。プリンタ側の再設定が必要です。続行しますか？')) {
                  run(() => regenerateCloudPrntToken(printer.id, storeId), 'トークンを再発行しました');
                }
              }}
              disabled={pending}
            >
              <RefreshCw className="h-4 w-4" />
              トークン再発行
            </Button>
          </div>
          <p className="text-xs text-amber-600">
            ※ テスト印刷・ドロアはプリンタが次にポーリングした時（最大{pollInterval}秒後）に実行されます。文字コードはサーバー側で機種に合わせて送るため、プリンタ側の設定は不要です。
          </p>
        </div>
      )}
    </div>
  );
}
