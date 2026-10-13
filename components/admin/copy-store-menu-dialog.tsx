'use client';

import { useState, useTransition } from 'react';
import { Copy } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { copyStoreMenu, type CopyStoreMenuResult } from '@/app/admin/organizations/actions';

/**
 * 店舗のメニューを別の店舗にコピー（運営管理。2026-10-14 Ronnie「FULLMOoN 五反田のメニューとレジの設定は肉ギャング渋谷と同じ」）。
 * コピー先は空の店舗だけ（サーバーで確かめる）。
 */
export function CopyStoreMenuDialog({ organizationId, stores }: { organizationId: string; stores: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [result, setResult] = useState<CopyStoreMenuResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setSource('');
    setTarget('');
    setResult(null);
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await copyStoreMenu({ organizationId, sourceStoreId: source, targetStoreId: target });
        setResult(res);
        toast('メニューをコピーしました');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'コピーに失敗しました');
      }
    });
  };

  if (stores.length < 2) return null;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Copy className="h-3.5 w-3.5" />
        メニューをコピー
      </Button>
      <Dialog open={open} onClose={close} title="店舗のメニューをコピー">
        {result ? (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-navy">コピーしました</p>
            <ul className="list-disc space-y-0.5 pl-5 text-gray-600">
              <li>カテゴリ {result.categories}・商品 {result.items}（サイズ {result.variants}・トッピング {result.modifierLinks}）</li>
              <li>選択肢のグループ {result.optionGroups}・選択肢 {result.optionItems}・商品とのつながり {result.itemOptionLinks}</li>
              <li>レジの設定（ページ・プラン・ランチ・時間帯の値段・テイクアウト・コースの段・会計のボタン・来店経路・厨房伝票）</li>
            </ul>
            <div className="flex justify-end">
              <Button onClick={close}>閉じる</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs text-gray-500">
              コピー元の店舗だけのカテゴリ・商品・選択肢と、メニューに関わるレジの設定をコピーします。テーブル・プリンター・スタッフ・売上はコピーしません。
              コピー先は、まだメニューが無い店舗だけです。
            </p>
            <div>
              <Label htmlFor="copy-menu-source">コピー元</Label>
              <Select id="copy-menu-source" required value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">選んでください</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="copy-menu-target">コピー先（空の店舗）</Label>
              <Select id="copy-menu-target" required value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">選んでください</option>
                {stores
                  .filter((s) => s.id !== source)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </div>
            <FieldError message={error ?? undefined} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                やめる
              </Button>
              <Button type="submit" disabled={pending || !source || !target}>
                {pending ? 'コピーしています…' : 'コピーする'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
