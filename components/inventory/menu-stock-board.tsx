'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Printer, Save } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * 在庫管理（本日の残り数）。2026-09-25 店舗要望「レジの在庫管理と同じ画面に」。
 *
 * 左がカテゴリ（ページごとにまとめる）、右がその中の商品。
 * 商品ごとに トグル（在庫管理する／しない）・− ＋・残り数 を出し、「登録」でまとめて保存する。
 * 残り数を入れると、その数だけ売れた時点でレジ・ハンディ・お客様QRが自動で売切になる。
 */

export interface StockGroup {
  key: string;
  name: string;
  categories: { id: string; name: string }[];
}

export interface StockItem {
  id: string;
  name: string;
  categoryId: string | null;
  /** 設定した本日の食数（null＝在庫管理しない） */
  limit: number | null;
  /** 本日すでに売れた数 */
  sold: number;
}

/** 画面で持つ1品の状態（残り数で考える。保存するときに 売れた数＋残り＝食数 に直す） */
interface Draft {
  on: boolean;
  remaining: number;
}

export function MenuStockBoard({
  storeId,
  groups,
  items,
  saveAction,
  printAction,
}: {
  storeId: string;
  groups: StockGroup[];
  items: StockItem[];
  saveAction: (
    storeId: string,
    entries: { itemId: string; limit: number | null }[]
  ) => Promise<{ error?: string; saved?: number }>;
  printAction: (
    storeId: string,
    lines: { name: string; remaining: number }[]
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const firstCategory = groups.flatMap((g) => g.categories)[0]?.id ?? '';
  const [activeCategory, setActiveCategory] = useState(firstCategory);

  const initial = useMemo(() => {
    const map: Record<string, Draft> = {};
    for (const i of items) {
      map[i.id] = { on: i.limit !== null, remaining: i.limit !== null ? Math.max(0, i.limit - i.sold) : 0 };
    }
    return map;
  }, [items]);
  const [draft, setDraft] = useState<Record<string, Draft>>(initial);

  const soldById = useMemo(() => new Map(items.map((i) => [i.id, i.sold])), [items]);
  const shown = items.filter((i) => i.categoryId === activeCategory);

  const changed = items.filter((i) => {
    const d = draft[i.id] ?? initial[i.id];
    const before = initial[i.id];
    return !!d && !!before && (d.on !== before.on || (d.on && d.remaining !== before.remaining));
  });

  const set = (id: string, patch: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { on: false, remaining: 0 }), ...patch } }));

  const save = () => {
    if (changed.length === 0) {
      toast('変更はありません');
      return;
    }
    startTransition(async () => {
      const entries = changed.map((i) => {
        const d = draft[i.id];
        return { itemId: i.id, limit: d.on ? (soldById.get(i.id) ?? 0) + d.remaining : null };
      });
      const res = await saveAction(storeId, entries);
      if (res.error) toast(res.error, 'error');
      else {
        toast(`${res.saved ?? entries.length}品を登録しました`);
        router.refresh();
      }
    });
  };

  const print = () => {
    const lines = items
      .filter((i) => draft[i.id]?.on)
      .map((i) => ({ name: i.name, remaining: draft[i.id]?.remaining ?? 0 }));
    if (lines.length === 0) {
      toast('在庫管理している商品がありません', 'error');
      return;
    }
    startTransition(async () => {
      const res = await printAction(storeId, lines);
      toast(res.ok ? '在庫を印刷します' : (res.error ?? '在庫の印刷に失敗しました'), res.ok ? 'success' : 'error');
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* 左: ページ（フード・ドリンク…）ごとのカテゴリ */}
        <nav className="max-h-[38vh] w-full shrink-0 overflow-y-auto rounded-2xl border border-line bg-white lg:max-h-none lg:w-[280px]">
          {groups.map((g) => (
            <div key={g.key}>
              <p className="bg-royal px-4 py-2.5 text-[15px] font-bold text-white">{g.name}</p>
              {g.categories.map((c) => {
                const on = activeCategory === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveCategory(c.id)}
                    className={cn(
                      'tap3d flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left text-[15px] font-bold last:border-b-0',
                      on ? 'bg-lilac-soft text-royal' : 'text-ink-2'
                    )}
                  >
                    {c.name}
                    <span className="text-ink-3">›</span>
                  </button>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && <p className="p-4 text-sm text-ink-3">カテゴリがありません</p>}
        </nav>

        {/* 右: その中の商品（トグル・− ＋・残り） */}
        <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-white">
          {shown.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-3">このカテゴリに商品がありません</p>
          ) : (
            shown.map((i) => {
              const d = draft[i.id] ?? { on: false, remaining: 0 };
              return (
                <div
                  key={i.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-navy">{i.name}</span>

                  {/* 在庫管理する／しない */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={d.on}
                    aria-label={`${i.name} の在庫管理`}
                    onClick={() => set(i.id, { on: !d.on })}
                    className={cn(
                      'relative h-8 w-14 shrink-0 rounded-full transition-colors',
                      d.on ? 'bg-iris' : 'bg-gray-200'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all',
                        d.on ? 'left-7' : 'left-1'
                      )}
                    />
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="残りを1減らす"
                      disabled={!d.on || d.remaining <= 0}
                      onClick={() => set(i.id, { remaining: Math.max(0, d.remaining - 1) })}
                      className="tap3d flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-lilac-soft text-xl font-bold text-royal disabled:opacity-30"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label="残りを1増やす"
                      disabled={!d.on}
                      onClick={() => set(i.id, { remaining: Math.min(9999, d.remaining + 1) })}
                      className="tap3d flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-lilac-soft text-xl font-bold text-royal disabled:opacity-30"
                    >
                      ＋
                    </button>
                  </div>

                  <label className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[13px] font-bold text-ink-2">残り</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={9999}
                      disabled={!d.on}
                      value={d.on ? d.remaining : ''}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        set(i.id, { remaining: Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.trunc(n))) : 0 });
                      }}
                      className="h-10 w-20 rounded-xl border border-line bg-white px-2 text-center text-[16px] font-bold tabular-nums text-navy disabled:bg-gray-50 disabled:text-ink-3"
                    />
                  </label>

                  {i.sold > 0 && (
                    <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">本日{i.sold}食</span>
                  )}
                </div>
              );
            })
          )}
        </section>
      </div>

      {/* 下: 在庫印刷（左）・登録（右） */}
      <div className="flex shrink-0 items-center justify-between gap-3">
        <button
          type="button"
          onClick={print}
          disabled={pending}
          className="tap3d inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-[15px] font-bold text-royal disabled:opacity-50"
        >
          <Printer className="h-[18px] w-[18px]" />
          在庫印刷
          <span className="text-[10px] font-semibold text-ink-3">Print</span>
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="tap3d inline-flex h-12 items-center gap-2 rounded-xl bg-royal px-8 text-[16px] font-extrabold text-white disabled:opacity-50"
        >
          <Save className="h-[18px] w-[18px]" />
          {pending ? '保存中…' : `登録${changed.length > 0 ? `（${changed.length}）` : ''}`}
        </button>
      </div>
    </div>
  );
}
