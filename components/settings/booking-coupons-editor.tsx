'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { couponLabel, MAX_BOOKING_COUPONS, MAX_COUPON_TITLE, type BookingCoupon, type CouponUnit } from '@/lib/booking-coupons';
import { saveBookingCoupons } from '@/app/app/settings/store/coupon-actions';

interface Row {
  key: string;
  id: string | null;
  title: string;
  /** 入力中の数（空なら割引なし） */
  value: string;
  unit: CouponUnit;
}

const toRow = (c: BookingCoupon): Row => ({
  key: c.id,
  id: c.id,
  title: c.title,
  value: c.value == null ? '' : String(c.value),
  unit: c.unit,
});

/**
 * 当店のクーポン（予約ページ・予約QRカード・店舗名刺に出る。お客様はご予約のときに選べる）。
 * 内容を書いて、横の OFF で「%」か「¥」を選ぶ（5 → 5%OFF、500 → ¥500OFF）。割引なしの文だけでもよい
 * （例: 10名様以上で幹事様1名無料／ここからご予約のみのコース）。2026-09-30 Ronnie。
 */
export function BookingCouponsEditor({ storeId, initial }: { storeId: string; initial: BookingCoupon[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(initial.map(toRow));
  const [seq, setSeq] = useState(0);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const add = () => {
    if (rows.length >= MAX_BOOKING_COUPONS) return;
    setRows((prev) => [...prev, { key: `new-${seq}`, id: null, title: '', value: '', unit: 'percent' }]);
    setSeq((n) => n + 1);
  };

  const save = () =>
    startTransition(async () => {
      const res = await saveBookingCoupons(
        storeId,
        rows
          .filter((r) => r.title.trim() || r.value.trim())
          .map((r) => ({
            id: r.id,
            title: r.title,
            value: r.value.trim() === '' ? null : Number(r.value.replace(/[^\d]/g, '')),
            unit: r.unit,
          }))
      );
      if (res.error) {
        toast(res.error, 'error');
        return;
      }
      toast('クーポンを保存しました');
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2 text-left sm:items-end">
      {rows.length === 0 && (
        <p className="text-[13px] font-normal text-ink-3">まだありません。「クーポンを追加」から入れてください</p>
      )}
      {rows.map((r) => {
        const preview = couponLabel({
          title: r.title,
          value: r.value.trim() === '' ? null : Number(r.value.replace(/[^\d]/g, '')) || null,
          unit: r.unit,
        });
        return (
          <div key={r.key} className="w-full max-w-[560px] rounded-xl border border-line bg-white p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                value={r.title}
                onChange={(e) => update(r.key, { title: e.target.value.slice(0, MAX_COUPON_TITLE) })}
                placeholder="例: アラカルト／10名様以上で幹事様1名無料"
                aria-label="クーポンの内容"
                disabled={pending}
                className="h-10 min-w-0 flex-1 rounded-lg border border-line px-2.5 text-[13px] font-normal text-ink focus:border-iris focus:outline-2 focus:outline-iris/30"
              />
              <input
                value={r.value}
                onChange={(e) => update(r.key, { value: e.target.value.replace(/[^\d]/g, '').slice(0, 7) })}
                inputMode="numeric"
                placeholder="数"
                aria-label="割引の数"
                disabled={pending}
                className="h-10 w-20 rounded-lg border border-line px-2 text-right text-[13px] font-bold text-ink tabular-nums focus:border-iris focus:outline-2 focus:outline-iris/30"
              />
              {/* OFF：% か ¥ */}
              <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="割引の単位">
                {(['percent', 'yen'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => update(r.key, { unit: u })}
                    disabled={pending}
                    aria-pressed={r.unit === u}
                    className={cn(
                      'h-10 w-11 text-[13px] font-bold',
                      r.unit === u ? 'bg-iris text-white' : 'bg-white text-ink-2 hover:bg-lilac-soft'
                    )}
                  >
                    {u === 'percent' ? '%' : '¥'}
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-bold text-ink-3">OFF</span>
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                disabled={pending}
                aria-label="このクーポンを消す"
                className="grid h-10 w-10 place-items-center rounded-lg text-ink-3 hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {preview && (
              <p className="mt-1 flex items-center gap-1 text-[12px] font-bold text-royal">
                <Ticket className="h-3.5 w-3.5" aria-hidden />
                {preview}
              </p>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={add}
          disabled={pending || rows.length >= MAX_BOOKING_COUPONS}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 text-[13px] font-bold text-royal hover:bg-lilac-soft disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          クーポンを追加
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="on-brand inline-flex h-9 items-center gap-1 rounded-lg px-4 text-[13px] font-bold text-white disabled:opacity-60"
        >
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
