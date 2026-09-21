'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Scissors, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import {
  effectiveShow,
  groupMenuPages,
  menuPageLabel,
  MENU_BOOK_SHOW_LABELS,
  MENU_BOOK_SHOW_NOTES,
  MENU_BOOK_SHOWS,
  moveInList,
  PAGE_NAME_MAX,
  type MenuBookLunch,
  type MenuBookShow,
} from '@/lib/menu-book';
import { RESERVATION_TIME_OPTIONS } from '@/lib/reservation-time';
import { MenuItemDialog, type MenuItemRow } from './menu-item-dialog';
import { ItemOrderList, MoveButtons, SaveBar, sortItems } from './item-order-list';
import {
  saveCategoryLayout,
  saveMenuBookLunch,
  saveMenuBookPages,
  saveMenuBookPlans,
} from '@/app/app/settings/menu-book/actions';

export interface MenuBookCategoryRow {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  sortOrder: number;
  /** 全店共通のカテゴリ（並び順を変えると全店に効く） */
  shared: boolean;
  itemCount: number;
  /** ハンディの上位分類（フード／ドリンク…） */
  group: string;
  show: MenuBookShow | 'auto';
  autoShow: MenuBookShow;
}

export interface MenuBookPlanRow {
  id: string;
  name: string;
  price: number;
  /** null は「プランのときだけのカテゴリを全部出す」 */
  categoryIds: string[] | null;
}

type Tab = 'categories' | 'pages' | 'items' | 'plans' | 'lunch';

const TABS: { id: Tab; label: string }[] = [
  { id: 'categories', label: 'カテゴリの順番・出し方' },
  { id: 'pages', label: 'ページ（タブのまとめ方）' },
  { id: 'items', label: '商品の順番・入力' },
  { id: 'plans', label: 'プランで出すカテゴリ' },
  { id: 'lunch', label: 'ランチの時間' },
];

/** 出し方ごとの色（行の左端の帯） */
const SHOW_TONE: Record<MenuBookShow, string> = {
  always: 'border-l-gray-200',
  plan: 'border-l-amber-400',
  lunch: 'border-l-sky-400',
  staff: 'border-l-violet-400',
  hidden: 'border-l-red-400',
};

/* ------------------------------------------------------------ カテゴリ */

function CategoriesTab({
  storeId,
  initial,
  joinPrev,
}: {
  storeId: string;
  initial: MenuBookCategoryRow[];
  joinPrev: string[];
}) {
  const joined = new Set(joinPrev);
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const signature = (list: MenuBookCategoryRow[]) => list.map((r) => `${r.id}:${r.show}`).join('|');
  const dirty = signature(rows) !== signature(initial);

  const save = () => {
    startTransition(async () => {
      const result = await saveCategoryLayout(
        storeId,
        rows.map((r) => ({ id: r.id, show: r.show }))
      );
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('カテゴリの順番と出し方を保存しました（レジ・ハンディ・お客様QRに反映）');
      router.refresh();
    });
  };

  return (
    <div>
      <Card className="mb-4">
        <CardContent className="space-y-2 text-xs text-gray-600">
          <p className="text-sm font-semibold text-navy">出し方（ハンディ・お客様QR）</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {MENU_BOOK_SHOWS.map((s) => (
              <li key={s} className={cn('border-l-4 pl-2', SHOW_TONE[s])}>
                <b className="text-navy">{MENU_BOOK_SHOW_LABELS[s]}</b>：{MENU_BOOK_SHOW_NOTES[s]}
              </li>
            ))}
          </ul>
          <p className="pt-1 text-gray-500">
            「自動」はカテゴリ名と値段から決めます（(F) や全部0円のカテゴリ＝プランのときだけ、LUNCH＝ランチの時間だけ、フリー＝出さない）。
            並び順はレジ・ハンディ・お客様QRで共通です。レジ（POS）には出し方に関係なく全部出ます。
          </p>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">カテゴリがありません（設定 → メニュー編集 で追加）</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => {
            const eff = effectiveShow(r.show, r.autoShow);
            return (
              <li
                key={r.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-lg border border-l-4 border-gray-200 bg-white p-2 pl-3',
                  SHOW_TONE[eff]
                )}
              >
                <MoveButtons
                  index={i}
                  count={rows.length}
                  label={r.name}
                  onMove={(to) => setRows((list) => moveInList(list, i, to))}
                />
                <span className="w-6 shrink-0 text-right text-xs text-gray-400 tabular-nums">{i + 1}</span>
                <div className="min-w-[10rem] flex-1">
                  <p className={cn('font-semibold text-navy', eff === 'hidden' && 'text-gray-400 line-through')}>
                    {r.name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                    {r.group && <Badge tone="gray">{r.group}</Badge>}
                    <span>{r.itemCount}品</span>
                    {r.shared && <Badge tone="warning">全店共通</Badge>}
                    {i > 0 && joined.has(r.id) && <Badge tone="primary">↑と同じページ</Badge>}
                  </p>
                </div>
                <div className="w-full sm:w-64">
                  <Label htmlFor={`show-${r.id}`} className="sr-only">
                    {r.name}の出し方
                  </Label>
                  <Select
                    id={`show-${r.id}`}
                    value={r.show}
                    onChange={(e) => {
                      const show = e.target.value as MenuBookShow | 'auto';
                      setRows((list) => list.map((x) => (x.id === r.id ? { ...x, show } : x)));
                    }}
                  >
                    <option value="auto">自動（{MENU_BOOK_SHOW_LABELS[r.autoShow]}）</option>
                    {MENU_BOOK_SHOWS.map((s) => (
                      <option key={s} value={s}>
                        {MENU_BOOK_SHOW_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <SaveBar dirty={dirty} pending={pending} onSave={save} onReset={() => setRows(initial)} />
    </div>
  );
}

/* ------------------------------------------------------------ ページ */

/** 保存する形にそろえる（先頭のカテゴリはつなげられない。名前は今のページの先頭のものだけ） */
function normalizePages(
  categories: MenuBookCategoryRow[],
  join: readonly string[],
  names: Record<string, string>
): { joinPrev: string[]; pageNames: Record<string, string> } {
  const joinSet = new Set(join);
  const joinPrev = categories.slice(1).filter((c) => joinSet.has(c.id)).map((c) => c.id);
  const pages = groupMenuPages(categories, { joinPrev, pageNames: {} });
  const pageNames: Record<string, string> = {};
  for (const p of pages) {
    const name = (names[p.key] ?? '').replace(/\s+/g, ' ').trim();
    if (name) pageNames[p.key] = name;
  }
  return { joinPrev, pageNames };
}

function PagesTab({
  storeId,
  categories,
  joinPrev,
  pageNames,
}: {
  storeId: string;
  categories: MenuBookCategoryRow[];
  joinPrev: string[];
  pageNames: Record<string, string>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [join, setJoin] = useState<string[]>(joinPrev);
  const [names, setNames] = useState<Record<string, string>>(pageNames);
  const [pending, startTransition] = useTransition();

  const current = normalizePages(categories, join, names);
  const initial = normalizePages(categories, joinPrev, pageNames);
  const dirty = JSON.stringify(current) !== JSON.stringify(initial);
  const pages = groupMenuPages(categories, { joinPrev: current.joinPrev, pageNames: {} });
  const positionOf = new Map(categories.map((c, i) => [c.id, i]));

  const toggle = (id: string) =>
    setJoin((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const save = () => {
    startTransition(async () => {
      const result = await saveMenuBookPages(storeId, current);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('ページを保存しました（ハンディ・お客様QRに反映）');
      router.refresh();
    });
  };

  if (categories.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">カテゴリがありません（設定 → メニュー編集 で追加）</p>;
  }

  return (
    <div>
      <Card className="mb-4">
        <CardContent className="space-y-1.5 text-xs text-gray-600">
          <p className="text-sm font-semibold text-navy">ページ ＝ ハンディ・お客様QRの1つのタブ</p>
          <p>
            同じページのカテゴリは、ハンディ・お客様QRで1つのタブ（ハンディはタイル1枚）にまとめて出ます。例：SOUP・APPETIZER・SALAD。
            名前を入れなければ、カテゴリ名をつなげて出します。
          </p>
          <p>
            「↑のページに入れる」で上のページとまとめ、「ここで分ける」で新しいページにします。カテゴリの順番は「カテゴリの順番・出し方」で変えます。
            レジ（POS）はこれまで通りカテゴリごとです。
          </p>
          <p>
            プランのときだけのカテゴリ（(F) など）は、ハンディでは「2 コース・飲み放題」に、お客様QRでは飲み放題・コースの卓だけ先頭に出ます。
          </p>
        </CardContent>
      </Card>

      <ol className="space-y-3">
        {pages.map((page, pi) => {
          const placeholder = menuPageLabel(page, (c) => c.name);
          const itemCount = page.categories.reduce((n, c) => n + c.itemCount, 0);
          return (
            <li key={page.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <span className="shrink-0 text-xs font-bold text-iris">ページ {pi + 1}</span>
                <Label htmlFor={`page-name-${page.key}`} className="sr-only">
                  ページ{pi + 1}の名前
                </Label>
                <Input
                  id={`page-name-${page.key}`}
                  value={names[page.key] ?? ''}
                  maxLength={PAGE_NAME_MAX}
                  placeholder={placeholder}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNames((n) => ({ ...n, [page.key]: value }));
                  }}
                  className="h-9 min-w-[10rem] flex-1 sm:max-w-sm"
                />
                <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                  {page.categories.length}カテゴリ・{itemCount}品
                </span>
              </div>
              <ul className="divide-y divide-gray-100">
                {page.categories.map((c, ci) => {
                  const eff = effectiveShow(c.show, c.autoShow);
                  const position = positionOf.get(c.id) ?? 0;
                  return (
                    <li key={c.id} className={cn('flex flex-wrap items-center gap-2 border-l-4 px-3 py-2', SHOW_TONE[eff])}>
                      <span className="w-6 shrink-0 text-right text-xs text-gray-400 tabular-nums">{position + 1}</span>
                      <div className="min-w-[8rem] flex-1">
                        <p className={cn('font-semibold text-navy', eff === 'hidden' && 'text-gray-400 line-through')}>
                          {c.name}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {c.itemCount}品・{MENU_BOOK_SHOW_LABELS[eff]}
                        </p>
                      </div>
                      {position > 0 &&
                        (ci === 0 ? (
                          <Button variant="outline" size="sm" onClick={() => toggle(c.id)} aria-label={`${c.name}を上のページに入れる`}>
                            <Link2 className="h-3.5 w-3.5" />
                            ↑のページに入れる
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => toggle(c.id)} aria-label={`${c.name}から新しいページにする`}>
                            <Scissors className="h-3.5 w-3.5" />
                            ここで分ける
                          </Button>
                        ))}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
      <SaveBar
        dirty={dirty}
        pending={pending}
        onSave={save}
        onReset={() => {
          setJoin(joinPrev);
          setNames(pageNames);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ 商品 */

function ItemsTab({
  storeId,
  categories,
  items,
  taxRates,
}: {
  storeId: string;
  categories: MenuBookCategoryRow[];
  items: MenuItemRow[];
  taxRates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [dialog, setDialog] = useState<{ editing: MenuItemRow | null } | null>(null);
  const list = sortItems(items.filter((i) => i.categoryId === categoryId && i.status !== 'deleted'));
  const category = categories.find((c) => c.id === categoryId);
  // 追加する商品の種類はカテゴリの上位分類に合わせ、並び順はいちばん下にする
  const newItemType =
    category?.group === 'ドリンク' ? 'drink' : category?.group === 'コース' ? 'course' : category?.group === 'サービス' ? 'option' : 'food';
  const newSortOrder = list.reduce((max, i) => Math.max(max, i.sortOrder), 0) + 10;
  // 保存・追加のあとに画面の内容（並び順）を取り直したら、並び替えの状態も作り直す
  const listKey = `${categoryId}:${list.map((i) => `${i.id}.${i.sortOrder}`).join(',')}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor="menu-book-category">カテゴリ</Label>
          <Select id="menu-book-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（{c.itemCount}品）
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={() => setDialog({ editing: null })} disabled={!categoryId}>
          <Plus className="h-4 w-4" />
          商品を追加
        </Button>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        上から順にレジ・ハンディ・お客様QRに並びます。商品名・価格・英語名は「編集」から変えられます。追加した商品はいちばん下に入ります。
      </p>
      {categoryId ? (
        <ItemOrderList
          key={listKey}
          storeId={storeId}
          categoryId={categoryId}
          items={list}
          onEdit={(item) => setDialog({ editing: item })}
        />
      ) : (
        <p className="py-8 text-center text-sm text-gray-500">カテゴリがありません</p>
      )}
      {dialog && (
        <MenuItemDialog
          storeId={storeId}
          categories={categories}
          taxRates={taxRates}
          editing={dialog.editing}
          defaultCategoryId={categoryId || null}
          defaultItemType={newItemType}
          defaultSortOrder={newSortOrder}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ プラン */

function PlansTab({
  storeId,
  plans,
  planCategories,
}: {
  storeId: string;
  plans: MenuBookPlanRow[];
  planCategories: MenuBookCategoryRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState<Record<string, string[] | null>>(() =>
    Object.fromEntries(plans.map((p) => [p.id, p.categoryIds]))
  );
  const [pending, startTransition] = useTransition();
  const signature = (v: Record<string, string[] | null>) =>
    plans.map((p) => `${p.id}:${v[p.id] === null ? '*' : [...(v[p.id] ?? [])].sort().join(',')}`).join('|');
  const initialValue = Object.fromEntries(plans.map((p) => [p.id, p.categoryIds]));
  const dirty = signature(value) !== signature(initialValue);

  const save = () => {
    startTransition(async () => {
      const result = await saveMenuBookPlans(
        storeId,
        plans.map((p) => ({ planItemId: p.id, categoryIds: value[p.id] ?? null }))
      );
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('プランで出すカテゴリを保存しました');
      router.refresh();
    });
  };

  if (plans.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">
        コース・飲み放題の商品がありません（設定 → メニュー編集 で種類「コース」にした商品がここに出ます）
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        伝票にこのプランが入っているとき、ハンディ・お客様QRに出す「プランのときだけ」のカテゴリです。
        「全部」のままなら、プランのときだけのカテゴリを全部出します（例: 飲み放題A は (F) SOFT DRINK・(F) SOUR・(F) COCKTAIL だけにする）。
      </p>
      {planCategories.length === 0 && (
        <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          「プランのときだけ」のカテゴリがありません。先に「カテゴリの順番・出し方」で決めて保存してください。
        </p>
      )}
      <ul className="space-y-3">
        {plans.map((p) => {
          const selected = value[p.id];
          return (
            <li key={p.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-navy">{p.name}</p>
                <span className="text-xs text-gray-500 tabular-nums">{yen(p.price)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label={`${p.name}で出すカテゴリ`}>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`plan-${p.id}`}
                    checked={selected === null}
                    onChange={() => setValue((v) => ({ ...v, [p.id]: null }))}
                  />
                  全部（プランのときだけのカテゴリを全部出す）
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`plan-${p.id}`}
                    checked={selected !== null}
                    disabled={planCategories.length === 0}
                    onChange={() => setValue((v) => ({ ...v, [p.id]: v[p.id] ?? [] }))}
                  />
                  選んだカテゴリだけ
                </label>
              </div>
              {selected !== null && (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {planCategories.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded-md border border-gray-100 px-2 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={(e) =>
                          setValue((v) => {
                            const cur = v[p.id] ?? [];
                            return {
                              ...v,
                              [p.id]: e.target.checked ? [...cur, c.id] : cur.filter((id) => id !== c.id),
                            };
                          })
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <SaveBar dirty={dirty} pending={pending} onSave={save} onReset={() => setValue(initialValue)} />
    </div>
  );
}

/* ------------------------------------------------------------ ランチ */

function LunchTab({ storeId, lunch }: { storeId: string; lunch: MenuBookLunch }) {
  const router = useRouter();
  const { toast } = useToast();
  const [start, setStart] = useState(lunch.start);
  const [end, setEnd] = useState(lunch.end);
  const [pending, startTransition] = useTransition();
  const dirty = start !== lunch.start || end !== lunch.end;

  const save = () => {
    startTransition(async () => {
      const result = await saveMenuBookLunch(storeId, start, end);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('ランチの時間を保存しました');
      router.refresh();
    });
  };

  return (
    <div className="max-w-md">
      <p className="mb-3 text-xs text-gray-500">
        「ランチの時間だけ」のカテゴリ（TODAY&apos;S LUNCH・Spice Lunch・(L) … など）を、ハンディ・お客様QRに出す時間帯です。
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="lunch-start">開始</Label>
          <Select id="lunch-start" value={start} onChange={(e) => setStart(e.target.value)}>
            {RESERVATION_TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="lunch-end">終了</Label>
          <Select id="lunch-end" value={end} onChange={(e) => setEnd(e.target.value)}>
            {RESERVATION_TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <SaveBar dirty={dirty} pending={pending} onSave={save} onReset={() => { setStart(lunch.start); setEnd(lunch.end); }} />
    </div>
  );
}

/* ------------------------------------------------------------ 画面 */

/**
 * メニューブック（店長以上）。カテゴリの順番・ハンディ／お客様QRでの出し方、ページ（タブのまとめ方）、
 * 商品の順番と入力、プランで出すカテゴリ、ランチの時間。保存するとレジ・ハンディ・お客様QRにそのまま反映される。
 */
export function MenuBookEditor({
  storeId,
  categories,
  items,
  plans,
  lunch,
  joinPrev,
  pageNames,
  taxRates,
}: {
  storeId: string;
  categories: MenuBookCategoryRow[];
  items: MenuItemRow[];
  plans: MenuBookPlanRow[];
  lunch: MenuBookLunch;
  joinPrev: string[];
  pageNames: Record<string, string>;
  taxRates: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<Tab>('categories');
  const categoryKey = categories.map((c) => `${c.id}:${c.show}:${c.sortOrder}`).join('|');
  const pagesKey = `${joinPrev.join(',')}#${JSON.stringify(pageNames)}#${categoryKey}`;
  const planCategories = categories.filter((c) => effectiveShow(c.show, c.autoShow) === 'plan');
  const planKey = plans.map((p) => `${p.id}:${p.categoryIds?.join(',') ?? '*'}`).join('|');

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'min-h-10 shrink-0 rounded-md px-3 text-sm font-semibold whitespace-nowrap',
              tab === t.id ? 'bg-white text-navy shadow-sm' : 'text-gray-500'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'categories' && (
        <CategoriesTab key={categoryKey} storeId={storeId} initial={categories} joinPrev={joinPrev} />
      )}
      {tab === 'pages' && (
        <PagesTab key={pagesKey} storeId={storeId} categories={categories} joinPrev={joinPrev} pageNames={pageNames} />
      )}
      {tab === 'items' && <ItemsTab storeId={storeId} categories={categories} items={items} taxRates={taxRates} />}
      {tab === 'plans' && (
        <PlansTab key={`${planKey}#${categoryKey}`} storeId={storeId} plans={plans} planCategories={planCategories} />
      )}
      {tab === 'lunch' && <LunchTab key={`${lunch.start}-${lunch.end}`} storeId={storeId} lunch={lunch} />}
    </div>
  );
}
