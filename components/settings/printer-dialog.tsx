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
  onClose,
}: {
  storeId: string;
  editing: PrinterConfigRow | null;
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
            <p className="mt-1.5 text-xs text-warning">
              プリンターSDK連携は今後のアップデートで対応予定です。現在はブラウザ印刷をご利用ください。
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="printer-ip">IPアドレス</Label>
          <Input id="printer-ip" value={form.ipAddress} onChange={(e) => set('ipAddress', e.target.value)} placeholder="192.168.1.100" />
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
            自動印刷
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
