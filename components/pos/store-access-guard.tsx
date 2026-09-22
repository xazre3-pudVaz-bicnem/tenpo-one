import { RegisterGate } from '@/components/pos/register-gate';
import { claimRegisterDevice } from '@/app/app/pos/register-device-actions';
import { isRequestFromStoreNetwork, peekRegisterDevice } from '@/lib/store-access-server';
import { ACCESS_MESSAGE } from '@/lib/store-access';

/**
 * レジ画面（/app/pos・/app/floor）のアクセス制限（2026-09-23 契約）。
 * 制限なしの店舗では null（＝そのまま表示）。制限に引っかかったら出す画面を返す。
 * 端末の台数は「レジの画面」でだけ数える（フロア画面は回線だけ見る）。
 */
export async function storeAccessBlock(
  store: { id: string; name: string },
  opts: { countDevice: boolean }
): Promise<React.ReactNode | null> {
  if (!(await isRequestFromStoreNetwork(store.id))) {
    return <RegisterGate kind="network" storeId={store.id} storeName={store.name} message={ACCESS_MESSAGE.network} />;
  }
  if (!opts.countDevice) return null;

  const { decision, limit } = await peekRegisterDevice(store.id);
  if (decision.kind === 'allowed') return null;
  if (decision.kind === 'register') {
    return (
      <RegisterGate
        kind="register"
        storeId={store.id}
        storeName={store.name}
        limit={limit}
        message="この iPad をこの店舗のレジとして登録します。契約で決めた台数まで登録できます。"
        claimAction={claimRegisterDevice}
      />
    );
  }
  if (decision.kind === 'limit') {
    return <RegisterGate kind="limit" storeId={store.id} storeName={store.name} limit={limit} message={ACCESS_MESSAGE.limit} />;
  }
  return <RegisterGate kind="revoked" storeId={store.id} storeName={store.name} limit={limit} message={ACCESS_MESSAGE.revoked} />;
}
