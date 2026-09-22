'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { savePrinterConfig } from '@/app/app/settings/printers/actions';

export interface PrinterConfigRow {
  id: string;
  name: string;
  maker: string;
  model: string;
  connectionType: string;
  ipAddress: string;
  usage: string;
  paperWidthMm: number;
  autoPrint: boolean;
  drawerKick: boolean;
  isVerified: boolean;
  /** CloudPRNTで実機印字する設定になっているか（一覧の「シミュレーション動作」表示の判定に使う）。 */
  cloudprntEnabled?: boolean;
  /** 担当フロア（floors.id）。空＝既定プリンター */
  floorIds?: string[];
  /** 厨房（ドリンク）機から会計伝票も出す */
  billSlips?: boolean;
}

export interface FloorOption {
  id: string;
  name: string;
}

const MAKER_OPTIONS = ['EPSON', 'Star', 'その他'];
const CONNECTION_OPTIONS = [
  { value: 'browser', label: 'ブラウザ印刷' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'lan', label: '有線LAN' },
  { value: 'bluetooth', label: 'Bluetooth' },
  { value: 'usb', label: 'USB' },
];
const USAGE_OPTIONS = [
  { value: 'receipt', label: 'レシート' },
  { value: 'kitchen', label: '厨房' },
  { value: 'label', label: 'ラベル' },
];

function emptyPrinter(): PrinterConfigRow {
  return {
    id: '',
    name: '',
    maker: 'EPSON',
    model: '',
    connectionType: 'browser',
    ipAddress: '',
    usage: 'receipt',
    paperWidthMm: 80,
    autoPrint: false,
    drawerKick: false,
    isVerified: false,
  };
}

export function PrinterDialog({
  storeId,
  editing,
  floors = [],
  onClose,
}: {
  storeId: string;
  editing: PrinterConfigRow | null;
  /** 店舗のフロア（担当フロアの選択肢） */
  floors?: FloorOption[];
  onClose: () => void;
}) {
  const [form, setForm] = useState<PrinterConfigRow>(editing ?? emptyPrinter());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof PrinterConfigRow>(key: K, value: PrinterConfigRow[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('プリンター名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await savePrinterConfig({
        id: editing?.id,
        storeId,
        name: form.name,
        maker: form.maker,
        model: form.model,
        connectionType: form.connectionType,
        ipAddress: form.ipAddress,
        usage: form.usage,
        paperWidthMm: form.paperWidthMm,
        autoPrint: form.autoPrint,
        drawerKick: form.drawerKick,
        floorIds: form.usage === 'label' ? [] : (form.floorIds ?? []),
        billSlips: form.usage === 'kitchen' ? !!form.billSlips : false,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editing ? 'プリンター設定を更新しました' : 'プリンター設定を追加しました');
      onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title={editing ? 'プリンター編集' : 'プリンター追加'}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="printer-name">プリンター名</Label>
          <Input id="printer-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="レジ横レシートプリンター" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="printer-maker">メーカー</Label>
            <Select id="printer-maker" value={form.maker} onChange={(e) => set('maker', e.target.value)}>
              {MAKER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="printer-model">型番</Label>
            <Input id="printer-model" value={form.model} onChange={(e) => set('model', e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="printer-connection">接続方式</Label>
          <Select id="printer-connection" value={form.connectionType} onChange={(e) => set('connectionType', e.target.value)}>
            {CONNECTION_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          {form.connectionType !== 'browser' && (
            <p className="mt-1.5 text-xs text-gray-500">
              Wi-Fi / 有線LAN のどちらでもOK（有線が安定）。実機のレシート印字は、保存後に下の「プリンター接続」で有効化します。プリンタがインターネットに接続できれば利用できます。
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="printer-ip">IPアドレス（任意）</Label>
          <Input id="printer-ip" value={form.ipAddress} onChange={(e) => set('ipAddress', e.target.value)} placeholder="192.168.1.100" />
          <p className="mt-1.5 text-xs text-gray-500">
            メモ用（任意）。プリンタ側からTENPO ONEへ通信するため、ここのIP登録は不要です。
            （EPSON機はこのIPをブラウザで開いて設定画面に入ります）
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="printer-usage">用途</Label>
            <Select id="printer-usage" value={form.usage} onChange={(e) => set('usage', e.target.value)}>
              {USAGE_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="printer-width">用紙幅</Label>
            <Select id="printer-width" value={form.paperWidthMm} onChange={(e) => set('paperWidthMm', Number(e.target.value))}>
              <option value={58}>58mm</option>
              <option value={80}>80mm</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={form.autoPrint}
              onChange={(e) => set('autoPrint', e.target.checked)}
            />
            自動印刷（QR注文が入ったら、お会計伝票をこのレジプリンターから自動で出す）
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={form.drawerKick}
              onChange={(e) => set('drawerKick', e.target.checked)}
            />
            ドロア連動
          </label>
        </div>

        {form.usage === 'kitchen' && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={!!form.billSlips}
              onChange={(e) => set('billSlips', e.target.checked)}
            />
            会計伝票もこのプリンターから出す（担当フロアの卓の中間伝票・QR注文のお会計伝票）
          </label>
        )}

        {form.usage !== 'label' && floors.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700">
              {form.usage === 'kitchen' ? '担当フロア（このフロアの卓の伝票を出す）' : '担当フロア（会計伝票を出すフロア）'}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {floors.map((f) => {
                const checked = (form.floorIds ?? []).includes(f.id);
                return (
                  <label key={f.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      checked={checked}
                      onChange={(e) => {
                        const cur = form.floorIds ?? [];
                        set('floorIds', e.target.checked ? [...cur, f.id] : cur.filter((x) => x !== f.id));
                      }}
                    />
                    {f.name}
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {form.usage === 'kitchen'
                ? 'チェックしたフロアの卓の厨房・ドリンク伝票だけをこのプリンターから出します（同じ担当の機械が他の階にあるとき）。何もチェックしない＝担当のいないフロアの伝票を全部出す。'
                : 'チェックしたフロアの卓の会計伝票（中間伝票・QR注文のお会計伝票）をこのプリンターから出します。何もチェックしない＝店の既定プリンター（レシート・ドロア、担当のいないフロアの伝票）。'}
            </p>
          </div>
        )}

        <FieldError message={error ?? undefined} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
