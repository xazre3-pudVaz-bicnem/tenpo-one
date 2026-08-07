'use client';

import { useEffect, useState } from 'react';
import { Users, KeyRound } from 'lucide-react';
import { PunchPad, type PunchState } from './punch-pad';
import { PinPad } from './pin-pad';

/** 打刻タブの本体。個人打刻と共用端末（PIN）モードを切り替える。 */
export function ClockSection({
  storeId,
  displayName,
  punchState,
  onBreak = false,
}: {
  storeId: string;
  displayName: string;
  punchState: PunchState;
  /** 休憩中フラグ（time_entries.on_break）。個人打刻モードの退勤ボタン付近に注意書きを表示する */
  onBreak?: boolean;
}) {
  const [shared, setShared] = useState(false);
  const [now, setNow] = useState<Date | null>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeText = now
    ? now.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';
  const dateText = now
    ? now.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
    : '';

  return (
    <div className="mx-auto max-w-md landscape:max-w-2xl">
      <div className="rounded-2xl bg-navy px-6 py-8 text-center text-white">
        <p className="text-base text-gray-300">{dateText}</p>
        <p className="mt-1 text-6xl font-bold tabular-nums tracking-tight sm:text-7xl">{timeText}</p>
        {!shared && (
          <p className="mt-3 text-base text-gray-300">
            {displayName} さん
            {onBreak && (
              <span className="ml-2 inline-flex items-center rounded-full bg-warning px-2.5 py-0.5 text-xs font-medium text-white align-middle">
                休憩中
              </span>
            )}
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => setShared((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-navy hover:bg-gray-50"
        >
          {shared ? <Users className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          {shared ? '個人打刻に切り替える' : '共用端末モード（PINで打刻）'}
        </button>
      </div>

      <div className="mt-6">
        {shared ? <PinPad storeId={storeId} /> : <PunchPad storeId={storeId} state={punchState} onBreak={onBreak} />}
      </div>
    </div>
  );
}
