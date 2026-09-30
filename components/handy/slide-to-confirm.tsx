'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronsRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 右端までの何割で決定にするか */
const CONFIRM_RATIO = 0.85;
/** つまみの大きさ（px） */
const KNOB = 52;
/** 枠の内側の余白（px） */
const PAD = 4;

/**
 * スライドして決定するボタン（ハンディの「オーダー決定」。2026-09-30 Ronnie「オーダー決定はスライドに」）。
 * つまみを右端近くまで動かすと onConfirm。途中で離すと元に戻る（うっかりタップで送らない）。
 * つまみにフォーカスして Enter / Space でも決定できる。
 */
export function SlideToConfirm({
  label,
  en,
  disabled = false,
  pending = false,
  pendingLabel = '送信中…',
  onConfirm,
}: {
  label: string;
  en?: string;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  onConfirm: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(0);
  const maxX = Math.max(0, width - KNOB - PAD * 2);

  // 枠の幅（つまみが動ける長さ）。画面の回転などで変わる
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 送信が終わったら（失敗してこの画面に残ったときも）つまみを戻す
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 送信の終わりに合わせてつまみを戻すだけ
    if (!pending) setX(0);
  }, [pending]);

  const locked = disabled || pending;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startX.current = e.clientX - x;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging || startX.current == null) return;
    setX(Math.min(maxX, Math.max(0, e.clientX - startX.current)));
  };

  const finish = () => {
    if (!dragging) return;
    setDragging(false);
    startX.current = null;
    if (maxX > 0 && x >= maxX * CONFIRM_RATIO) {
      setX(maxX);
      onConfirm();
    } else {
      setX(0);
    }
  };

  const shown = pending ? maxX : x;
  const progress = maxX > 0 ? shown / maxX : 0;

  return (
    <div
      ref={trackRef}
      className={cn(
        'relative h-[60px] w-full overflow-hidden rounded-full bg-linear-to-r from-[#5b2c8f] to-[#7b3fe4] shadow-[0_3px_10px_#7b3fe433] select-none',
        locked && !pending && 'opacity-40'
      )}
    >
      {/* 案内の文字（つまみが進むほど薄くなる） */}
      <span
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pl-12 text-white"
        style={{ opacity: pending ? 1 : Math.max(0, 1 - progress * 1.4) }}
      >
        <span className="flex items-center gap-1.5 text-[17px] font-extrabold tracking-wide">
          {pending ? pendingLabel : label}
          {!pending && <span className="text-white/60">›››</span>}
        </span>
        {en && !pending && <span className="text-[10px] font-semibold text-white/70">{en}</span>}
      </span>

      <button
        type="button"
        aria-label={`スライドして${label}`}
        disabled={locked}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={(e) => {
          if (locked) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onConfirm();
          }
        }}
        className={cn(
          'absolute top-1 left-1 grid touch-none place-items-center rounded-full bg-white text-[#7b3fe4] shadow-md',
          !dragging && 'transition-transform duration-200 ease-out'
        )}
        style={{ width: KNOB, height: KNOB, transform: `translateX(${shown}px)` }}
      >
        {pending ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <ChevronsRight className="h-7 w-7" aria-hidden />}
      </button>
    </div>
  );
}
