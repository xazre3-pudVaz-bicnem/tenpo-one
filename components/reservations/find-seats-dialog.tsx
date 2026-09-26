'use client';

import { useState, useTransition } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { getOccupiedTableIds } from '@/app/app/reservations/actions';
import { suggestTables, type TableLike } from '@/lib/reservations';
import { RESERVATION_TIME_STEP, STAY_MINUTE_OPTIONS, stayOptionLabel } from '@/lib/reservation-time';
import { cn } from '@/lib/utils';

export interface FindSeatsTable {
  id: string;
  name: string;
  capacityMin: number;
  capacityMax: number;
}

const QUICK_TIMES = ['11:30', '12:00', '13:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

interface SearchResult {
  key: string;
  date: string;
  time: string;
  stay: number;
  partySize: number;
  free: FindSeatsTable[];
  busyCount: number;
  suggestion: string | null;
}

function toIso(date: string, time: string, addMinutes = 0): string {
  const d = new Date(`${date}T${time}:00+09:00`);
  return new Date(d.getTime() + addMinutes * 60000).toISOString();
}

/**
 * 空席検索。日時・人数・滞在時間を指定し、その時間帯に割当のないテーブルを一覧する
 * （同時間帯の割当は既存の getOccupiedTableIds で取得。清掃バッファも考慮される）。
 */
export function FindSeatsDialog({
  storeId,
  tables,
  defaultDate,
  className,
  children,
}: {
  storeId: string;
  tables: FindSeatsTable[];
  defaultDate: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('19:00');
  const [partySize, setPartySize] = useState(2);
  const [stay, setStay] = useState(120);
  const [result, setResult] = useState<SearchResult | null>(null);

  const search = (t = time) => {
    if (!date || !/^\d{2}:\d{2}$/.test(t)) return;
    startTransition(async () => {
      try {
        const occupied = new Set(await getOccupiedTableIds(storeId, toIso(date, t), toIso(date, t, stay)));
        const freeTables = tables.filter((x) => !occupied.has(x.id));
        const fit = freeTables.filter((x) => x.capacityMax >= partySize);
        const likes: TableLike[] = freeTables.map((x) => ({
          id: x.id,
          name: x.name,
          capacityMin: x.capacityMin,
          capacityMax: x.capacityMax,
          isActive: true,
          isOccupied: false,
        }));
        const suggestion = suggestTables(likes, partySize)[0];
        setResult({
          key: `${date}|${t}|${partySize}|${stay}`,
          date,
          time: t,
          stay,
          partySize,
          free: fit,
          busyCount: occupied.size,
          suggestion: suggestion?.label ?? null,
        });
      } catch (e) {
        toast(e instanceof Error ? e.message : '空席の確認に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="空席検索" wide>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="fs-date">日付</Label>
            <Input id="fs-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fs-time">時間</Label>
            <Input id="fs-time" type="time" step={RESERVATION_TIME_STEP * 60} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fs-party">人数</Label>
            <Input
              id="fs-party"
              type="number"
              min={1}
              value={partySize}
              onChange={(e) => setPartySize(Math.max(1, Math.trunc(Number(e.target.value)) || 1))}
            />
          </div>
          <div>
            <Label htmlFor="fs-stay">滞在時間</Label>
            <Select id="fs-stay" value={stay} onChange={(e) => setStay(Number(e.target.value))}>
              {STAY_MINUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {stayOptionLabel(m)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-ink-3">時間帯</span>
          {QUICK_TIMES.map((t) => (
            <button
              key={t}
              type="button"
              disabled={pending}
              onClick={() => {
                setTime(t);
                search(t);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-[13px] font-semibold tabular-nums transition-colors',
                time === t ? 'on-sunset border-transparent text-white' : 'border-line bg-white text-ink-2 hover:bg-lilac-soft'
              )}
            >
              {t}
            </button>
          ))}
          <Button className="ml-auto" onClick={() => search()} disabled={pending || !date || tables.length === 0}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            検索
          </Button>
        </div>

        <div className="mt-4">
          {tables.length === 0 ? (
            <EmptyState title="テーブルが登録されていません" description="設定 > テーブル管理からテーブルを登録してください。" />
          ) : !result ? (
            <p className="rounded-xl bg-lilac-soft px-4 py-6 text-center text-sm text-ink-3">
              日時と人数を選んで「検索」を押すと、空いているテーブルを表示します。
            </p>
          ) : (
            <div key={result.key}>
              <p className="mb-2 text-sm font-semibold text-ink">
                <span className="tabular-nums">
                  {result.date.slice(5).replace('-', '/')} {result.time}〜（{result.stay}分）・{result.partySize}名
                </span>
                <span className="ml-2 text-xs font-medium text-ink-3">
                  空き {result.free.length}卓 ／ 使用・予約済み {result.busyCount}卓
                </span>
              </p>
              {result.free.length === 0 ? (
                <p className="rounded-xl bg-danger-soft px-4 py-4 text-sm font-semibold text-danger">
                  {result.partySize}名で座れる空きテーブルがありません。
                  {result.suggestion && <span className="ml-1">テーブル結合なら「{result.suggestion}」が候補です。</span>}
                </p>
              ) : (
                <>
                  {result.suggestion && (
                    <p className="mb-2 text-xs text-ink-2">
                      おすすめ: <Badge tone="primary">{result.suggestion}</Badge>
                    </p>
                  )}
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {result.free.map((t) => (
                      <li key={t.id} className="rounded-xl border border-line bg-white px-3 py-2.5">
                        <p className="text-sm font-extrabold text-royal">{t.name}</p>
                        <p className="text-xs text-ink-3 tabular-nums">
                          {t.capacityMin}〜{t.capacityMax}名席
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            閉じる
          </Button>
        </div>
      </Dialog>
    </>
  );
}
