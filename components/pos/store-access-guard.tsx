import { RegisterGate } from '@/components/pos/register-gate';
import { claimRegisterDevice } from '@/app/app/pos/register-device-actions';
import { loadStoreAccess, peekRegisterDevice } from '@/lib/store-access-server';
import { ACCESS_MESSAGE, registerBlockMessage } from '@/lib/store-access';
import { DEVICE_MESSAGE } from '@/lib/device-control';

/**
 * レジ画面（/app/pos・/app/floor）のアクセス制限（2026-09-23 契約）。
 * 制限なしの店舗では null（＝そのまま表示）。制限に引っかかったら出す画面を返す。
 * 端末の台数は「レジの画面」でだけ数える（フロア画面は回線だけ見る）。
 * コントロールセンター（2026-10-25・migration 00104 の後）: レジの契約 OFF・承認待ち・却下・運営が解除 もここで止める。
 */
export async function storeAccessBlock(
  store: { id: string; name: string },
  opts: { countDevice: boolean }
): Promise<React.ReactNode | null> {
  const { policy, onNetwork } = await loadStoreAccess(store.id);
  if (!onNetwork) {
    return <RegisterGate kind="network" storeId={store.id} storeName={store.name} message={ACCESS_MESSAGE.network} />;
  }
  if (!opts.countDevice) return null;

  const { decision, limit, approval } = await peekRegisterDevice(store.id, policy);
  if (decision.kind === 'allowed') return null;
  if (decision.kind === 'register') {
    return (
      <RegisterGate
        kind="register"
        storeId={store.id}
        storeName={store.name}
        limit={limit}
        message={
          approval
            ? 'この iPad をこの店舗のレジとして登録します。登録すると TENPO ONE 運営の承認待ちになり、承認されると使えます。'
            : 'この iPad をこの店舗のレジとして登録します。契約で決めた台数まで登録できます。'
        }
        claimAction={claimRegisterDevice}
      />
    );
  }
  if (decision.kind === 'pending') {
    return <RegisterGate kind="pending" storeId={store.id} storeName={store.name} limit={limit} message={DEVICE_MESSAGE.pending} />;
  }
  const message = registerBlockMessage(decision, approval) ?? ACCESS_MESSAGE.revoked;
  if (decision.kind === 'limit') {
    return <RegisterGate kind="limit" storeId={store.id} storeName={store.name} limit={limit} message={message} />;
  }
  return <RegisterGate kind="revoked" storeId={store.id} storeName={store.name} limit={limit} message={message} />;
}
