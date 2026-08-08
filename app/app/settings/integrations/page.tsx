import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isPaymentConfigured, isPaymentTestMode } from '@/lib/payments';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { SettingsBackLink } from '@/components/settings/back-link';

export const metadata: Metadata = { title: '連携 | 設定' };

type IntegrationStatus = '未対応' | '設定可能' | '未接続' | 'テストモード' | '接続済み';

const STATUS_TONE: Record<IntegrationStatus, BadgeTone> = {
  未対応: 'gray',
  設定可能: 'primary',
  未接続: 'danger',
  テストモード: 'warning',
  接続済み: 'success',
};

interface IntegrationRow {
  key: string;
  name: string;
  status: IntegrationStatus;
  note: string;
  href?: string;
  hrefLabel?: string;
  docPath?: string;
}

/** 会計・勤怠SaaSからの移行・互換情報（#21）。TENPO ONE単独稼働が前提のため契約を促す文言は置かない。 */
interface MigrationRow {
  key: string;
  name: string;
  note: string;
}

function StatusBadge({ status }: { status: IntegrationStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

export default async function IntegrationsSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="連携" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから確認してください" />
      </div>
    );
  }

  const supabase = await createClient();
  const { count: printerCount } = await supabase
    .from('printer_configs')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', targetStore.id)
    .eq('status', 'active');

  const configured = isPaymentConfigured();
  const testMode = isPaymentTestMode();
  const stripeStatus: IntegrationStatus = !configured ? '未接続' : testMode ? 'テストモード' : '接続済み';

  const rows: IntegrationRow[] = [
    {
      key: 'stripe',
      name: 'Stripe（決済）',
      status: stripeStatus,
      note: configured
        ? testMode
          ? 'テストキーで接続されています。実際の課金・入金は発生しません。'
          : '本番キー（sk_live_）が設定されています。実機Terminalでの検証が完了するまで本番決済の利用は推奨していません。'
        : '環境変数（STRIPE_SECRET_KEY 等）を設定すると利用できます。秘密鍵はDBに保存しません。',
      href: '/app/settings/payments',
      hrefLabel: '決済・端末の設定へ',
      docPath: 'docs/payment-stripe.md',
    },
    {
      key: 'printers',
      name: 'プリンター',
      status: (printerCount ?? 0) > 0 ? '設定可能' : '未接続',
      note:
        (printerCount ?? 0) > 0
          ? `${printerCount}台のプリンター設定があります。すべてブラウザ印刷によるシミュレーション動作です（実機ドライバー連携は今後対応予定）。`
          : 'プリンターが未登録です。ブラウザ印刷（シミュレーション）で登録できます。',
      href: '/app/settings/printers',
      hrefLabel: 'レジ・プリンターの設定へ',
    },
    {
      key: 'line',
      name: 'LINE',
      status: '未対応',
      note: '予約通知・顧客連携（LINE公式アカウント）は開発予定です。現時点では利用できません。',
      docPath: 'docs/future-integrations.md',
    },
    {
      key: 'gourmet_sites',
      name: 'グルメサイト予約（ぐるなび・食べログ等）',
      status: '未対応',
      note: '外部予約サイトとの在庫・予約連携は開発予定です。現時点では利用できません。',
      docPath: 'docs/future-integrations.md',
    },
  ];

  const migrationRows: MigrationRow[] = [
    {
      key: 'freee',
      name: 'freee会計',
      note: '請求書・経費・仕訳データをTENPO ONE側で入力・管理しています。freeeとのAPI連携は現時点では未実装のため、既存のfreeeデータを移す・freee側へ出す場合はCSVでのやり取りになります。',
    },
    {
      key: 'moneyforward',
      name: 'MoneyForward クラウド',
      note: '会計・給与どちらもTENPO ONE単独で完結します。MoneyForwardからの乗り換え・併用時のデータのやり取りはCSVで行えます（API連携は未実装）。',
    },
    {
      key: 'king_of_time',
      name: 'KING OF TIME（勤怠）',
      note: '打刻・勤怠集計・給与計算はTENPO ONE単独で完結します。KING OF TIMEとのAPI連携は現時点では未実装のため、データのやり取りはCSVになります。',
    },
  ];

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="連携" description={`${targetStore.name}｜各連携の設定状況（虚偽の「接続済み」表示は行いません）`} />

      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.key}>
            <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-navy">{r.name}</p>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{r.note}</p>
                {r.docPath && <p className="mt-1 font-mono text-[11px] text-gray-400">{r.docPath}</p>}
              </div>
              {r.href && (
                <a
                  href={r.href}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {r.hrefLabel}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-navy">会計・勤怠ソフトからの移行・互換（オプション）</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
          TENPO ONE単独で会計・勤怠・給与の業務が完結します。freee・MoneyForward・KING OF TIME等の
          外部会計・勤怠SaaSの契約は不要です。以下は、これらのソフトを既に使っている店舗が乗り換える
          場合や、併用する場合のデータ移行に関する現状のみを示すもので、契約や導入を促すものでは
          ありません。
        </p>

        <div className="mt-3 space-y-3">
          {migrationRows.map((m) => (
            <Card key={m.key} className="border-dashed">
              <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-navy">{m.name}</p>
                    <Badge tone="gray">データ移行・互換用（オプション）</Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{m.note}</p>
                  <p className="mt-1 font-mono text-[11px] text-gray-400">docs/future-integrations.md</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-3 border-primary/20 bg-primary-soft">
          <CardContent className="py-4">
            <p className="text-xs leading-relaxed text-primary-deep">
              現在利用できるCSVエクスポート（事実）: 仕訳データは
              <Link href="/app/accounting" className="mx-1 font-medium underline">
                会計
              </Link>
              画面から、勤怠データは
              <Link href="/app/attendance" className="mx-1 font-medium underline">
                勤怠
              </Link>
              画面から、給与明細データは
              <Link href="/app/payroll" className="mx-1 font-medium underline">
                給与
              </Link>
              画面の各確定済みrunから、請求書・経費データは
              <Link href="/app/invoices" className="mx-1 font-medium underline">
                請求書
              </Link>
              画面から、それぞれCSVで出力できます。外部ソフトへの取込・突合はこのCSVファイルを
              使用してください。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
