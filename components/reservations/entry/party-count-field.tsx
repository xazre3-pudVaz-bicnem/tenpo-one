'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Delete, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 人数の欄（大人・子ども）。数字を押すとテンキーが下から出て、そのまま打てる（150名でも＋を150回押さない）。
 * ＋／−はそのまま残す（1人ずつ足すとき）。2026-10-19 Ronnie「人数はテンキーで入れられるように（レストランボードと同じ）」。
 * ハンディ・レジ（iPad・PC）の予約登録で共通。
 */
export function PartyCountField({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const btn =
    'flex h-12 w-12 shrink-0 items-center justify-center rounded-[9px] border border-[#e5dfd5] bg-white text-[#45403b] active:bg-[#f6ebe3] disabled:opacity-40';
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[12px] font-bold text-[#5c5650]">{label}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label={`${label}を減らす`} className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus className="h-4 w-4" strokeWidth={2.6} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${label}をテンキーで入れる（いま ${value}名）`}
          className="flex h-12 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-[9px] border border-dashed border-[#d9cfc2] bg-[#fbf9f5] text-xl font-bold text-[#292725] tabular-nums active:bg-[#f6ebe3]"
        >
          {value}
          <span className="text-[11px] font-semibold text-[#766b62]">名</span>
        </button>
        <button type="button" aria-label={`${label}を増やす`} className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
          <Plus className="h-4 w-4" strokeWidth={2.6} aria-hidden />
        </button>
      </div>
      {open && (
        <PartyPad
          label={label}
          initial={value}
          max={max}
          onClose={() => setOpen(false)}
          onDone={(v) => {
            onChange(Math.max(min, Math.min(max, v)));
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** 下から出るテンキー（7 8 9 ⌫ ／ 4 5 6 ／ 1 2 3 ／ 0 決定）。最初に打った数字は前の値と入れ替わる */
function PartyPad({
  label,
  initial,
  max,
  onClose,
  onDone,
}: {
  label: string;
  initial: number;
  max: number;
  onClose: () => void;
  onDone: (v: number) => void;
}) {
  const [text, setText] = useState(String(initial));
  const [fresh, setFresh] = useState(true);

  const press = (d: string) => {
    setText((prev) => {
      const base = fresh ? '' : prev === '0' ? '' : prev;
      const next = (base + d).replace(/^0+(?=\d)/, '');
      return Number(next) > max ? prev : next || '0';
    });
    setFresh(false);
  };
  const back = () => {
    setFresh(false);
    setText((prev) => (prev.length <= 1 ? '0' : prev.slice(0, -1)));
  };

  // パソコンのキーボードでも打てる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') onDone(Number(text) || 0);
      else if (e.key === 'Escape') onClose();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 押したあとにだけ出る（ブラウザの中）ので document はある
  if (typeof document === 'undefined') return null;
  const key = 'flex h-16 items-center justify-center bg-white text-[26px] font-bold text-[#45403b] active:bg-[#f6ebe3]';
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/45" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${label}の人数`}>
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-t-2xl bg-[#f1ede6] pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between px-5 py-3">
          <span className="text-[13px] font-bold text-[#5c5650]">{label}</span>
          <span className="text-[40px] leading-none font-extrabold text-[#292725] tabular-nums">
            {text}
            <span className="ml-1 text-[16px] font-bold text-[#5c5650]">名</span>
          </span>
        </div>
        <div className="grid grid-cols-4 gap-px bg-[#e5dfd5]">
          {['7', '8', '9'].map((d) => (
            <button key={d} type="button" className={key} onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button type="button" className={cn(key, 'row-span-2 h-auto')} onClick={back} aria-label="1文字消す">
            <Delete className="h-7 w-7" aria-hidden />
          </button>
          {['4', '5', '6', '1', '2', '3'].map((d) => (
            <button key={d} type="button" className={key} onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button
            type="button"
            className="row-span-2 flex items-center justify-center bg-[#bc5940] text-[17px] font-bold tracking-[0.2em] text-white active:bg-[#9f4630]"
            onClick={() => onDone(Number(text) || 0)}
          >
            決定
          </button>
          <button type="button" className={cn(key, 'col-span-3')} onClick={() => press('0')}>
            0
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
