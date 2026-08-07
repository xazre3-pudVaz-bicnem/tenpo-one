'use client';

import { useState, useTransition } from 'react';
import { Delete } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { punchByPin, type PunchEventType } from '@/app/app/attendance/actions';

const EVENT_OPTIONS: { type: PunchEventType; label: string }[] = [
  { type: 'clock_in', label: '出勤' },
  { type: 'break_start', label: '休憩開始' },
  { type: 'break_end', label: '休憩終了' },
  { type: 'clock_out', label: '退勤' },
];

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/** 共用端末モード: PINでスタッフを特定して打刻する */
export function PinPad({ storeId }: { storeId: string }) {
  const [eventType, setEventType] = useState<PunchEventType>('clock_in');
  const [pin, setPin] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const press = (key: string) => {
    if (pending) return;
    if (key === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (key === '') return;
    setPin((p) => (p.length >= 6 ? p : p + key));
  };

  const submit = () => {
    if (pin.length < 4) {
      toast('PINは4桁以上で入力してください', 'error');
      return;
    }
    startTransition(async () => {
      const result = await punchByPin(storeId, pin, eventType);
      toast(result.message, result.warning ? 'warning' : result.ok ? 'success' : 'error');
      setPin('');
    });
  };

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {EVENT_OPTIONS.map((opt) => (
          <button
            key={opt.type}
            type="button"
            onClick={() => setEventType(opt.type)}
            className={`min-h-14 rounded-lg border px-2 py-2 text-sm font-semibold transition-colors active:scale-95 ${
              eventType === opt.type
                ? 'border-primary bg-primary text-white'
                : 'border-gray-300 bg-white text-navy hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex justify-center gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border border-gray-400 ${i < pin.length ? 'bg-navy' : 'bg-white'}`}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {KEYS.map((key, i) =>
          key === '' ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => press(key)}
              disabled={pending}
              className="flex min-h-20 items-center justify-center rounded-xl border border-gray-300 bg-white text-2xl font-semibold text-navy transition-transform hover:bg-gray-50 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
            >
              {key === 'del' ? <Delete className="h-7 w-7" /> : key}
            </button>
          )
        )}
      </div>

      <Button
        className="mt-4 min-h-16 w-full text-xl transition-transform active:scale-95 disabled:active:scale-100"
        size="lg"
        disabled={pending || pin.length < 4}
        onClick={submit}
      >
        {pending ? '確認中…' : `${EVENT_OPTIONS.find((o) => o.type === eventType)?.label}を記録する`}
      </Button>
    </div>
  );
}
