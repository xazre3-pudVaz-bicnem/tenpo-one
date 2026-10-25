'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, Tablet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { MAX_DEVICE_NETWORK_PRINTERS, NETWORK_CONNECTIONS, type NetworkPrinterOption } from '@/lib/network-printers';
import { PrinterDialog, type PrinterConfigRow } from '@/components/settings/printer-dialog';
import {
  deleteAdminNetworkPrinter,
  saveAdminDeviceNetworkPrinters,
  saveAdminNetworkPrinter,
} from '@/app/admin/organizations/printer-actions';
import type { AdminRegisterDevice, AdminStoreNetworkPrinters } from '@/lib/admin-network-printers-server';

const USAGE_LABEL: Record<string, string> = { receipt: 'レシート', kitchen: '厨房', label: 'ラベル' };
const CONNECTION_LABEL: Record<string, string> = { lan: '有線LAN', wifi: 'Wi-Fi' };

/**
 * 運営コンソール：店舗の LAN・Wi-Fi のプリンター（追加・編集・削除）と、iPad ごとの送り先
 * （2026-10-25 Ronnie「printer の LAN・Wi-Fi の設定は 店舗管理画面 からではなく control centre から」）。
 * お店の管理画面（設定 › レジ・プリンター／レジ端末）では見るだけ。Bluetooth・USB・レシートの出し先はお店で決める。
 */
export function NetworkPrintersAdmin({ organizationId, stores }: { organizationId: string; stores: AdminStoreNetworkPrinters[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.storeId ?? '');
  const store = stores.find((s) => s.storeId === storeId) ?? stores[0];

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        厨房・ドリンク・レシートの <strong>有線LAN・Wi-Fi</strong> のプリンターと、iPad ごとの送り先を運営が決めます。お店の管理画面では見るだけです
        （Bluetooth・USB のプリンターとレシートの出し先は、お店の管理画面で設定します）。iPad は次に画面を開いたときから反映します。
      </p>
      {stores.length === 0 || !store ? (
        <p className="text-xs text-gray-400">店舗がありません</p>
      ) : (
        <>
          {stores.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-gray-500">店舗</span>
              <Select value={store.storeId} onChange={(e) => setStoreId(e.target.value)} className="w-auto min-w-48" aria-label="店舗">
                {stores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {s.storeName}（{s.printers.length}台）
                  </option>
                ))}
              </Select>
            </label>
          )}
          <StoreNetworkPrinters key={store.storeId} organizationId={organizationId} store={store} />
        </>
      )}
    </div>
  );
}

function StoreNetworkPrinters({ organizationId, store }: { organizationId: string; store: AdminStoreNetworkPrinters }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterConfigRow | null>(null);
  const [deleting, setDeleting] = useState<PrinterConfigRow | null>(null);

  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label="LAN・Wi-Fi のプリンター">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-navy">プリンター</p>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            プリンターを追加
          </Button>
        </div>
        {store.printers.length === 0 ? (
          <EmptyState title="LAN・Wi-Fi のプリンターはまだありません" description="「プリンターを追加」から登録してください" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>名前</Th>
                  <Th>メーカー / 型番</Th>
                  <Th>接続・IP</Th>
                  <Th>用途</Th>
                  <Th>状態</Th>
                  <Th className="text-right">操作</Th>
                </Tr>
              </THead>
              <TBody>
                {store.printers.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium text-navy">{p.name}</Td>
                    <Td>
                      {p.maker || '—'}
                      {p.model && ` / ${p.model}`}
                    </Td>
                    <Td>
                      {CONNECTION_LABEL[p.connectionType] ?? p.connectionType}
                      {p.ipAddress && <span className="ml-1 font-mono text-xs text-gray-500">{p.ipAddress}</span>}
                    </Td>
                    <Td>
                      {USAGE_LABEL[p.usage] ?? p.usage}
                      {p.usage === 'kitchen' && p.billSlips && <span className="ml-1 text-xs text-gray-500">＋会計伝票</span>}
                      {(p.floorIds ?? []).length > 0 && (
                        <span className="ml-1 text-xs text-gray-500">
                          （{store.floors.filter((f) => (p.floorIds ?? []).includes(f.id)).map((f) => f.name).join('・')}）
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={p.cloudprntEnabled ? 'success' : 'gray'}>{p.cloudprntEnabled ? '使う' : '止めている'}</Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(p);
                            setDialogOpen(true);
                          }}
                          aria-label={`${p.name}を編集`}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(p)}
                          aria-label={`${p.name}を削除`}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
        <p className="text-[11px] text-gray-400">
          Star・EPSON の「接続用URL」（CloudPRNT / Server Direct Print）とテスト印刷は、お店の管理画面の「レジ・プリンター › プリンター接続」に出ます。
        </p>
      </section>

      <section className="space-y-2" aria-label="iPad ごとの LAN・Wi-Fi">
        <p className="text-sm font-semibold text-navy">iPad ごと（LAN で送る・Wi-Fi で直接印刷）</p>
        {store.devices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-4 text-xs text-gray-400">
            この店舗で登録されたレジ端末（iPad）はまだありません。iPad の TENPO ONE でこの店舗にログインすると、ここに出ます
          </p>
        ) : (
          <div className="space-y-3">
            {store.devices.map((d) => (
              <DeviceNetworkPrinters
                key={d.id}
                organizationId={organizationId}
                storeId={store.storeId}
                device={d}
                lanOptions={store.lanOptions}
                wifiOptions={store.wifiOptions}
              />
            ))}
          </div>
        )}
      </section>

      {dialogOpen && (
        <PrinterDialog
          storeId={store.storeId}
          editing={editing}
          floors={store.floors}
          connections={NETWORK_CONNECTIONS}
          showEnabled
          onSave={(input) => saveAdminNetworkPrinter({ ...input, organizationId })}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="プリンターを削除"
          message={`「${deleting.name}」（${store.storeName}）を削除します。この店の iPad の送り先からも外れます。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteAdminNetworkPrinter({ organizationId, storeId: store.storeId, printerId: deleting.id });
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('プリンターを削除しました');
          }}
        />
      )}
    </div>
  );
}

function sameIds(a: string[] | null, b: string[] | null): boolean {
  if (a == null || b == null) return a === b;
  return a.length === b.length && a.every((id) => b.includes(id));
}

function DeviceNetworkPrinters({
  organizationId,
  storeId,
  device,
  lanOptions,
  wifiOptions,
}: {
  organizationId: string;
  storeId: string;
  device: AdminRegisterDevice;
  lanOptions: NetworkPrinterOption[];
  wifiOptions: NetworkPrinterOption[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [lanIds, setLanIds] = useState<string[] | null>(device.lanPrinterIds);
  const [wifiIds, setWifiIds] = useState<string[] | null>(device.wifiPrinterIds);
  const [saved, setSaved] = useState({ lan: device.lanPrinterIds, wifi: device.wifiPrinterIds });
  const revoked = device.status === 'revoked';
  const dirty = !sameIds(saved.lan, lanIds) || !sameIds(saved.wifi, wifiIds);

  const save = () =>
    startTransition(async () => {
      const res = await saveAdminDeviceNetworkPrinters({ organizationId, storeId, deviceId: device.id, lanPrinterIds: lanIds, wifiPrinterIds: wifiIds });
      if (res.error) {
        toast(res.error, 'error');
        return;
      }
      const lan = res.lanPrinterIds ?? null;
      const wifi = res.wifiPrinterIds ?? null;
      setSaved({ lan, wifi });
      setLanIds(lan);
      setWifiIds(wifi);
      toast('保存しました。iPad は次に画面を開いたときから反映されます');
    });

  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white', revoked && 'opacity-60')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Tablet className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-navy">{device.name}</p>
            <p className="text-[11px] text-gray-400">
              {device.kind}・最後に使った {formatDateTime(device.lastSeenAt)}
              {revoked && '・解除済み'}
            </p>
          </div>
        </div>
        <Button type="button" size="sm" onClick={save} disabled={pending || !dirty || revoked}>
          {pending ? '保存中…' : '保存'}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 px-4 py-3 md:grid-cols-2">
        <NetworkPrinterPick
          title="LAN のプリンターへ、この iPad から送る"
          help="厨房・レシートの LAN プリンターへ、この iPad が中継して送ります（パソコン・ブリッジなしで印刷）"
          options={lanOptions}
          value={lanIds}
          onChange={setLanIds}
          disabled={revoked || pending}
          emptyText="中継できる LAN のプリンターがありません（上で IP を入れて「使う」にすると出ます。Star は対象外）"
        />
        <NetworkPrinterPick
          title="Wi-Fi で直接印刷（EPSON）"
          help="同じ Wi-Fi の EPSON プリンターへ、この iPad から直接送ります"
          options={wifiOptions}
          value={wifiIds}
          onChange={setWifiIds}
          disabled={revoked || pending}
          emptyText="直接印刷できる EPSON のプリンターがありません（上で IP を入れて「使う」にすると出ます）"
        />
      </div>
    </div>
  );
}

/** 「端末まかせ（今までどおり）」か「ここで決める（チェックしたプリンターだけ・8 台まで）」 */
function NetworkPrinterPick({
  title,
  help,
  options,
  value,
  onChange,
  disabled,
  emptyText,
}: {
  title: string;
  help: string;
  options: NetworkPrinterOption[];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  disabled: boolean;
  emptyText: string;
}) {
  const managed = value != null;
  const full = (value ?? []).length >= MAX_DEVICE_NETWORK_PRINTERS;
  const toggle = (id: string) => {
    const cur = value ?? [];
    onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <span className="font-semibold text-navy">{title}</span>
      <Select
        value={managed ? 'set' : 'device'}
        onChange={(e) => onChange(e.target.value === 'set' ? (value ?? []) : null)}
        disabled={disabled}
        aria-label={title}
      >
        <option value="device">端末まかせ（今までどおり）</option>
        <option value="set">ここで決める</option>
      </Select>
      {managed &&
        (options.length === 0 ? (
          <span className="rounded-lg bg-surface px-3 py-2 text-xs text-gray-500">{emptyText}</span>
        ) : (
          <div className="flex flex-col gap-1 rounded-lg border border-gray-200 px-3 py-2">
            {options.map((p) => {
              const checked = (value ?? []).includes(p.id);
              return (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(p.id)}
                    disabled={disabled || (!checked && full)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="font-medium text-navy">{p.name}</span>
                  <span className="truncate text-xs text-gray-500">{p.detail}</span>
                </label>
              );
            })}
            {full && <span className="text-[11px] text-gray-400">{MAX_DEVICE_NETWORK_PRINTERS} 台までです</span>}
          </div>
        ))}
      <span className="text-xs text-gray-500">{help}</span>
    </div>
  );
}
