'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import {
  CUSTOM_MAX_HOURS,
  DEFAULT_VISIT_DRAFT,
  HANDY_PLANS,
  HANDY_SCENES,
  HOUR_CHOICES,
  MAX_GUESTS,
  MINUTE_CHOICES,
  durationLabel,
  durationProblem,
  isButtonMinutes,
  nearestButtonParts,
  parseCustomMinutes,
  planHasItems,
  planName,
  splitMinutes,
  validateVisitDraft,
  warningProblem,
  type HandyPlan,
  type HandyPlanItem,
  type VisitDraft,
} from '@/lib/handy-visit';
import {
  HandyBackButton,
  HandyFooterButton,
  HandyMain,
  HandyTopBar,
} from './handy-chrome';

type Picker = null | 'plan' | 'plan-item' | 'duration' | 'warning' | 'male' | 'female';

/**
 * お客様情報（承認済みレイアウト 2026-09-21 の setup）。
 * 空席の卓で「注文を開始」→ ここで人数・モード・時間制・利用シーンを入力 → 確定で着席し、注文画面へ。
 */
export function HandySetupScreen({
  tableId,
  tableName,
  staffName,
  planItems,
  startLabel,
  confirmAction,
}: {
  tableId: string;
  tableName: string;
  staffName: string;
  /** コース／飲み放題などのプラン商品（モードごとに絞って出す） */
  planItems: HandyPlanItem[];
  /** 開始時刻（サーバーで JST に整形） */
  startLabel: string;
  confirmAction: (
    tableId: string,
    draft: VisitDraft
  ) => Promise<{ orderId: string; planItemError: string | null }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<VisitDraft>(DEFAULT_VISIT_DRAFT);
  const [picker, setPicker] = useState<Picker>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<VisitDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const total = draft.male + draft.female;
  const problem = validateVisitDraft(draft);
  // 選んだモードに合うプランを先に、それ以外（名前から判断しきれないもの）を「ほかのプラン」として後に出す
  const itemsForPlan = planItems.filter((p) => p.kind === draft.plan);
  const otherItems = planItems.filter((p) => p.kind !== draft.plan);
  const selectedItem = planItems.find((p) => p.id === draft.planItemId) ?? null;

  const choosePlan = (plan: HandyPlan) => {
    // モードを変えたら選んでいたプラン商品は外す。飲み放題・コースは時間制が普通なので既定でオンにする
    set({ plan, planItemId: null, timed: plan === 'normal' ? draft.timed : true });
    setPicker(plan !== 'normal' && planItems.length > 0 ? 'plan-item' : null);
  };

  const planOption = (p: HandyPlanItem) => ({
    id: p.id,
    label: p.name,
    note: `${yen(p.price)}${p.durationMinutes ? ` · ${durationLabel(p.durationMinutes)}` : ''}`,
    selected: p.id === draft.planItemId,
  });

  const chooseItem = (item: HandyPlanItem) => {
    set({
      planItemId: item.id,
      timed: true,
      duration: item.durationMinutes ?? draft.duration,
    });
    setPicker(null);
  };

  const confirm = () => {
    if (pending || problem) return;
    startTransition(async () => {
      try {
        const { orderId, planItemError } = await confirmAction(tableId, draft);
        if (planItemError) {
          toast(`来店を登録しました。プラン商品は入っていません：${planItemError}`, 'warning');
        }
        router.push(`/handy/${tableId}/order?order=${orderId}`);
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <HandyTopBar
        left={<HandyBackButton href={`/handy/${tableId}`} label="卓へ戻る" />}
        title="お客様情報"
      />

      <HandyMain>
        <div className="m-3 rounded-[10px] border border-[#e3dbf1] bg-white">
          <Row label="テーブル" value={tableName} />
          <Row label="担当者" value={staffName} />
          <RowButton label="モード" value={planName(draft.plan)} onClick={() => setPicker('plan')} />
          {planHasItems(draft.plan) && (
            <RowButton
              label="プラン"
              value={
                selectedItem ? selectedItem.name : planItems.length > 0 ? '未選択' : 'メニュー未登録'
              }
              muted={!selectedItem}
              onClick={() => setPicker('plan-item')}
            />
          )}
        </div>

        <SectionTitle>タイマー設定</SectionTitle>
        <div className="mx-3 rounded-[10px] border border-[#e3dbf1] bg-white">
          <div className="flex min-h-[46px] items-center justify-between gap-2 border-b border-[#eee8f6] px-3.5 text-[13px]">
            <span className="text-[#5e4777]">時間制</span>
            <span className="flex items-center gap-2">
              <Switch label="時間制" checked={draft.timed} onChange={(v) => set({ timed: v })} />
              <button
                type="button"
                disabled={!draft.timed}
                onClick={() => setPicker('duration')}
                className="flex min-h-9 items-center gap-0.5 font-bold text-[#4f3868] disabled:text-[#a69bbb]"
              >
                {draft.timed ? durationLabel(draft.duration) : '設定なし'}
                <ChevronRight className="h-4 w-4 text-[#c9b8ea]" aria-hidden />
              </button>
            </span>
          </div>
          <div className="flex min-h-[46px] items-center justify-between gap-2 border-b border-[#eee8f6] px-3.5 text-[13px]">
            <span className="text-[#5e4777]">終了前注意</span>
            <span className="flex items-center gap-2">
              <Switch
                label="終了前注意"
                checked={draft.timed && draft.warningEnabled}
                disabled={!draft.timed}
                onChange={(v) => set({ warningEnabled: v })}
              />
              <button
                type="button"
                disabled={!draft.timed || !draft.warningEnabled}
                onClick={() => setPicker('warning')}
                className="flex min-h-9 items-center gap-0.5 font-bold text-[#4f3868] disabled:text-[#a69bbb]"
              >
                {draft.timed && draft.warningEnabled ? `${durationLabel(draft.warningMinutes)}前` : '設定なし'}
                <ChevronRight className="h-4 w-4 text-[#c9b8ea]" aria-hidden />
              </button>
            </span>
          </div>
          <Row label="開始時間" value={`${startLabel}〜`} />
        </div>

        <SectionTitle
          required
          right={
            <span className="text-[11px] font-normal text-[#8a769d]">合計：{total}人</span>
          }
        >
          人数
        </SectionTitle>
        <div className="mx-3 rounded-[10px] border border-[#e3dbf1] bg-white px-3.5 py-2">
          {(
            [
              ['male', '男性'],
              ['female', '女性'],
            ] as const
          ).map(([key, label]) => (
            <section key={key} className="py-2">
              <p className="mb-2 text-xs text-[#5e4777]">
                {label}
                {draft[key] > 5 ? `：${draft[key]}名` : ''}
              </p>
              <div className="grid grid-cols-6 gap-[7px]" role="group" aria-label={label}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={draft[key] === n}
                    onClick={() => set({ [key]: draft[key] === n ? 0 : n } as Partial<VisitDraft>)}
                    className={cn(
                      'min-h-[40px] rounded-[7px] border-[1.5px] border-[#7b3fe4] text-[19px] tabular-nums',
                      draft[key] === n ? 'bg-[#7b3fe4] text-white' : 'bg-white text-[#7b3fe4]'
                    )}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label={`${label}の人数を入力`}
                  aria-pressed={draft[key] > 5}
                  onClick={() => setPicker(key)}
                  className={cn(
                    'min-h-[40px] rounded-[7px] border-[1.5px] border-[#7b3fe4] text-[19px]',
                    draft[key] > 5 ? 'bg-[#7b3fe4] text-white' : 'bg-white text-[#7b3fe4]'
                  )}
                >
                  ＋
                </button>
              </div>
            </section>
          ))}
        </div>

        <SectionTitle required>客層</SectionTitle>
        <div className="mx-3 mb-3 rounded-[10px] border border-[#e3dbf1] bg-white px-3.5 py-3">
          <p className="mb-2 text-xs text-[#5e4777]">利用シーン</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="利用シーン">
            {HANDY_SCENES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={draft.scene === s}
                onClick={() => set({ scene: s })}
                className={cn(
                  'min-h-[38px] rounded-full border-[1.5px] border-[#7b3fe4] px-3.5 text-[13px]',
                  draft.scene === s ? 'bg-[#7b3fe4] text-white' : 'bg-white text-[#7b3fe4]'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <p className="px-5 pb-4 text-center text-[10px] leading-[1.7] text-[#8a769d]">
          人数と利用シーンを選ぶと確定できます。確定するとこの卓を着席にして伝票を作ります。
          {selectedItem && (
            <>
              <br />
              「{selectedItem.name}」を伝票に1つ入れます（数量は注文画面で足せます）。
            </>
          )}
        </p>
      </HandyMain>

      <div className="flex-none bg-[#f6f3fb] px-3.5 pt-2 pb-2.5">
        {problem && (
          <p className="mb-1.5 text-center text-[11px] text-[#8a769d]" aria-live="polite">
            {problem}
          </p>
        )}
        <HandyFooterButton
          label={pending ? '登録中…' : '確定'}
          disabled={!!problem || pending}
          onClick={confirm}
        />
      </div>

      {picker === 'plan' && (
        <ChoiceSheet
          title="モードを選択"
          onClose={() => setPicker(null)}
          options={HANDY_PLANS.map((p) => ({ id: p.id, label: p.name, selected: p.id === draft.plan }))}
          onSelect={(id) => choosePlan(id as HandyPlan)}
        />
      )}
      {picker === 'plan-item' && (
        <ChoiceSheet
          title={`${planName(draft.plan)}のプラン`}
          onClose={() => setPicker(null)}
          empty="メニューにコース・飲み放題の商品がありません（設定 → メニュー で「コース」として登録）。プラン無しで続けられます。"
          options={itemsForPlan.map(planOption)}
          moreTitle={itemsForPlan.length > 0 ? 'ほかのプラン' : undefined}
          moreOptions={otherItems.map(planOption)}
          onSelect={(id) => {
            const item = planItems.find((p) => p.id === id);
            if (item) chooseItem(item);
          }}
          clearLabel={draft.planItemId ? 'プランを外す' : undefined}
          onClear={() => {
            set({ planItemId: null });
            setPicker(null);
          }}
        />
      )}
      {picker === 'duration' && (
        <TimePickerSheet
          title="時間制"
          value={draft.duration}
          summaryPrefix="席時間"
          format={durationLabel}
          problemOf={durationProblem}
          onSave={(minutes) => {
            set({ duration: minutes });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'warning' && (
        <TimePickerSheet
          title="終了前注意"
          value={draft.warningMinutes}
          summaryPrefix="終了の"
          format={(minutes) => `${durationLabel(minutes)}前`}
          problemOf={(minutes) => warningProblem(minutes, draft.duration)}
          onSave={(minutes) => {
            set({ warningMinutes: minutes });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {(picker === 'male' || picker === 'female') && (
        <NumberSheet
          title={picker === 'male' ? '男性の人数' : '女性の人数'}
          value={draft[picker]}
          onSave={(n) => {
            set({ [picker]: n } as Partial<VisitDraft>);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------ 部品 */

function SectionTitle({
  children,
  required,
  right,
}: {
  children: React.ReactNode;
  required?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <h2 className="mx-3 mt-4 mb-1.5 flex items-baseline gap-1.5 text-sm font-bold text-[#4f3868]">
      {children}
      {required && <span className="text-[#b3341f]">＊</span>}
      {right && <span className="ml-auto">{right}</span>}
    </h2>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 border-b border-[#eee8f6] px-3.5 text-[13px] last:border-b-0">
      <span className="shrink-0 text-[#5e4777]">{label}</span>
      <span className="min-w-0 truncate font-bold text-[#4f3868]">{value}</span>
    </div>
  );
}

function RowButton({
  label,
  value,
  muted,
  onClick,
}: {
  label: string;
  value: string;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[46px] w-full items-center justify-between gap-3 border-b border-[#eee8f6] px-3.5 text-left text-[13px] last:border-b-0 active:bg-[#f6f3fb]"
    >
      <span className="shrink-0 text-[#5e4777]">{label}</span>
      <span
        className={cn(
          'flex min-w-0 items-center gap-0.5 font-bold',
          muted ? 'text-[#a69bbb]' : 'text-[#7b3fe4]'
        )}
      >
        <span className="truncate">{value}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[#c9b8ea]" aria-hidden />
      </span>
    </button>
  );
}

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-[26px] w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-40',
        checked ? 'justify-end bg-[#7b3fe4]' : 'justify-start bg-[#c9c4d2]'
      )}
    >
      <span className="block h-[22px] w-[22px] rounded-full bg-white shadow" />
    </button>
  );
}

function Sheet({
  title,
  closeButton,
  onClose,
  children,
}: {
  title: string;
  /** 見出しの右に ×（閉じる）を出す */
  closeButton?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#24143688] p-3"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-[370px] overflow-y-auto rounded-xl bg-white p-5 shadow-[0_20px_90px_#0005]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[#2a2138]">{title}</h2>
          {closeButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="-my-1 -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#8a769d] active:bg-[#f6f3fb]"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

interface ChoiceOption {
  id: string;
  label: string;
  note?: string;
  selected: boolean;
}

function ChoiceList({
  options,
  onSelect,
}: {
  options: ChoiceOption[];
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {options.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            aria-pressed={o.selected}
            onClick={() => onSelect(o.id)}
            className={cn(
              'flex min-h-[46px] w-full items-center justify-between gap-2 rounded-[9px] border-[1.5px] px-3.5 text-left text-sm',
              o.selected
                ? 'border-[#7b3fe4] bg-[#7b3fe4] text-white'
                : 'border-[#7b3fe4] bg-white text-[#4f3868]'
            )}
          >
            <span className="min-w-0 truncate font-bold">{o.label}</span>
            {o.note && (
              <span className={cn('shrink-0 text-xs', o.selected ? 'text-white/85' : 'text-[#8a769d]')}>
                {o.note}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ChoiceSheet({
  title,
  options,
  moreTitle,
  moreOptions = [],
  empty,
  clearLabel,
  onSelect,
  onClear,
  onClose,
}: {
  title: string;
  options: ChoiceOption[];
  /** options の後ろに見出しつきで並べる候補（プランの「ほかのプラン」） */
  moreTitle?: string;
  moreOptions?: ChoiceOption[];
  empty?: string;
  clearLabel?: string;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const nothing = options.length === 0 && moreOptions.length === 0;
  return (
    <Sheet title={title} onClose={onClose}>
      {nothing && empty && (
        <p className="py-3 text-[13px] leading-relaxed text-[#8a769d]">{empty}</p>
      )}
      <ChoiceList options={options} onSelect={onSelect} />
      {moreOptions.length > 0 && (
        <>
          {moreTitle && (
            <p className="mt-4 mb-2 text-xs font-bold text-[#8a769d]">{moreTitle}</p>
          )}
          <div className={moreTitle ? undefined : options.length > 0 ? 'mt-2' : undefined}>
            <ChoiceList options={moreOptions} onSelect={onSelect} />
          </div>
        </>
      )}
      {clearLabel && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 min-h-[43px] w-full rounded-lg border border-[#e3dbf1] text-sm text-[#b3341f]"
        >
          {clearLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-3 min-h-[43px] w-full rounded-lg bg-[#efeaf8] text-center text-sm font-bold text-[#5e4777]"
      >
        {nothing ? 'プラン無しで続ける' : '閉じる'}
      </button>
    </Sheet>
  );
}

/** 時間ピッカーのボタン（時間・分・カスタム）。人数ボタンと同じ見た目 */
function PickButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'min-h-[46px] rounded-[9px] border-[1.5px] border-[#7b3fe4] text-base font-bold tabular-nums',
        selected ? 'bg-[#7b3fe4] text-white' : 'bg-white text-[#7b3fe4]'
      )}
    >
      {children}
    </button>
  );
}

/**
 * 時間制・終了前注意の時間ピッカー（2026-09-21 Ronnie のスクショの操作をハンディのデザインで）。
 * 「時間」（0〜3時間）と「分」（0/15/30/45分）を1つずつ選び、ボタンに無い長さは「カスタム」で
 * 時間と分を入力して「設定」。いまの値がボタンに無い長さ（100分のコースなど）ならカスタムで開く。
 */
function TimePickerSheet({
  title,
  value,
  summaryPrefix,
  format,
  problemOf,
  onSave,
  onClose,
}: {
  title: string;
  value: number;
  /** 選んでいる長さの前に付ける言葉（「席時間」「終了の」） */
  summaryPrefix: string;
  /** 選んでいる長さの表示（「2時間30分」「30分前」） */
  format: (minutes: number) => string;
  /** 設定できない理由。設定できれば null */
  problemOf: (minutes: number) => string | null;
  onSave: (minutes: number) => void;
  onClose: () => void;
}) {
  const start = splitMinutes(value);
  const startButtons = nearestButtonParts(value);
  const [custom, setCustom] = useState(!isButtonMinutes(value));
  const [hours, setHours] = useState(startButtons.hours);
  const [minutes, setMinutes] = useState(startButtons.minutes);
  const [hoursText, setHoursText] = useState(String(start.hours));
  const [minutesText, setMinutesText] = useState(String(start.minutes));
  // カスタムを押したときだけ入力欄にフォーカスする（カスタムの値で開いたときはキーボードを出さない）
  const [focusCustom, setFocusCustom] = useState(false);

  const total = custom ? parseCustomMinutes(hoursText, minutesText) : hours * 60 + minutes;
  const problem =
    total === null
      ? `時間は0〜${CUSTOM_MAX_HOURS}、分は0〜59の数字で入力してください`
      : problemOf(total);

  /** 時間・分のボタン: カスタム中なら入力していた値に近いボタンから続ける */
  const pick = (patch: { hours?: number; minutes?: number }) => {
    let base = { hours, minutes };
    if (custom) {
      const typed = parseCustomMinutes(hoursText, minutesText);
      if (typed !== null) base = nearestButtonParts(typed);
      setCustom(false);
    }
    setHours(patch.hours ?? base.hours);
    setMinutes(patch.minutes ?? base.minutes);
  };

  const openCustom = () => {
    if (custom) return;
    setHoursText(String(hours));
    setMinutesText(String(minutes));
    setFocusCustom(true);
    setCustom(true);
  };

  const save = () => {
    if (total === null || problem) return;
    onSave(total);
  };

  const inputClass =
    'h-12 w-16 rounded-lg border-[1.5px] border-[#d9ccef] text-center text-2xl font-bold text-[#2a2138] tabular-nums focus:border-[#7b3fe4] focus:outline-none';

  return (
    <Sheet title={title} onClose={onClose} closeButton>
      <p className="mb-2 text-xs font-bold text-[#5e4777]">時間</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="時間">
        {HOUR_CHOICES.map((h) => (
          <PickButton key={h} selected={!custom && hours === h} onClick={() => pick({ hours: h })}>
            {h}時間
          </PickButton>
        ))}
      </div>

      <p className="mt-4 mb-2 text-xs font-bold text-[#5e4777]">分</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="分">
        {MINUTE_CHOICES.map((m) => (
          <PickButton key={m} selected={!custom && minutes === m} onClick={() => pick({ minutes: m })}>
            {m}分
          </PickButton>
        ))}
      </div>

      <div className="mt-4 border-t border-[#e3dbf1] pt-4">
        <div className="grid grid-cols-2 gap-2">
          <PickButton selected={custom} onClick={openCustom}>
            カスタム
          </PickButton>
        </div>
        {custom && (
          <div className="mt-3 flex items-center justify-center gap-2 text-sm font-bold text-[#5e4777]">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              autoFocus={focusCustom}
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label={`${title}（カスタム）の時間`}
              className={inputClass}
            />
            時間
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              value={minutesText}
              onChange={(e) => setMinutesText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label={`${title}（カスタム）の分`}
              className={inputClass}
            />
            分
          </div>
        )}
      </div>

      <p className="mt-4 min-h-6 text-center" aria-live="polite">
        {problem ? (
          <span className="text-xs leading-relaxed text-[#b3341f]">{problem}</span>
        ) : total !== null ? (
          <span className="text-sm text-[#8a769d]">
            {summaryPrefix}{' '}
            <b className="text-lg font-bold text-[#4f3868] tabular-nums">{format(total)}</b>
          </span>
        ) : null}
      </p>
      <button
        type="button"
        disabled={total === null || !!problem}
        onClick={save}
        className="mt-3 min-h-[46px] w-full rounded-lg bg-[#7b3fe4] text-base font-bold text-white disabled:opacity-40"
      >
        設定
      </button>
    </Sheet>
  );
}

function NumberSheet({
  title,
  value,
  onSave,
  onClose,
}: {
  title: string;
  value: number;
  onSave: (value: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value > 0 ? String(value) : '');
  const n = Number(text);
  const valid = text !== '' && Number.isInteger(n) && n >= 0 && n <= MAX_GUESTS;
  return (
    <Sheet title={title} onClose={onClose}>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_GUESTS}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        aria-label={title}
        className="min-h-12 w-full rounded-lg border border-[#e3dbf1] px-3 text-center text-2xl font-bold text-[#2a2138] tabular-nums"
      />
      <p className="mt-2 text-[11px] text-[#8a769d]">0〜{MAX_GUESTS}名</p>
      <button
        type="button"
        disabled={!valid}
        onClick={() => onSave(n)}
        className="mt-3 min-h-[43px] w-full rounded-lg bg-[#7b3fe4] text-sm font-bold text-white disabled:opacity-40"
      >
        決定
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 min-h-[43px] w-full rounded-lg bg-[#efeaf8] text-center text-sm font-bold text-[#5e4777]"
      >
        キャンセル
      </button>
    </Sheet>
  );
}
