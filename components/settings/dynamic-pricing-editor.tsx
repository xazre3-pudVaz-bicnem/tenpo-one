'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import {
  WEEKDAY_LABELS,
  adjustPrice,
  describeRule,
  dynamicRuleProblem,
  ruleActiveAt,
  type DynamicPriceRule,
} from '@/lib/dynamic-pricing';
import { saveDynamicPricing } from '@/app/app/settings/dynamic-pricing/actions';

interface ItemOption {
  id: string;
  name: string;
  categoryId: string | null;
  itemType: string;
  price: number;
}

function newRule(): DynamicPriceRule {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r${Date.now()}`,
    name: 'ハッピーアワー',
    enabled: true,
    days: [1, 2, 3, 4, 5],
    start: '17:00',
    end: '19:00',
    target: 'categories',
    categoryIds: [],
    itemIds: [],
    kind: 'percent',
    value: -20,
    roundTo10: true,
  };
}

/**
 * ダイナミックプライシングの編集（2026-09-23 dinii と同じ機能。全店舗共通）。
 * 上のルールほど優先。レジ・ハンディ・お客様QRの値段に、その時間帯だけ反映される。
 */
export function DynamicPricingEditor({
  storeId,
  initial,
  categories,
  items,
}: {
  storeId: string;
  initial: DynamicPriceRule[];
  categories: { id: string; name: string }[];
  items: ItemOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rules, setRules] = useState<DynamicPriceRule[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [itemSearch, setItemSearch] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(rules) !== saved;
  const now = useMemo(() => new Date(), []);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);

  const update = (id: string, patch: Partial<DynamicPriceRule>) =>
    setRules((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, to: number) =>
    setRules((list) => {
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      const [x] = next.splice(i, 1);
      next.splice(to, 0, x);
      return next;
    });

  const save = () => {
    for (const r of rules) {
      const problem = dynamicRuleProblem(r);
      if (problem) {
        toast(problem, 'error');
        return;
      }
    }
    startTransition(async () => {
      const result = await saveDynamicPricing(storeId, rules);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      setSaved(JSON.stringify(rules));
      toast('ダイナミックプライシングを保存しました（レジ・ハンディ・お客様QRに反映）');
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600">
        曜日と時間帯で値段を自動で変えます（例: 平日 17:00〜19:00 はドリンク 20%引き、22:00〜翌5:00 は +10%）。
        上のルールほど優先で、1つの商品には最初に当てはまったルールだけがかかります。
        注文を入れた時点の値段で伝票に入ります（あとから時間が変わっても、入った注文の値段は変わりません）。
        選択肢（トッピング等）の追加料金はそのままです。
      </div>

      {rules.length === 0 && <p className="py-6 text-center text-sm text-gray-500">ルールはまだありません。「ルール追加」から作ってください。</p>}

      <ol className="space-y-3">
        {rules.map((r, i) => {
          const activeNow = r.enabled && ruleActiveAt(r, now);
          const q = (itemSearch[r.id] ?? '').trim().toLowerCase();
          const itemChoices = q
            ? items.filter((it) => it.name.toLowerCase().includes(q) && !r.itemIds.includes(it.id)).slice(0, 12)
            : [];
          return (
            <li key={r.id} className={cn('rounded-xl border bg-white p-4', r.enabled ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-right text-xs text-gray-400 tabular-nums">{i + 1}</span>
                <Input
                  aria-label="ルール名"
                  value={r.name}
                  onChange={(e) => update(r.id, { name: e.target.value })}
                  className="h-9 w-56 font-semibold"
                />
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.id, { enabled: e.target.checked })} />
                  有効
                </label>
                {activeNow && <Badge tone="success">いま適用中</Badge>}
                <span className="ml-auto text-xs text-gray-500">{describeRule(r)}</span>
                <button type="button" aria-label="上へ" onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" aria-label="下へ" onClick={() => move(i, i + 1)} disabled={i === rules.length - 1} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="削除"
                  onClick={() => setRules((list) => list.filter((x) => x.id !== r.id))}
                  className="rounded p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-600">曜日（選ばない＝毎日）</p>
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAY_LABELS.map((l, d) => {
                      const on = r.days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => update(r.id, { days: on ? r.days.filter((x) => x !== d) : [...r.days, d].sort() })}
                          className={cn(
                            'h-8 w-8 rounded-full text-xs font-semibold',
                            on ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          )}
                        >
                          {l}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input type="time" aria-label="開始" value={r.start} onChange={(e) => update(r.id, { start: e.target.value })} className="h-9 w-28" />
                    <span className="text-gray-400">〜</span>
                    <Input type="time" aria-label="終了" value={r.end} onChange={(e) => update(r.id, { end: e.target.value })} className="h-9 w-28" />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">開始と終了が同じなら終日。終了が開始より前なら翌日まで（22:00〜05:00）。</p>
                </div>

                <div>
                  <Label htmlFor={`target-${r.id}`}>対象</Label>
                  <Select
                    id={`target-${r.id}`}
                    value={r.target}
                    onChange={(e) => update(r.id, { target: e.target.value as DynamicPriceRule['target'] })}
                  >
                    <option value="categories">カテゴリを選ぶ</option>
                    <option value="items">商品を選ぶ</option>
                    <option value="all">フード・ドリンク全部</option>
                  </Select>
                  {r.target === 'categories' && (
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-gray-100 p-2">
                      {categories.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={r.categoryIds.includes(c.id)}
                            onChange={(e) =>
                              update(r.id, {
                                categoryIds: e.target.checked ? [...r.categoryIds, c.id] : r.categoryIds.filter((x) => x !== c.id),
                              })
                            }
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  )}
                  {r.target === 'items' && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex flex-wrap gap-1">
                        {r.itemIds.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => update(r.id, { itemIds: r.itemIds.filter((x) => x !== id) })}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-danger-soft"
                            title="外す"
                          >
                            {itemName.get(id) ?? '（削除された商品）'} ×
                          </button>
                        ))}
                      </div>
                      <Input
                        aria-label="商品を検索して追加"
                        placeholder="商品名で検索して追加"
                        value={itemSearch[r.id] ?? ''}
                        onChange={(e) => setItemSearch((s) => ({ ...s, [r.id]: e.target.value }))}
                        className="h-9"
                      />
                      {itemChoices.length > 0 && (
                        <ul className="max-h-40 overflow-y-auto rounded-md border border-gray-100">
                          {itemChoices.map((it) => (
                            <li key={it.id}>
                              <button
                                type="button"
                                onClick={() => update(r.id, { itemIds: [...r.itemIds, it.id] })}
                                className="flex w-full justify-between px-2 py-1 text-left text-sm hover:bg-gray-50"
                              >
                                <span>{it.name}</span>
                                <span className="text-xs text-gray-400">{it.categoryId ? catName.get(it.categoryId) : ''}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {r.target === 'all' && <p className="mt-1 text-[11px] text-gray-400">コース・飲み放題・オプションは対象外です。</p>}
                </div>

                <div>
                  <Label htmlFor={`kind-${r.id}`}>値段の変え方</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      id={`kind-${r.id}`}
                      value={r.kind}
                      onChange={(e) => update(r.id, { kind: e.target.value as DynamicPriceRule['kind'] })}
                      className="w-36"
                    >
                      <option value="percent">± ％</option>
                      <option value="amount">± 円</option>
                      <option value="fixed">この金額にする</option>
                    </Select>
                    <Input
                      aria-label="値"
                      inputMode="numeric"
                      value={String(r.value)}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/[,，円¥%％\s]/g, ''));
                        if (Number.isFinite(n)) update(r.id, { value: Math.round(n) });
                        else if (e.target.value === '' || e.target.value === '-') update(r.id, { value: 0 });
                      }}
                      className="h-9 w-24 text-right tabular-nums"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">
                    {r.kind === 'percent' ? '-20 で2割引き、10 で1割増し' : r.kind === 'amount' ? '-100 で100円引き、50 で50円増し' : '例: 300 で全部300円'}
                  </p>
                  <label className="mt-2 flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={r.roundTo10} onChange={(e) => update(r.id, { roundTo10: e.target.checked })} />
                    10円単位に四捨五入
                  </label>
                  <p className="mt-2 text-xs text-gray-600 tabular-nums">
                    例: {yen(500)} → {yen(adjustPrice(500, r))} ／ {yen(1000)} → {yen(adjustPrice(1000, r))}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setRules((list) => [...list, newRule()])}>
          <Plus className="h-4 w-4" />
          ルール追加
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" disabled={!dirty || pending} onClick={() => setRules(JSON.parse(saved))}>
            元に戻す
          </Button>
          <Button size="sm" disabled={!dirty || pending} onClick={save}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </div>
    </div>
  );
}
