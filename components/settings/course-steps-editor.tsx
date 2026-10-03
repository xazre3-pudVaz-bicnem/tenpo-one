'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { moveInList } from '@/lib/menu-book';
import { ordinalEn } from '@/lib/kitchen-ticket';
import { MAX_COURSE_STEPS } from '@/lib/course-steps';
import { saveCourseSteps } from '@/app/app/settings/menu/actions';
import { MoveButtons } from './item-order-list';

/** コースの料理に選べる商品（その店のメニューにある、コース以外の商品） */
export interface CourseDishOption {
  id: string;
  name: string;
  nameEn: string;
  categoryName: string;
  hidden: boolean;
}

/**
 * コースの料理（出す順）の編集（設定 > プラン > コースの編集）。
 * 店のメニューにある商品から選んで、1番目・2番目…の順に並べる。保存すると、コースを注文したときに
 * 厨房伝票へ「1st 前菜 / 2nd サラダ …」の順に出る。店によって登録してある料理が違っても、あるものから選べば動く。
 */
export function CourseStepsEditor({
  storeId,
  courseId,
  initialIds,
  options,
}: {
  storeId: string;
  courseId: string;
  initialIds: string[];
  options: CourseDishOption[];
}) {
  const { toast } = useToast();
  const [ids, setIds] = useState<string[]>(initialIds);
  const [saved, setSaved] = useState<string[]>(initialIds);
  const [q, setQ] = useState('');
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const dirty = ids.join('|') !== saved.join('|');
  const full = ids.length >= MAX_COURSE_STEPS;

  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const chosen = new Set(ids);
    return options
      .filter((o) => !chosen.has(o.id) && `${o.name}${o.nameEn}${o.categoryName}`.toLowerCase().includes(term))
      .slice(0, 12);
  }, [options, q, ids]);

  const save = () => {
    startTransition(async () => {
      const result = await saveCourseSteps(storeId, courseId, ids);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      setSaved(ids);
      toast(ids.length > 0 ? 'コースの料理を保存しました（厨房伝票に順番どおり出ます）' : 'コースの料理を空にしました（コース名だけ出ます）');
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div>
        <p className="text-sm font-semibold text-navy">
          コースの料理（出す順）
          <span className="ml-2 text-xs font-normal text-gray-500">Course dishes in serving order</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          メニューにある商品から選んで、出す順に並べます。このコースを注文すると、厨房伝票に 1st・2nd・3rd … と順番に出ます
          （コースのカテゴリのプリンターに出ます）。何も入れないときは、これまでどおりコース名だけ出ます。
        </p>
      </div>

      {ids.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-4 text-center text-xs text-gray-500">
          まだ料理が入っていません。下の検索から追加してください。
        </p>
      ) : (
        <ol className="space-y-1.5">
          {ids.map((id, i) => {
            const o = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white p-2">
                <span className="w-12 shrink-0 text-center text-sm font-bold text-primary tabular-nums">{ordinalEn(i + 1)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy">{o ? o.name : '（メニューから無くなった商品）'}</p>
                  {o && (
                    <p className="truncate text-[11px] text-gray-500">
                      {o.categoryName}
                      {o.nameEn ? ` ・ ${o.nameEn}` : ''}
                      {o.hidden ? ' ・ 非表示の商品' : ''}
                    </p>
                  )}
                </div>
                <MoveButtons index={i} count={ids.length} label={o?.name ?? '料理'} onMove={(to) => setIds((cur) => moveInList(cur, i, to))} />
                <button
                  type="button"
                  onClick={() => setIds((cur) => cur.filter((x) => x !== id))}
                  aria-label={`${o?.name ?? '料理'}を外す`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-danger-soft hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {options.length === 0 ? (
        <p className="text-xs text-warning">
          この店のメニューに料理がまだありません。先に{' '}
          <Link href="/app/settings/menu" className="font-semibold underline">
            設定 &gt; メニュー
          </Link>{' '}
          で料理を登録すると、ここから選べます。
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={full ? `料理は${MAX_COURSE_STEPS}品までです` : 'メニューから料理を探す（名前・英語名・カテゴリ）'}
              disabled={full}
              className="pl-9"
              aria-label="コースに入れる料理を探す"
            />
          </div>
          {q.trim() && candidates.length === 0 && <p className="text-xs text-gray-500">見つかりません（すでに入っている料理は出ません）</p>}
          {candidates.length > 0 && (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-gray-200 bg-white p-1">
              {candidates.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setIds((cur) => [...cur, o.id]);
                      setQ('');
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-gray-50 active:bg-gray-100"
                  >
                    <Plus className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-navy">{o.name}</span>
                      <span className="block truncate text-[11px] text-gray-500">
                        {o.categoryName}
                        {o.nameEn ? ` ・ ${o.nameEn}` : ''}
                        {o.hidden ? ' ・ 非表示の商品' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <span className={dirty ? 'mr-auto text-xs font-medium text-warning' : 'mr-auto text-xs text-gray-400'}>
          {dirty ? '保存していない変更があります' : ids.length > 0 ? `${ids.length}品・保存済み` : '変更はありません'}
        </span>
        <Button size="sm" variant="outline" onClick={() => setIds(saved)} disabled={!dirty || pending}>
          元に戻す
        </Button>
        <Button size="sm" onClick={save} disabled={!dirty || pending}>
          {pending ? '保存中…' : '料理の順番を保存'}
        </Button>
      </div>
    </div>
  );
}
