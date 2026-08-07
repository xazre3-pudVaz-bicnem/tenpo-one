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
import type { BookingPaymentMode } from './actions';

export const metadata: Metadata = { title: '決済・端末 | 設定' };

export default async function PaymentsSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="決済・端末" />
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
      .select('booking_payment_mode, booking_deposit_amount')
      .eq('store_id', targetStore.id)
      .maybeSingle(),
  ]);

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
      <PageHeader title="決済・端末" description={targetStore.name} />

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

        <PaymentReadersPanel storeId={targetStore.id} testMode={testMode} initial={readerRows} />

        <BookingPaymentSettingsForm
          initial={{
            storeId: targetStore.id,
            bookingPaymentMode: (settings?.booking_payment_mode ?? 'onsite') as BookingPaymentMode,
            bookingDepositAmount: settings?.booking_deposit_amount ?? 0,
          }}
        />

        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs text-gray-500">
          現在はStripeテストモードのみ対応しています。実機決済端末は今後のアップデートで対応予定です。
        </div>
      </div>
    </div>
  );
}
