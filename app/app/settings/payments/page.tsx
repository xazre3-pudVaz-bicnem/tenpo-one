import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isPaymentConfigured, isPaymentTestMode } from '@/lib/payments';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SettingsBackLink } from '@/components/settings/back-link';
import { PaymentReadersPanel, type TerminalReaderRow } from '@/components/settings/payment-readers-panel';
import { BookingPaymentSettingsForm } from '@/components/settings/booking-payment-settings-form';
import { CheckoutPresetsPanel } from '@/components/settings/checkout-presets-panel';
import { checkoutPresetsFrom } from '@/lib/checkout-presets';
import type { BookingPaymentMode } from './actions';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { isSteraOnline } from '@/lib/stera';
import { formatTime } from '@/lib/format';
import { SteraTerminalsPanel, type SteraTerminalView } from '@/components/settings/stera-terminals-panel';

export const metadata: Metadata = { title: '決済・端末 | 設定' };

export default async function PaymentsSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="決済・端末" en="Payments" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const configured = isPaymentConfigured();
  const testMode = isPaymentTestMode();

  const supabase = await createClient();
  const [{ data: readers }, { data: settings }] = await Promise.all([
    supabase
      .from('terminal_readers')
      .select('id, label, device_type, is_simulated, status, last_seen_at')
      .eq('store_id', targetStore.id)
      .order('created_at'),
    supabase
      .from('store_settings')
      .select('booking_payment_mode, booking_deposit_amount, settings')
      .eq('store_id', targetStore.id)
      .maybeSingle(),
  ]);

  // stera 端末（サーバー専用のテーブル。この画面は store.settings の権限で開いている）
  const { data: steraRows } = await createAdminClient()
    .from('stera_terminals')
    .select('id, name, terminal_no, link_code, status, last_seen_at, app_version')
    .eq('store_id', targetStore.id)
    .neq('status', 'deleted')
    .order('created_at');
  const renderedAt = new Date().getTime();
  const steraTerminals: SteraTerminalView[] = (steraRows ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    terminalNo: (t.terminal_no as string | null) ?? null,
    linkCode: t.link_code as string,
    active: t.status === 'active',
    online: t.status === 'active' && isSteraOnline(t.last_seen_at as string | null, renderedAt),
    lastSeenLabel: t.last_seen_at
      ? new Date(t.last_seen_at as string).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }) +
        ' ' +
        formatTime(t.last_seen_at as string)
      : null,
    appVersion: (t.app_version as string | null) ?? null,
  }));
  const serverUrl = await resolveSiteOrigin();

  const readerRows: TerminalReaderRow[] = (readers ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    deviceType: r.device_type,
    isSimulated: r.is_simulated,
    status: r.status as TerminalReaderRow['status'],
    lastSeenAt: r.last_seen_at,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="決済・端末" en="Payments" description={targetStore.name} />

      <div className="mb-6">
        <CheckoutPresetsPanel storeId={targetStore.id} initial={checkoutPresetsFrom(settings?.settings)} />
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Stripe接続状態</CardTitle>
          </CardHeader>
          <CardContent>
            {!configured ? (
              <div className="flex flex-wrap items-start gap-3">
                <Badge tone="danger">未接続</Badge>
                <p className="min-w-0 flex-1 text-sm text-gray-600">
                  Stripeテストキーを環境変数へ設定してください（<code className="rounded bg-gray-100 px-1 py-0.5">STRIPE_SECRET_KEY</code>
                  ）。設定手順は docs/payment-stripe.md を参照してください。
                </p>
              </div>
            ) : testMode ? (
              <div className="flex flex-wrap items-start gap-3">
                <Badge tone="warning">接続済み（テストモード）</Badge>
                <p className="min-w-0 flex-1 text-sm text-gray-600">
                  Stripeのテストキーで接続されています。実際の課金・入金は発生しません。
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-start gap-3">
                <Badge tone="danger">本番モード</Badge>
                <p className="min-w-0 flex-1 text-sm text-gray-600">
                  本番キー（sk_live_）が設定されています。TENPO
                  ONEは実機Terminalでの検証が完了するまで本番決済の利用を推奨していません。設定を見直してください。
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>決済プロバイダーの自動連携</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">
              ここでの状態は<strong>自動連携</strong>（TENPO ONEから決済端末へ会計金額を送信し、決済結果を自動で取り込む）の対応状況です。
              <strong>自動連携が「なし」のブランドでも、POSレジの「外部端末（stera等）」決済を選べば、端末を手動で操作して会計できます</strong>
              （売上・レポートには正しく反映されます）。
            </p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              <li className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-navy">Stripe（Terminal）</span>
                  <p className="text-xs text-gray-500">カード端末との自動連携に対応（要APIキー設定）</p>
                </div>
                <Badge tone={!configured ? 'danger' : testMode ? 'warning' : 'success'}>
                  {!configured ? '未接続' : testMode ? 'テストモード' : '接続済み'}
                </Badge>
              </li>
              <li className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-navy">stera（SMBC / stera pack）</span>
                  <p className="text-xs text-gray-500">
                    {steraTerminals.length > 0
                      ? '自動連携（端末の「TENPO ONE 連携」アプリ）。下の「stera 連携」で端末を管理します。'
                      : '下の「stera 連携」で端末を追加すると自動連携できます。それまでは「外部端末（stera等）」決済で手動会計。'}
                  </p>
                </div>
                <Badge tone={steraTerminals.some((t) => t.online) ? 'success' : 'gray'}>
                  {steraTerminals.some((t) => t.online) ? '接続済み' : steraTerminals.length > 0 ? '未接続' : '手動運用'}
                </Badge>
              </li>
              <li className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-navy">Square</span>
                  <p className="text-xs text-gray-500">自動連携なし。「外部端末」決済で手動会計できます。</p>
                </div>
                <Badge tone="gray">手動運用</Badge>
              </li>
              <li className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-navy">AirPAY</span>
                  <p className="text-xs text-gray-500">自動連携なし。「外部端末」決済で手動会計できます。</p>
                </div>
                <Badge tone="gray">手動運用</Badge>
              </li>
            </ul>
          </CardContent>
        </Card>

        <SteraTerminalsPanel
          storeId={targetStore.id}
          terminals={steraTerminals}
          canEdit={ctx.isRegisterDevice !== true}
          serverUrl={serverUrl}
        />

        <PaymentReadersPanel storeId={targetStore.id} testMode={testMode} initial={readerRows} />

        <BookingPaymentSettingsForm
          initial={{
            storeId: targetStore.id,
            bookingPaymentMode: (settings?.booking_payment_mode ?? 'onsite') as BookingPaymentMode,
            bookingDepositAmount: settings?.booking_deposit_amount ?? 0,
          }}
        />

        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs text-gray-500 leading-relaxed">
          <p>
            <strong>自動連携</strong>（金額の自動送信・決済結果の自動取込）はStripe Terminalのみ対応（現在テストモード）。stera等は自動連携なしですが、
            <strong>POSレジで「外部端末（stera等）」決済を選べば手動で会計できます</strong>。
          </p>
          <p className="mt-1">
            レシートの実印字・キャッシュドロアは「レジ・プリンター」設定のCloudPRNT（Star mC-Print3 等）で対応しています。
          </p>
        </div>
      </div>
    </div>
  );
}
