'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveQrService } from '@/app/app/settings/qr-service/actions';
import {
  DEFAULT_QR_SERVICE_ITEMS,
  QR_SERVICE_MAX_ITEMS,
  QR_SERVICE_NAME_MAX,
  type QrServiceSettings,
} from '@/lib/qr-service';

interface Row {
  id: number;
  name: string;
  nameEn: string;
}

/** 居酒屋向けの例（2026-10-18 Ronnie が SHUNKA に頼んだ一覧） */
const IZAKAYA_EXAMPLE = [
  { name: 'お水', nameEn: 'Water' },
  { name: '塩', nameEn: 'Salt' },
  { name: 'ブラックペッパー', nameEn: 'Black pepper' },
  { name: '一味', nameEn: 'Chili pepper' },
  { name: '醤油', nameEn: 'Soy sauce' },
  { name: 'わさび', nameEn: 'Wasabi' },
  { name: '取り皿交換', nameEn: 'New plates' },
  { name: 'スプーン', nameEn: 'Spoon' },
  { name: 'お箸', nameEn: 'Chopsticks' },
];

/**
 * お客様QRの「サービス」の一覧の編集（設定 > メニュー > QRのサービス）。
 * 並べた順にお客様QRに出る。名前（日本語）は必須、英語は任意（英語の画面で出す）。
 */
export function QrServiceEditor({ storeId, initial }: { storeId: string; initial: QrServiceSettings }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [seq, setSeq] = useState(initial.items.length);
  const [rows, setRows] = useState<Row[]>(
    initial.items.map((i, n) => ({ id: n, name: i.name, nameEn: i.nameEn ?? '' }))
  );
  const [dirty, setDirty] = useState(false);

  const update = (next: Row[]) => {
    setRows(next);
    setDirty(true);
  };
  const fill = (list: readonly { name: string; nameEn: string | null }[]) => {
    update(list.map((i, n) => ({ id: seq + n, name: i.name, nameEn: i.nameEn ?? '' })));
    setSeq(seq + list.length);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    update(next);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveQrService(storeId, {
        enabled,
        items: rows.map((r) => ({ name: r.name, nameEn: r.nameEn || null })),
      });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('保存しました（お客様QRにすぐ出ます）');
      setDirty(false);
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-navy">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setDirty(true);
            }}
            className="h-4 w-4"
          />
          お客様QRに「SERVICE」タブを出す
        </label>

        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right font-num text-xs text-gray-500">{i + 1}</span>
              <Input
                aria-label={`${i + 1}番目の名前（日本語）`}
                value={r.name}
                maxLength={QR_SERVICE_NAME_MAX}
                placeholder="例：お水"
                onChange={(e) => update(rows.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))}
              />
              <Input
                aria-label={`${i + 1}番目の英語名`}
                value={r.nameEn}
                maxLength={QR_SERVICE_NAME_MAX}
                placeholder="例：Water"
                onChange={(e) => update(rows.map((x) => (x.id === r.id ? { ...x, nameEn: e.target.value } : x)))}
              />
              <Button type="button" variant="ghost" size="icon" aria-label="上へ" onClick={() => move(i, i - 1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="下へ" onClick={() => move(i, i + 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="削除"
                onClick={() => update(rows.filter((x) => x.id !== r.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <p className="text-sm text-gray-500">まだありません。「追加」で足してください。</p>}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rows.length >= QR_SERVICE_MAX_ITEMS}
            onClick={() => {
              update([...rows, { id: seq, name: '', nameEn: '' }]);
              setSeq(seq + 1);
            }}
          >
            <Plus className="h-4 w-4" />
            追加
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fill(DEFAULT_QR_SERVICE_ITEMS)}>
            標準（お水・取り皿・お箸・スプーン）に戻す
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fill(IZAKAYA_EXAMPLE)}>
            居酒屋の例を入れる
          </Button>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-3">
          {dirty && <span className="text-xs text-warning">保存していない変更があります</span>}
          <Button type="button" disabled={pending || !dirty} onClick={save}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
