'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 右へスライドして決める立体的なボタン（2026-09-25 店舗要望「Order 決定はスライドで。3Dで楽しく」）。
 * レジの「Order」とお客様QRの「注文を確定」で同じものを使う。
 * 指でつまみを右端まで運ぶと onConfirm。途中で離すと戻る。押し間違いで注文が飛ばない。
 */
export function SlideToConfirm({
  label,
  hint = 'スライドして確定 / Slide',
  disabled,
  busy,
  tone = 'navy',
  onConfirm,
  className,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'navy' | 'royal';
  onConfirm: () => void;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  /** つまみが動ける幅（描画中に ref を読まないよう、state に持つ） */
  const [limit, setLimit] = useState(0);
  const [dragging, setDragging] = useState(false);
  const doneRef = useRef(false);

  const maxX = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    // つまみ（56px）と左右の余白（4px）を引いた移動できる幅
    return Math.max(0, track.clientWidth - 56 - 8);
  }, []);

  const end = useCallback(() => {
    setDragging(false);
    const limit = maxX();
    if (!doneRef.current && limit > 0 && x >= limit * 0.9) {
      doneRef.current = true;
      setX(limit);
      onConfirm();
      // 送信が終わるころに戻す（連打防止）
      window.setTimeout(() => {
        doneRef.current = false;
        setX(0);
      }, 700);
      return;
    }
    if (!doneRef.current) setX(0);
  }, [maxX, onConfirm, x]);

  // 幅は描画後に測る（画面の回転・折り返しでも合わせ直す）
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setLimit(maxX());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [maxX]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const left = track.getBoundingClientRect().left;
      setX(Math.min(maxX(), Math.max(0, e.clientX - left - 32)));
    };
    const up = () => end();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, end, maxX]);

  const progress = limit > 0 ? Math.min(1, x / limit) : 0;

  return (
    <div
      ref={trackRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        // キーボード（検証・アクセシビリティ）では Enter / Space で確定
        if (disabled || busy) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onConfirm();
        }
      }}
      className={cn(
        'tap3d relative h-[64px] w-full touch-none overflow-hidden rounded-2xl select-none',
        tone === 'navy' ? 'bg-navy' : 'bg-royal',
        disabled && 'pointer-events-none opacity-40',
        className
      )}
    >
      {/* 進み具合を明るく塗る */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-75"
        style={{ width: `${56 + x}px` }}
        aria-hidden
      />
      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-white">
        <b className="text-[20px] leading-tight">{busy ? '送信中…' : label}</b>
        <small className="text-[11px] font-semibold text-white/70">{busy ? '' : hint}</small>
      </span>
      <div
        onPointerDown={(e) => {
          if (disabled || busy) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setDragging(true);
        }}
        style={{ transform: `translateX(${x}px)`, transition: dragging ? 'none' : 'transform .18s ease' }}
        className="absolute top-1 left-1 grid h-[56px] w-[56px] place-items-center rounded-xl bg-white shadow-[0_2px_0_rgba(0,0,0,.25),0_6px_14px_rgba(0,0,0,.28)]"
        aria-hidden
      >
        <ChevronRight
          className={cn('h-6 w-6', tone === 'navy' ? 'text-navy' : 'text-royal')}
          style={{ opacity: 0.45 + progress * 0.55 }}
        />
      </div>
    </div>
  );
}
