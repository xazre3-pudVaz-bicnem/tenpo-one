'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  applyBulkOp,
  diffBulkRows,
  filterBulkRows,
  type BulkItemType,
  type BulkOp,
  type BulkRow,
} from '@/lib/menu-bulk';
import { saveMenuBulk } from '@/app/app/settings/menu-bulk/actions';

const TYPE_LABEL: Record<string, string> = { food: 'フード', drink: 'ドリンク', course: 'コース', option: 'オプション' };

function toInt(v: string): number | null {
  const n = Number(v.replace(/[,，円¥\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * メニュー一括編集（2026-09-23 dinii と同じ機能）。
 * 商品名・英語名・カテゴリ・種別・価格・テイクアウト価格・表示・売切を表でまとめて直し、「変更を保存」で一度に保存する。
 * 行を選んで「カテゴリを変える」「価格を ±円 / ±％」「表示／非表示」「売切」もまとめてかけられる。
 */
export function MenuBulkEditor({
  storeId,
  categories,
  initial,
}: {
  storeId: string;
  categories: { id: string; name: string }[];
  initial: BulkRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<BulkRow[]>(initial);
  const [base, setBase] = useState<BulkRow[]>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoryId, setCategoryId] = useState('all');
  const [itemType, setItemType] = useState('all');
  const [search, setSearch] = useState('');
  const [opKind, setOpKind] = useState<BulkOp['kind']>('pricePercent');
  const [opValue, setOpValue] = useState('');
  const [opCategory, setOpCategory] = useState('');
  const [roundTo10, setRoundTo10] = useState(true);
  const [pending, startTransition] = useTransition();

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const visible = useMemo(() => filterBulkRows(rows, { categoryId, itemType, search }), [rows, categoryId, itemType, search]);
  const patches = useMemo(() => diffBulkRows(base, rows), [base, rows]);
  const changedIds = useMemo(() => new Set(patches.map((p) => p.id)), [patches]);
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  const update = (id: string, patch: Partial<BulkRow>) =>
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const toggleAll = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) visible.forEach((r) => next.delete(r.id));
      else visible.forEach((r) => next.add(r.id));
      return next;
    });

  const applyOp = () => {
    if (selected.size === 0) return;
    let op: BulkOp | null = null;
    const n = toInt(opValue);
    switch (opKind) {
      case 'category':
        op = { kind: 'category', categoryId: opCategory || null };
        break;
      case 'itemType':
        if (opValue && opValue in TYPE_LABEL) op = { kind: 'itemType', itemType: opValue as BulkItemType };
        break;
      case 'priceAdd':
        if (n !== null) op = { kind: 'priceAdd', yen: n };
        break;
      case 'pricePercent':
        if (n !== null && n > -100 && n <= 1000) op = { kind: 'pricePercent', percent: n, roundTo10 };
        break;
      case 'priceSet':
        if (n !== null && n >= 0) op = { kind: 'priceSet', yen: n };
        break;
      case 'status':
        op = { kind: 'status', status: opValue === 'hidden' ? 'hidden' : 'active' };
        break;
      case 'soldOut':
        op = { kind: 'soldOut', soldOut: opValue === 'true' };
        break;
    }
    if (!op) {
      toast('値を入力してください', 'warning');
      return;
    }
    setRows((list) => applyBulkOp(list, selected, op));
    toast(`${selected.size}件に反映しました（まだ保存していません）`);
  };

  const save = () => {
    if (patches.length === 0) return;
    const bad = rows.find((r) => changedIds.has(r.id) && (!r.name.trim() || r.price < 0));
    if (bad) {
      toast(`「${bad.name || '（名前なし）'}」の商品名か価格を確認してください`, 'error');
      return;
    }
    startTransition(async () => {
      const result = await saveMenuBulk(storeId, patches);
      if (result.error) {
        toast(result.error, 'error');
        router.refresh();
        return;
      }
      toast(`${result.updated ?? patches.length}件を保存しました（レジ・ハンディ・お客様QRに反映）`);
      setBase(rows);
      setSelected(new Set());
      router.refresh();
    });
  };

  const needsValue = opKind === 'priceAdd' || opKind === 'pricePercent' || opKind === 'priceSet';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="商品名・英語名で検索" className="pl-9" />
        </div>
        <Select aria-label="カテゴリで絞り込み" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-56">
          <option value="all">すべてのカテゴリ</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="uncategorized">未分類</option>
        </Select>
        <Select aria-label="種別で絞り込み" value={itemType} onChange={(e) => setItemType(e.target.value)} className="w-36">
          <option value="all">すべての種別</option>
          {Object.entries(TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <span className="text-xs text-gray-500 tabular-nums">
          {visible.length}件表示 / 全{rows.length}件
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm">
        <span className="font-semibold text-navy tabular-nums">選択中 {selected.size}件に:</span>
        <Select aria-label="まとめて変える項目" value={opKind} onChange={(e) => { setOpKind(e.target.value as BulkOp['kind']); setOpValue(''); }} className="w-44">
          <option value="pricePercent">価格を ％ で変える</option>
          <option value="priceAdd">価格を ± 円 で変える</option>
          <option value="priceSet">価格を同じ金額にする</option>
          <option value="category">カテゴリを変える</option>
          <option value="itemType">種別を変える</option>
          <option value="status">表示／非表示</option>
          <option value="soldOut">売切／販売中</option>
        </Select>
        {needsValue && (
          <Input
            aria-label="値"
            value={opValue}
            onChange={(e) => setOpValue(e.target.value)}
            placeholder={opKind === 'pricePercent' ? '例: 10 または -20' : opKind === 'priceAdd' ? '例: 50 または -100' : '例: 500'}
            className="w-40"
            inputMode="numeric"
          />
        )}
        {opKind === 'pricePercent' && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={roundTo10} onChange={(e) => setRoundTo10(e.target.checked)} />
            10円単位
          </label>
        )}
        {opKind === 'category' && (
          <Select aria-label="変更先のカテゴリ" value={opCategory} onChange={(e) => setOpCategory(e.target.value)} className="w-56">
            <option value="">未分類</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {opKind === 'itemType' && (
          <Select aria-label="変更先の種別" value={opValue} onChange={(e) => setOpValue(e.target.value)} className="w-36">
            <option value="">選んでください</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        )}
        {opKind === 'status' && (
          <Select aria-label="表示" value={opValue || 'active'} onChange={(e) => setOpValue(e.target.value)} className="w-32">
            <option value="active">表示</option>
            <option value="hidden">非表示</option>
          </Select>
        )}
        {opKind === 'soldOut' && (
          <Select aria-label="売切" value={opValue || 'false'} onChange={(e) => setOpValue(e.target.value)} className="w-32">
            <option value="false">販売中</option>
            <option value="true">売切</option>
          </Select>
        )}
        <Button size="sm" variant="secondary" onClick={applyOp} disabled={selected.size === 0}>
          反映
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="w-10 px-2 py-2">
                <input type="checkbox" aria-label="表示中を全部選ぶ" checked={allVisibleSelected} onChange={toggleAll} />
              </th>
              <th className="px-2 py-2">商品名</th>
              <th className="px-2 py-2">英語名</th>
              <th className="px-2 py-2">カテゴリ</th>
              <th className="px-2 py-2">種別</th>
              <th className="px-2 py-2 text-right">価格</th>
              <th className="px-2 py-2 text-right">テイクアウト</th>
              <th className="px-2 py-2">表示</th>
              <th className="px-2 py-2">売切</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className={cn('border-t border-gray-100', changedIds.has(r.id) && 'bg-amber-50')}>
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    aria-label={`${r.name}を選ぶ`}
                    checked={selected.has(r.id)}
                    onChange={(e) =>
                      setSelected((cur) => {
                        const next = new Set(cur);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="px-2 py-1">
                  <Input aria-label="商品名" value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} className="h-8 min-w-[12rem]" />
                </td>
                <td className="px-2 py-1">
                  <Input aria-label="英語名" value={r.nameEn} onChange={(e) => update(r.id, { nameEn: e.target.value })} className="h-8 min-w-[10rem]" />
                </td>
                <td className="px-2 py-1">
                  <Select
                    aria-label="カテゴリ"
                    value={r.categoryId ?? ''}
                    onChange={(e) => update(r.id, { categoryId: e.target.value || null })}
                    className="h-8 w-44"
                    title={r.categoryId ? catName.get(r.categoryId) : '未分類'}
                  >
                    <option value="">未分類</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Select aria-label="種別" value={r.itemType} onChange={(e) => update(r.id, { itemType: e.target.value })} className="h-8 w-28">
                    {Object.entries(TYPE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Input
                    aria-label="価格"
                    inputMode="numeric"
                    value={String(r.price)}
                    onChange={(e) => {
                      const n = toInt(e.target.value);
                      if (n !== null && n >= 0) update(r.id, { price: n });
                      else if (e.target.value === '') update(r.id, { price: 0 });
                    }}
                    className="h-8 w-24 text-right tabular-nums"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    aria-label="テイクアウト価格"
                    inputMode="numeric"
                    value={r.takeoutPrice == null ? '' : String(r.takeoutPrice)}
                    placeholder="—"
                    onChange={(e) => {
                      if (e.target.value.trim() === '') update(r.id, { takeoutPrice: null });
                      else {
                        const n = toInt(e.target.value);
                        if (n !== null && n >= 0) update(r.id, { takeoutPrice: n });
                      }
                    }}
                    className="h-8 w-24 text-right tabular-nums"
                  />
                </td>
                <td className="px-2 py-1">
                  <Select
                    aria-label="表示"
                    value={r.status}
                    onChange={(e) => update(r.id, { status: e.target.value === 'hidden' ? 'hidden' : 'active' })}
                    className="h-8 w-24"
                  >
                    <option value="active">表示</option>
                    <option value="hidden">非表示</option>
                  </Select>
                </td>
                <td className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    aria-label="売切"
                    checked={r.isSoldOut}
                    onChange={(e) => update(r.id, { isSoldOut: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="py-8 text-center text-sm text-gray-500">該当する商品がありません</p>}
      </div>

      <div className="sticky bottom-16 z-10 flex items-center justify-end gap-2 rounded-lg border border-gray-200 bg-white/95 p-2 shadow-sm lg:bottom-2">
        <span className="mr-auto text-xs text-gray-500 tabular-nums">
          {patches.length > 0 ? `未保存の変更 ${patches.length}件（黄色の行）` : '変更はありません'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || patches.length === 0}
          onClick={() => {
            setRows(base);
            setSelected(new Set());
          }}
        >
          元に戻す
        </Button>
        <Button size="sm" disabled={pending || patches.length === 0} onClick={save}>
          {pending ? '保存中…' : `変更を保存（${patches.length}件）`}
        </Button>
      </div>
    </div>
  );
}
