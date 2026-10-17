'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, Delete } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyPadKey, isPadDigit, padDisplay, type PadKey } from '@/lib/number-pad';

/**
 * 画面のテンキー（2026-10-17 Ronnie「レジ開局・クローズなどの数字は、iPad のキーボードではなく横のテンキーで入れる」）。
 *
 *   <NumberPadScope>           … この中の数字の欄を1つのテンキーで入れる
 *     <PadNumberField … />     … 押すとその欄が選ばれ、テンキーで入る（iPad のキーボードは出ない）
 *   </NumberPadScope>
 *
 * テンキーは数字の欄のすぐ横に大きく出る（2026-10-17 Ronnie「もう少し大きく、すぐ横に」）。
 * 横に入らない狭い画面では画面の右（スマホは下）。inline のときはその場の下に出る（ダイアログの中）。
 * 選んだ欄に最初に打った数字は前の値と入れ替わる（続けて打つと桁が増える）。
 * 「次へ」で次の欄へ、「完了」で閉じる。パソコンのキーボードの数字・Backspace・Enter（次へ）・Esc（完了）も使える。
 * NumberPadScope の外に置いた PadNumberField は普通の数字の入力欄になる。
 */

interface FieldEntry {
  label: string;
  value: string;
  onChange: (next: string) => void;
  maxDigits: number;
  grouped: boolean;
  suffix?: string;
}

interface PadContext {
  activeId: string | null;
  activate: (id: string) => void;
  register: (id: string, entry: FieldEntry) => void;
  unregister: (id: string) => void;
}

const NumberPadCtx = createContext<PadContext | null>(null);

/** テンキーの幅と、欄からの間（px） */
const PANEL_W = 372;
const PANEL_GAP = 28;

export function NumberPadScope({
  children,
  inline = false,
  className,
}: {
  children: React.ReactNode;
  /** その場（欄の下）に出す。ダイアログの中で使う（外を押すとダイアログが閉じるため） */
  inline?: boolean;
  className?: string;
}) {
  const fields = useRef(new Map<string, FieldEntry>());
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  // テンキーの上に出す、選んでいる欄（名前・値）
  const [shown, setShown] = useState<FieldEntry | null>(null);
  // 選んだ直後は、最初の数字で入れ替える
  const fresh = useRef(true);

  const setActiveId = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveIdState(id);
    setShown(id ? (fields.current.get(id) ?? null) : null);
  }, []);
  const activate = useCallback(
    (id: string) => {
      fresh.current = true;
      setActiveId(id);
    },
    [setActiveId]
  );
  const register = useCallback((id: string, entry: FieldEntry) => {
    fields.current.set(id, entry);
    if (activeRef.current === id) {
      setShown((prev) =>
        prev && prev.value === entry.value && prev.label === entry.label && prev.suffix === entry.suffix ? prev : entry
      );
    }
  }, []);
  const unregister = useCallback((id: string) => {
    fields.current.delete(id);
  }, []);

  const goNext = useCallback(() => {
    const root = containerRef.current;
    if (!root || !activeId) return;
    const els = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-pad-field]:not([disabled])'));
    const i = els.findIndex((el) => el.dataset.padId === activeId);
    const next = i >= 0 ? els[i + 1] : undefined;
    if (next?.dataset.padId) {
      activate(next.dataset.padId);
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
    } else {
      setActiveId(null);
    }
  }, [activeId, activate, setActiveId]);

  const press = useCallback(
    (key: PadKey | 'next' | 'done') => {
      if (key === 'done') return setActiveId(null);
      if (key === 'next') return goNext();
      const f = activeId ? fields.current.get(activeId) : undefined;
      if (!f) return;
      const base = fresh.current && (isPadDigit(key) || key === '00') ? '' : f.value;
      fresh.current = false;
      f.onChange(applyPadKey(base, key, f.maxDigits));
    },
    [activeId, goNext, setActiveId]
  );

  // パソコンのキーボード（数字・Backspace・Enter・Esc）。文字の欄に打っているときは邪魔しない
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let handled = true;
      if (isPadDigit(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Delete') press('clear');
      else if (e.key === 'Enter' || e.key === 'Tab') press('next');
      else if (e.key === 'Escape') press('done');
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, press]);

  // 欄のすぐ横に置く位置。入らなければ null（画面の右・スマホは下）
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!activeId || inline) return;
    let raf = 0;
    const place = () => {
      const root = containerRef.current;
      if (!root) return;
      const r = root.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = panelRef.current?.offsetHeight ?? 560;
      if (vw < 768 || r.right + PANEL_GAP + PANEL_W > vw - 8) {
        setPos(null);
        return;
      }
      const left = Math.round(r.right + PANEL_GAP);
      const top = Math.round(Math.min(Math.max(12, r.top), Math.max(12, vh - h - 12)));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [activeId, inline]);

  const ctx = useMemo<PadContext>(() => ({ activeId, activate, register, unregister }), [activeId, activate, register, unregister]);
  const active = activeId ? shown : null;

  return (
    <NumberPadCtx.Provider value={ctx}>
      <div ref={containerRef} className={className}>
        {children}
        {active && inline && <NumberPadPanel field={active} onKey={press} inline />}
      </div>
      {active && !inline && <NumberPadPanel field={active} onKey={press} pos={pos} panelRef={panelRef} />}
    </NumberPadCtx.Provider>
  );
}

const KEY_ROWS: PadKey[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['00', '0', 'back'],
];

function NumberPadPanel({
  field,
  onKey,
  inline = false,
  pos = null,
  panelRef,
}: {
  field: FieldEntry;
  onKey: (key: PadKey | 'next' | 'done') => void;
  inline?: boolean;
  /** 欄のすぐ横の位置（無ければ画面の右・スマホは下） */
  pos?: { left: number; top: number } | null;
  panelRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const shown = padDisplay(field.value, field.grouped);
  // ダイアログの中（inline）は少し小さく、横に出すときは大きく（2026-10-17 Ronnie「もう少し大きく」）
  const big = !inline;
  return (
    <div
      ref={panelRef}
      role="group"
      aria-label={`${field.label}のテンキー`}
      style={pos ? { left: pos.left, top: pos.top, width: PANEL_W } : undefined}
      className={cn(
        'rounded-2xl border border-line bg-white shadow-[0_10px_40px_rgba(41,39,37,0.18)]',
        inline
          ? 'mt-3 p-3'
          : pos
            ? 'fixed z-[60] p-4'
            : 'fixed inset-x-3 bottom-3 z-[60] p-3 md:inset-x-auto md:right-5 md:bottom-auto md:top-1/2 md:w-[372px] md:-translate-y-1/2 md:p-4'
      )}
      // テンキーを押しても欄の選択（フォーカス）が外れないように
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className={cn('rounded-xl bg-lilac-soft', big ? 'mb-3 px-4 py-2.5' : 'mb-2 px-3 py-2')}>
        <p className={cn('truncate font-bold text-ink-2', big ? 'text-[15px]' : 'text-[12px]')}>{field.label}</p>
        <p className={cn('text-right font-num leading-tight font-extrabold text-ink tabular-nums', big ? 'text-[42px]' : 'text-[30px]')}>
          {shown || <span className="text-ink-3">0</span>}
          {field.suffix && <span className={cn('ml-1 font-bold text-ink-3', big ? 'text-[18px]' : 'text-[14px]')}>{field.suffix}</span>}
        </p>
      </div>
      <div className={cn('grid grid-cols-3', big ? 'gap-2.5' : 'gap-2')}>
        {KEY_ROWS.flat().map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onKey(k)}
            aria-label={k === 'back' ? '1文字消す' : k}
            className={cn(
              'flex items-center justify-center rounded-xl border border-line bg-white font-num font-bold text-ink tabular-nums active:scale-95 active:bg-lilac-soft',
              big ? 'h-[74px] text-[32px]' : 'h-14 text-[24px]'
            )}
          >
            {k === 'back' ? <Delete className={big ? 'h-8 w-8' : 'h-6 w-6'} aria-hidden /> : k}
          </button>
        ))}
      </div>
      <div className={cn('grid grid-cols-3', big ? 'mt-2.5 gap-2.5' : 'mt-2 gap-2')}>
        <button
          type="button"
          onClick={() => onKey('clear')}
          className={cn(
            'rounded-xl border border-danger/30 bg-danger-soft font-bold text-danger active:scale-95',
            big ? 'h-16 text-[17px]' : 'h-12 text-[14px]'
          )}
        >
          C クリア
        </button>
        <button
          type="button"
          onClick={() => onKey('next')}
          className={cn(
            'flex items-center justify-center gap-1 rounded-xl border border-line bg-white font-bold text-royal active:scale-95',
            big ? 'h-16 text-[17px]' : 'h-12 text-[14px]'
          )}
        >
          <ArrowDown className={big ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />
          次へ
        </button>
        <button
          type="button"
          onClick={() => onKey('done')}
          className={cn(
            'flex items-center justify-center gap-1 rounded-xl bg-iris font-bold text-white active:scale-95',
            big ? 'h-16 text-[17px]' : 'h-12 text-[14px]'
          )}
        >
          <Check className={big ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />
          完了
        </button>
      </div>
    </div>
  );
}

/**
 * テンキーで入れる数字の欄。NumberPadScope の中ではボタン（押すと選ばれる）、外では普通の入力欄。
 * value は数字だけの文字列（空＝未入力）。
 */
export function PadNumberField({
  id,
  label,
  value,
  onChange,
  maxDigits = 9,
  grouped = false,
  suffix,
  placeholder = '0',
  disabled,
  className,
  activeClassName,
}: {
  id: string;
  /** テンキーの上に出す名前（例：1,000円札の枚数） */
  label: string;
  value: string;
  onChange: (next: string) => void;
  maxDigits?: number;
  /** 3桁区切りで見せる（金額） */
  grouped?: boolean;
  /** テンキーの表示の後ろに付ける（枚・名・円） */
  suffix?: string;
  placeholder?: string;
  disabled?: boolean;
  /** 見た目（入力欄と同じクラスを渡す） */
  className?: string;
  /** 選ばれているときに足すクラス */
  activeClassName?: string;
}) {
  const ctx = useContext(NumberPadCtx);
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  useEffect(() => {
    register?.(id, { label, value, onChange, maxDigits, grouped, suffix });
  });
  useEffect(() => () => unregister?.(id), [id, unregister]);

  if (!ctx) {
    return (
      <input
        id={id}
        inputMode="numeric"
        value={padDisplay(value, grouped)}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, maxDigits))}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        className={className}
      />
    );
  }

  const active = ctx.activeId === id;
  return (
    <button
      type="button"
      id={id}
      data-pad-field=""
      data-pad-id={id}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      onClick={() => ctx.activate(id)}
      className={cn(
        'inline-flex items-center justify-end',
        className,
        active && (activeClassName ?? 'border-iris bg-[#f9ede6] outline-2 outline-iris/30')
      )}
    >
      {value ? padDisplay(value, grouped) : <span className="font-normal text-ink-3">{placeholder}</span>}
    </button>
  );
}
