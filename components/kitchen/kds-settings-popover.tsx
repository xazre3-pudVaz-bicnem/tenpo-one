'use client';

import { useState, useTransition } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { KdsSettings } from './types';

export function KdsSettingsPopover({
  storeId,
  initial,
  updateKdsSettingsAction,
}: {
  storeId: string;
  initial: KdsSettings;
  updateKdsSettingsAction: (storeId: string, settings: KdsSettings) => Promise<void>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [warn1, setWarn1] = useState(String(initial.warn1));
  const [warn2, setWarn2] = useState(String(initial.warn2));
  const [warn3, setWarn3] = useState(String(initial.warn3));
  const [sound, setSound] = useState(initial.sound);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    const w1 = Number(warn1);
    const w2 = Number(warn2);
    const w3 = Number(warn3);
    if (!(w1 > 0 && w1 < w2 && w2 < w3)) {
      toast('しきい値は 0 < 段階1 < 段階2 < 段階3 の順で入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await updateKdsSettingsAction(storeId, { warn1: w1, warn2: w2, warn3: w3, aggregate: initial.aggregate, sound });
        toast('KDS設定を保存しました');
        setOpen(false);
      } catch (e) {
        toast(e instanceof Error ? e.message : '設定の保存に失敗しました', 'error');
      }
    });
  };

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        <Settings2 className="h-4 w-4" />
        表示設定
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
            <p className="mb-3 text-sm font-semibold text-navy">警告しきい値（経過分数）</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="kds-warn1" className="text-xs">段階1</Label>
                <Input id="kds-warn1" type="number" min={1} value={warn1} onChange={(e) => setWarn1(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="kds-warn2" className="text-xs">段階2</Label>
                <Input id="kds-warn2" type="number" min={1} value={warn2} onChange={(e) => setWarn2(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="kds-warn3" className="text-xs">段階3</Label>
                <Input id="kds-warn3" type="number" min={1} value={warn3} onChange={(e) => setWarn3(e.target.value)} />
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                checked={sound}
                onChange={(e) => setSound(e.target.checked)}
              />
              新規注文で音通知を有効にする
            </label>
            <Button size="sm" className="mt-3 w-full" onClick={handleSave} disabled={pending}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
