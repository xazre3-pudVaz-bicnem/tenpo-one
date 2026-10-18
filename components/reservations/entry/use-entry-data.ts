'use client';

import { useEffect, useState } from 'react';
import { getReservationEntryData } from '@/app/app/reservations/actions';
import type { ReservationEntryData } from '@/lib/reservation-entry-server';

const EMPTY: ReservationEntryData = { tables: [], booked: [], defaultStay: 120, keywords: [], clerks: [], courseDurations: {} };

/**
 * 予約登録のデータ（その日の卓と予約・確保時間・キーワード・担当者）を読む。日付・店舗が変わると読み直す。
 * initial（サーバーで読んだその日のデータ）があれば最初はそれを使う。storeId が空のあいだは読まない（閉じているダイアログ）。
 */
export function useReservationEntryData(storeId: string, date: string, initial?: { date: string; data: ReservationEntryData }) {
  const key = `${storeId}|${date}`;
  const valid = !!storeId && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const [state, setState] = useState<{ key: string; data: ReservationEntryData }>(() =>
    initial && initial.date === date ? { key, data: initial.data } : { key: '', data: initial?.data ?? EMPTY }
  );

  useEffect(() => {
    if (!valid || state.key === key) return;
    let alive = true;
    getReservationEntryData(storeId, date)
      .then((data) => {
        if (alive) setState({ key, data });
      })
      .catch(() => {
        // 読めなかったときは前のデータのまま（予約の登録はできる）
        if (alive) setState((s) => ({ key, data: s.data }));
      });
    return () => {
      alive = false;
    };
  }, [valid, key, storeId, date, state.key]);

  return { data: state.data, loading: valid && state.key !== key };
}
