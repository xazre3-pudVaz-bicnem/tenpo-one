'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, ChevronLeft, ChevronRight, Printer, Save } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { saveDailyBudgets } from '@/app/app/budgets/daily-actions';
import {
  WEEKDAY_JA,
  monthDays,
  monthTotal,
  shiftMonth,
  weekdayOf,
  withTax,
  withoutTax,
  type DailyBudgetMap,
} from '@/lib/daily-budget';

/**
 * 日別予算登録（2026-09-25 店舗要望「レジの見本と同じ画面に」）。
 * 左が日付の一覧、右がテンキー。金額は税込で保存し、税抜表示は入力の切り替えだけ。
 */

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

function draftKey(storeId: string, month: string) {
  return `tenpo_daily_budget_draft:${storeId}:${month}`;
}

export function DailyBudgetBoard({
  storeId,
  storeName,
  month,
  initial,
  canEdit,
}: {
  storeId: string;
  storeName: string;
  month: string;
  initial: DailyBudgetMap;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<DailyBudgetMap>(initial);
  const [taxIncluded, setTaxIncluded] = useState(true);
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => monthDays(month), [month]);
  const [active, setActive] = useState<string>(days[0] ?? '');
  const [entry, setEntry] = useState<string>('');

  // 月が変わったら入れ直す
  useEffect(() => {
    setValues(initial);
    setActive(monthDays(month)[0] ?? '');
    setEntry('');
  }, [initial, month]);

  const total = monthTotal(values);
  const shown = (v: number) => (taxIncluded ? v : withoutTax(v));

  const commit = (date: string, raw: string) => {
    const n = Number(raw);
    setValues((prev) => {
      const next = { ...prev };
      if (!raw || !Number.isFinite(n) || n <= 0) delete next[date];
      else next[date] = taxIncluded ? Math.round(n) : withTax(Math.round(n));
      return next;
    });
  };

  const selectDay = (date: string) => {
    if (active && entry) commit(active, entry);
    setActive(date);
    setEntry('');
  };

  const press = (key: string) => {
    if (!canEdit) return;
    if (key === 'C') {
      setEntry('');
      setValues((prev) => {
        const next = { ...prev };
        delete next[active];
        return next;
      });
      return;
    }
    if (key === 'same') {
      const idx = days.indexOf(active);
      const prevDate = days[idx - 1];
      const v = prevDate ? values[prevDate] : undefined;
      if (v) {
        setValues((p) => ({ ...p, [active]: v }));
        setEntry('');
        if (days[idx + 1]) setActive(days[idx + 1]);
      }
      return;
    }
    if (key === 'OK') {
      if (entry) commit(active, entry);
      setEntry('');
      const idx = days.indexOf(active);
      if (days[idx + 1]) setActive(days[idx + 1]);
      return;
    }
    setEntry((e) => (e + key).replace(/^0+(?=\d)/, '').slice(0, 9));
  };

  /** その月すべてに同じ金額を入れる */
  const fillAll = () => {
    if (!canEdit) return;
    const raw = entry || String(values[active] ?? '');
    const n = Number(raw);
    if (!n) {
      toast('先に金額を入れてください', 'error');
      return;
    }
    const v = taxIncluded ? Math.round(n) : withTax(Math.round(n));
    const next: DailyBudgetMap = {};
    for (const d of days) next[d] = v;
    setValues(next);
    setEntry('');
  };

  const saveDraft = () => {
    try {
      window.localStorage.setItem(draftKey(storeId, month), JSON.stringify(values));
      toast('一時保存しました（この端末だけ）');
    } catch {
      toast('一時保存できませんでした', 'error');
    }
  };

  const handleSave = async () => {
    if (!canEdit || busy) return;
    const body = entry ? { ...values, [active]: taxIncluded ? Number(entry) : withTax(Number(entry)) } : values;
    setBusy(true);
    try {
      const res = await saveDailyBudgets(storeId, month, body);
      if (res.error) toast(res.error, 'error');
      else {
        setValues(body);
        setEntry('');
        try {
          window.localStorage.removeItem(draftKey(storeId, month));
        } catch {
          /* 保存できなくても本体は保存済み */
        }
        toast(`保存しました（${month.replace('-', '/')} 合計 ${yen(res.total ?? 0)}）`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const go = (n: number) => {
    const m = shiftMonth(month, n);
    router.push(`/app/budgets/daily?month=${m}`);
  };

  const keypad = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00'];

  return (
    <div className="space-y-3 print:space-y-1">
      {/* 月の切り替え・税抜税込・PDF */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go(-1)} className="tap3d rounded-xl bg-white px-3 py-2 text-sm font-bold text-plum print:hidden">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-[17px] font-bold text-plum">
          <Calendar className="h-[18px] w-[18px]" />
          {month.replace('-', '年')}月
        </span>
        <button type="button" onClick={() => go(1)} className="tap3d rounded-xl bg-white px-3 py-2 text-sm font-bold text-plum print:hidden">
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="ml-1 text-sm font-semibold text-gray-600">{storeName}</span>

        <div className="ml-auto flex items-center gap-2 print:hidden">
          <div className="inline-flex overflow-hidden rounded-xl bg-white p-1">
            {[
              { k: true, ja: '税込', en: 'Incl. tax' },
              { k: false, ja: '税抜', en: 'Excl. tax' },
            ].map((o) => (
              <button
                key={String(o.k)}
                type="button"
                onClick={() => setTaxIncluded(o.k)}
                className={`tap3d rounded-lg px-3 py-1.5 text-[13px] font-bold ${
                  taxIncluded === o.k ? 'bg-plum text-white' : 'text-gray-600'
                }`}
              >
                {o.ja}
                <span className="ml-1 text-[10px] font-semibold opacity-70">{o.en}</span>
              </button>
            ))}
          </div>
          <span className="rounded-full bg-iris/12 px-3 py-1.5 text-[12px] font-bold text-iris">消費税 10%</span>
          <button
            type="button"
            onClick={() => window.print()}
            className="tap3d inline-flex items-center gap-1.5 rounded-xl bg-plum px-4 py-2 text-[13px] font-bold text-white"
          >
            <Printer className="h-4 w-4" />
            PDFで出す
            <span className="text-[10px] font-semibold opacity-70">Print / PDF</span>
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        {/* 日付の一覧 */}
        <div className="overflow-hidden rounded-2xl bg-white">
          <div className="grid grid-cols-[72px_1fr_auto] items-center gap-2 border-b border-gray-100 px-4 py-2 text-[12px] font-bold text-gray-500">
            <span>日付</span>
            <span>曜日</span>
            <span>売上予算（{taxIncluded ? '税込' : '税抜'}）</span>
          </div>
          <div className="max-h-[62vh] overflow-auto print:max-h-none">
            {days.map((d) => {
              const w = weekdayOf(d);
              const on = d === active;
              const v = values[d] ?? 0;
              const text = on && entry ? entry : v ? String(shown(v)) : '';
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => selectDay(d)}
                  className={`grid w-full grid-cols-[72px_1fr_auto] items-center gap-2 border-b border-gray-100 px-4 py-2 text-left ${
                    on ? 'bg-iris/10' : ''
                  }`}
                >
                  <span className={`text-[15px] font-bold ${w === 0 ? 'text-danger' : w === 6 ? 'text-iris' : 'text-plum'}`}>
                    {Number(d.slice(8))}
                  </span>
                  <span className={`text-[13px] font-semibold ${w === 0 ? 'text-danger' : w === 6 ? 'text-iris' : 'text-gray-500'}`}>
                    {WEEKDAY_JA[w]}
                  </span>
                  <span
                    className={`min-w-[132px] rounded-lg px-3 py-1.5 text-right text-[17px] font-bold tabular-nums ${
                      on ? 'bg-white text-plum ring-2 ring-iris' : 'bg-gray-50 text-plum'
                    }`}
                  >
                    {text ? yen(Number(text)) : <span className="text-gray-300">未入力</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t-2 border-plum/10 px-4 py-3">
            <span className="text-[13px] font-bold text-gray-500">
              月合計 <span className="ml-1 text-[10px] font-semibold">MONTH TOTAL</span>
            </span>
            <span className="text-[22px] font-extrabold text-plum tabular-nums">{yen(shown(total))}</span>
          </div>
        </div>

        {/* テンキー */}
        <div className="space-y-2 rounded-2xl bg-white p-3 print:hidden">
          <div className="rounded-xl bg-plum px-4 py-3 text-right">
            <div className="text-[11px] font-semibold text-white/70">
              {active ? `${Number(active.slice(5, 7))}/${Number(active.slice(8))}（${WEEKDAY_JA[weekdayOf(active)]}）` : ''}
            </div>
            <div className="text-[26px] font-extrabold text-white tabular-nums">
              {yen(Number(entry || (values[active] ? shown(values[active]) : 0)))}
            </div>
          </div>
          <button type="button" onClick={() => press('same')} className="tap3d w-full rounded-xl bg-iris/12 py-2.5 text-[14px] font-bold text-iris">
            前日と同じ<span className="ml-1 text-[10px] font-semibold opacity-70">Same as previous</span>
          </button>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => press('C')} className="tap3d rounded-xl bg-danger/12 py-3 text-[18px] font-extrabold text-danger">
              C
            </button>
            <button type="button" onClick={fillAll} className="tap3d col-span-2 rounded-xl bg-gray-100 py-3 text-[13px] font-bold text-plum">
              一括入力<span className="ml-1 text-[10px] font-semibold opacity-60">Fill month</span>
            </button>
            {keypad.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => press(k)}
                className="tap3d rounded-xl bg-gray-50 py-4 text-[20px] font-extrabold text-plum"
              >
                {k}
              </button>
            ))}
            <button type="button" onClick={() => press('OK')} className="tap3d rounded-xl bg-plum py-4 text-[18px] font-extrabold text-white">
              OK
            </button>
          </div>
          <button type="button" onClick={saveDraft} className="tap3d w-full rounded-xl bg-gray-100 py-2.5 text-[13px] font-bold text-plum">
            一時保存<span className="ml-1 text-[10px] font-semibold opacity-60">Keep draft</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canEdit || busy}
            className="tap3d inline-flex w-full items-center justify-center gap-2 rounded-xl bg-plum py-3.5 text-[16px] font-extrabold text-white disabled:opacity-50"
          >
            <Save className="h-[18px] w-[18px]" />
            {busy ? '保存中…' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  );
}
