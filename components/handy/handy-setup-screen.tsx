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
  DEFAULT_VISIT_SOURCES,
  type VisitSource,
  HOUR_CHOICES,
  MAX_GUESTS,
  MINUTE_CHOICES,
  durationLabel,
  durationProblem,
  isButtonMinutes,
  jstHm,
  minutesAgoHm,
  nearestButtonParts,
  parseCustomHm,
  parseCustomMinutes,
  planNames,
  plansHaveItems,
  resolveStartTime,
  splitMinutes,
  startTimeProblem,
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

type Picker = null | 'plan' | 'plan-item' | 'duration' | 'warning' | 'start' | 'male' | 'female';

/**
 * お客様情報（承認済みレイアウト 2026-09-21 の setup）。
 * 空席の卓で「注文を開始」→ ここで人数・モード・時間制・利用シーンを入力 → 確定で着席し、注文画面へ。
 */
export function HandySetupScreen({
  tableId,
  tableName,
  planItems,
  startLabel,
  sources = DEFAULT_VISIT_SOURCES,
  confirmAction,
  from = 'handy',
}: {
  tableId: string;
  tableName: string;
  /** コース／飲み放題などのプラン商品（モードごとに絞って出す） */
  planItems: HandyPlanItem[];
  /** 開始時刻（サーバーで JST に整形） */
  startLabel: string;
  /** この店で使う来店経路（設定 > レジ で選ぶ。省略時は全部） */
  sources?: readonly VisitSource[];
  confirmAction: (
    tableId: string,
    draft: VisitDraft
  ) => Promise<{ orderId: string; planItemError: string | null }>;
  /**
   * どこから開いたか。'pos' はレジ（オーダー・会計）のファーストオーダー:
   * 戻るはフロア画面、確定後はレジの伝票画面へ（2026-09-22 店舗要望: iPad でもこの画面を出したい）
   */
  from?: 'handy' | 'pos';
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<VisitDraft>(DEFAULT_VISIT_DRAFT);
  const [picker, setPicker] = useState<Picker>(null);
  // 開始時間の画面を開いた時刻（「今」「5分前」などの基準。描画中に時計を読まないよう、開くときに決める）
  const [startSheetNow, setStartSheetNow] = useState(0);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<VisitDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const total = draft.male + draft.female;
  const problem = validateVisitDraft(draft);
  // 選んだモードに合うプランを先に、それ以外（名前から判断しきれないもの）を「ほかのプラン」として後に出す
  const itemsForPlan = planItems.filter((p) => draft.plans.includes(p.kind));
  const otherItems = planItems.filter((p) => !draft.plans.includes(p.kind));
  const selectedItems = planItems.filter((p) => draft.planItemIds.includes(p.id));

  /**
   * モードは何個でも選べる（2026-09-24 店舗要望）。
   * 例: 飲み放題＋アラカルト、食べ放題＋単品ドリンク。押すたびに入り切りする。
   */
  const togglePlan = (plan: HandyPlan) => {
    const on = draft.plans.includes(plan);
    const plans = on ? draft.plans.filter((p) => p !== plan) : [...draft.plans, plan];
    if (plans.length === 0) return; // 全部外すのは不可（最低1つ）
    // 外したモードのプラン商品も外す
    const planItemIds = draft.planItemIds.filter((id) => {
      const item = planItems.find((p) => p.id === id);
      return item ? plans.includes(item.kind) : false;
    });
    // 飲み放題・食べ放題・コースを入れたら時間制を既定でオンにする
    const timed = plans.some((p) => p !== 'normal') ? true : draft.timed;
    set({ plans, planItemIds, timed });
  };

  const planOption = (p: HandyPlanItem) => ({
    id: p.id,
    label: p.name,
    note: `${yen(p.price)}${p.durationMinutes ? ` · ${durationLabel(p.durationMinutes)}` : ''}`,
    selected: draft.planItemIds.includes(p.id),
  });

  /** プラン商品も何個でも選べる（飲み放題B＋食べ放題A のような組み合わせ） */
  const toggleItem = (item: HandyPlanItem) => {
    const on = draft.planItemIds.includes(item.id);
    const planItemIds = on
      ? draft.planItemIds.filter((id) => id !== item.id)
      : [...draft.planItemIds, item.id];
    set({
      planItemIds,
      timed: on ? draft.timed : true,
      duration: !on && item.durationMinutes ? item.durationMinutes : draft.duration,
    });
  };

  const confirm = () => {
    if (pending || problem) return;
    const startIssue = startTimeProblem(draft.startTime, Date.now());
    if (startIssue) {
      toast(startIssue, 'error');
      return;
    }
    startTransition(async () => {
      try {
        const { orderId, planItemError } = await confirmAction(tableId, draft);
        if (planItemError) {
          toast(`来店を登録しました。プラン商品は入っていません：${planItemError}`, 'warning');
        }
        router.push(from === 'pos' ? `/app/pos?order=${orderId}` : `/handy/${tableId}/order?order=${orderId}`);
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <HandyTopBar
        left={
          from === 'pos' ? (
            <HandyBackButton href="/app/floor" label="テーブル一覧" />
          ) : (
            <HandyBackButton href={`/handy/${tableId}`} label="卓へ戻る" />
          )
        }
        title="お客様情報"
      />

      <HandyMain>
        <div className="m-3 rounded-[10px] border border-[#e3dbf1] bg-white">
          <Row label="テーブル" en="Table" value={tableName} />
          <RowButton label="モード" en="Mode" value={planNames(draft.plans)} onClick={() => setPicker('plan')} />
          {plansHaveItems(draft.plans) && (
            <RowButton
              label="プラン"
              en="Plan"
              value={
                selectedItems.length > 0
                  ? selectedItems.map((i) => i.name).join('・')
                  : planItems.length > 0
                    ? '未選択'
                    : 'メニュー未登録'
              }
              muted={selectedItems.length === 0}
              onClick={() => setPicker('plan-item')}
            />
          )}
        </div>

        <SectionTitle en="Timer">タイマー設定</SectionTitle>
        <div className="mx-3 rounded-[10px] border border-[#e3dbf1] bg-white">
          <div className="flex min-h-[46px] items-center justify-between gap-2 border-b border-[#eee8f6] px-3.5 text-[13px]">
            <span className="flex items-baseline gap-1 text-[#5e5470]">
              時間制 <Sub>Time limit</Sub>
            </span>
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
            <span className="flex items-baseline gap-1 text-[#5e5470]">
              終了前注意 <Sub>Last call</Sub>
            </span>
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
          <RowButton
            label="開始時間"
            en="Start time"
            value={`${draft.startTime ?? startLabel}〜`}
            onClick={() => {
              setStartSheetNow(Date.now());
              setPicker('start');
            }}
          />
        </div>

        <SectionTitle
          en="Guests"
          required
          right={
            <span className="text-[11px] font-normal text-[#7a7090]">合計：{total}人</span>
          }
        >
          人数
        </SectionTitle>
        <div className="mx-3 rounded-[10px] border border-[#e3dbf1] bg-white px-3.5 py-2">
          {(
            [
              ['male', '男性', 'Male'],
              ['female', '女性', 'Female'],
            ] as const
          ).map(([key, label, en]) => (
            <section key={key} className="py-2">
              <p className="mb-2 text-xs text-[#5e5470]">
                {label}
                {/* 日本語を読まないスタッフ向けに英語も小さく添える（2026-09-24 店舗要望） */}
                <span className="ml-1 text-[10px] font-normal text-[#7a7090]">{en}</span>
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

        {/* 来店経路（人気順・色はそろえる。使わない経路は 設定 > レジ から外せる。2026-09-24 店舗要望） */}
        <SectionTitle en="Source" required>来店経路</SectionTitle>
        <div className="mx-3 mb-3 rounded-[10px] border border-[#e3dbf1] bg-white px-3.5 py-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="来店経路">
            {sources.map((src) => {
              const on = draft.source === src.label;
              return (
                <button
                  key={src.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ source: src.label })}
                  className={cn(
                    'tap3d min-h-[32px] rounded-full border-[1.5px] border-[#7b3fe4] px-2.5 text-[11px] font-bold',
                    on ? 'bg-[#7b3fe4] text-white' : 'bg-white text-[#7b3fe4]'
                  )}
                >
                  {src.label}
                </button>
              );
            })}
          </div>
        </div>

      </HandyMain>

      <div className="flex-none bg-[#f6f3fb] px-3.5 pt-2 pb-2.5">
        {problem && (
          <p className="mb-1.5 text-center text-[11px] text-[#7a7090]" aria-live="polite">
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
          title="モードを選択（何個でも）"
          onClose={() => setPicker(null)}
          options={HANDY_PLANS.map((p) => ({
            id: p.id,
            label: p.name,
            selected: draft.plans.includes(p.id),
          }))}
          onSelect={(id) => togglePlan(id as HandyPlan)}
        />
      )}
      {picker === 'plan-item' && (
        <ChoiceSheet
          title={`${planNames(draft.plans)}のプラン（何個でも）`}
          onClose={() => setPicker(null)}
          empty="メニューにコース・飲み放題の商品がありません（設定 → メニュー で「コース」として登録）。プラン無しで続けられます。"
          options={itemsForPlan.map(planOption)}
          moreTitle={itemsForPlan.length > 0 ? 'ほかのプラン' : undefined}
          moreOptions={otherItems.map(planOption)}
          onSelect={(id) => {
            const item = planItems.find((p) => p.id === id);
            if (item) toggleItem(item);
          }}
          clearLabel={draft.planItemIds.length > 0 ? 'プランを全部外す' : undefined}
          onClear={() => {
            set({ planItemIds: [] });
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
      {picker === 'start' && (
        <StartTimeSheet
          value={draft.startTime}
          nowMs={startSheetNow}
          timed={draft.timed}
          duration={draft.duration}
          onSave={(startTime) => {
            set({ startTime });
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

/** 日本語を読まないスタッフ向けに小さく添える英語（2026-09-24 店舗要望） */
function Sub({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-normal text-[#7a7090]">{children}</span>;
}

function SectionTitle({
  children,
  en,
  required,
  right,
}: {
  children: React.ReactNode;
  en?: string;
  required?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <h2 className="mx-3 mt-4 mb-1.5 flex items-baseline gap-1.5 text-sm font-bold text-[#4f3868]">
      {children}
      {en && <Sub>{en}</Sub>}
      {required && <span className="text-[#b3341f]">＊</span>}
      {right && <span className="ml-auto">{right}</span>}
    </h2>
  );
}

function Row({ label, en, value }: { label: string; en?: string; value: string }) {
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 border-b border-[#eee8f6] px-3.5 text-[13px] last:border-b-0">
      <span className="flex shrink-0 items-baseline gap-1 text-[#5e5470]">
        {label}
        {en && <Sub>{en}</Sub>}
      </span>
      <span className="min-w-0 truncate font-bold text-[#4f3868]">{value}</span>
    </div>
  );
}

function RowButton({
  label,
  en,
  value,
  muted,
  onClick,
}: {
  label: string;
  en?: string;
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
      <span className="flex shrink-0 items-baseline gap-1 text-[#5e5470]">
        {label}
        {en && <Sub>{en}</Sub>}
      </span>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#15121a88] p-3"
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
              className="-my-1 -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#7a7090] active:bg-[#f6f3fb]"
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
              <span className={cn('shrink-0 text-xs', o.selected ? 'text-white/85' : 'text-[#7a7090]')}>
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
        <p className="py-3 text-[13px] leading-relaxed text-[#7a7090]">{empty}</p>
      )}
      <ChoiceList options={options} onSelect={onSelect} />
      {moreOptions.length > 0 && (
        <>
          {moreTitle && (
            <p className="mt-4 mb-2 text-xs font-bold text-[#7a7090]">{moreTitle}</p>
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
        className="mt-3 min-h-[43px] w-full rounded-lg bg-[#efeaf8] text-center text-sm font-bold text-[#5e5470]"
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
      <p className="mb-2 text-xs font-bold text-[#5e5470]">時間</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="時間">
        {HOUR_CHOICES.map((h) => (
          <PickButton key={h} selected={!custom && hours === h} onClick={() => pick({ hours: h })}>
            {h}時間
          </PickButton>
        ))}
      </div>

      <p className="mt-4 mb-2 text-xs font-bold text-[#5e5470]">分</p>
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
          <div className="mt-3 flex items-center justify-center gap-2 text-sm font-bold text-[#5e5470]">
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
          <span className="text-sm text-[#7a7090]">
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

/**
 * 開始時間（2026-09-21 Ronnie「開始時間を編集できるように」）。
 * 「今」「5分前」…、時（今の時刻から3時間前まで）と分（5分きざみ）、ボタンに無い時刻は「カスタム」→「設定」。
 * 12時間前〜今の間だけ。「今」は確定した時刻になる。
 */
function StartTimeSheet({
  value,
  nowMs,
  timed,
  duration,
  onSave,
  onClose,
}: {
  value: string | null;
  nowMs: number;
  timed: boolean;
  duration: number;
  onSave: (startTime: string | null) => void;
  onClose: () => void;
}) {
  const nowHm = jstHm(nowMs);
  const nowHour = Number(nowHm.slice(0, 2));
  const nowMinute = Number(nowHm.slice(3, 5));
  const hours = [3, 2, 1, 0].map((back) => (nowHour - back + 24) % 24);
  const minuteChoices = Array.from({ length: 12 }, (_, i) => i * 5);
  const quick = [5, 10, 15, 30].map((ago) => ({ ago, hm: minutesAgoHm(nowMs, ago) }));
  const pad = (n: number) => String(n).padStart(2, '0');

  const [selected, setSelected] = useState<string | null>(value);
  const [custom, setCustom] = useState(false);
  const [hoursText, setHoursText] = useState(value ? value.slice(0, 2) : pad(nowHour));
  const [minutesText, setMinutesText] = useState(value ? value.slice(3, 5) : pad(nowMinute));
  const [focusCustom, setFocusCustom] = useState(false);

  const effective = custom ? parseCustomHm(hoursText, minutesText) : selected;
  const invalidCustom = custom && effective === null;
  const problem = invalidCustom ? '時は0〜23、分は0〜59の数字で入力してください' : startTimeProblem(effective, nowMs);
  const startMs = effective === null ? nowMs : resolveStartTime(effective, nowMs);
  const selH = selected ? Number(selected.slice(0, 2)) : null;
  const selM = selected ? Number(selected.slice(3, 5)) : null;

  const pickNow = () => {
    setCustom(false);
    setSelected(null);
  };
  const pickHm = (hm: string) => {
    setCustom(false);
    setSelected(hm);
  };
  const pickHour = (h: number) => pickHm(`${pad(h)}:${pad(selM ?? Math.floor(nowMinute / 5) * 5)}`);
  const pickMinute = (m: number) => pickHm(`${pad(selH ?? nowHour)}:${pad(m)}`);
  const openCustom = () => {
    if (custom) return;
    const base = selected ?? nowHm;
    setHoursText(base.slice(0, 2));
    setMinutesText(base.slice(3, 5));
    setFocusCustom(true);
    setCustom(true);
  };
  const save = () => {
    if (invalidCustom || problem) return;
    onSave(effective);
  };

  const inputClass =
    'h-12 w-16 rounded-lg border-[1.5px] border-[#d9ccef] text-center text-2xl font-bold text-[#2a2138] tabular-nums focus:border-[#7b3fe4] focus:outline-none';

  return (
    <Sheet title="開始時間" onClose={onClose} closeButton>
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="よく使う開始時間">
        <PickButton selected={!custom && selected === null} onClick={pickNow}>
          今
        </PickButton>
        {quick.map((q) => (
          <PickButton key={q.ago} selected={!custom && selected === q.hm} onClick={() => pickHm(q.hm)}>
            <span className="text-sm">{q.ago}分前</span>
          </PickButton>
        ))}
      </div>

      <p className="mt-4 mb-2 text-xs font-bold text-[#5e5470]">時</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="時">
        {hours.map((h) => (
          <PickButton key={h} selected={!custom && selH === h} onClick={() => pickHour(h)}>
            {h}時
          </PickButton>
        ))}
      </div>

      <p className="mt-4 mb-2 text-xs font-bold text-[#5e5470]">分</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="分">
        {minuteChoices.map((m) => (
          <PickButton key={m} selected={!custom && selM === m} onClick={() => pickMinute(m)}>
            {pad(m)}分
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
          <div className="mt-3 flex items-center justify-center gap-2 text-sm font-bold text-[#5e5470]">
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
              aria-label="開始時間（カスタム）の時"
              className={inputClass}
            />
            時
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              value={minutesText}
              onChange={(e) => setMinutesText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label="開始時間（カスタム）の分"
              className={inputClass}
            />
            分
          </div>
        )}
      </div>

      <p className="mt-4 min-h-6 text-center" aria-live="polite">
        {problem ? (
          <span className="text-xs leading-relaxed text-[#b3341f]">{problem}</span>
        ) : (
          <span className="text-sm text-[#7a7090]">
            開始{' '}
            <b className="text-lg font-bold text-[#4f3868] tabular-nums">
              {effective === null ? `今（${nowHm}）` : effective}
            </b>
            {timed && startMs !== null && (
              <>
                {' '}
                ／ 終了予定 <b className="font-bold text-[#4f3868] tabular-nums">{jstHm(startMs + duration * 60_000)}</b>
              </>
            )}
          </span>
        )}
      </p>
      <button
        type="button"
        disabled={invalidCustom || !!problem}
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
      <p className="mt-2 text-[11px] text-[#7a7090]">0〜{MAX_GUESTS}名</p>
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
        className="mt-2 min-h-[43px] w-full rounded-lg bg-[#efeaf8] text-center text-sm font-bold text-[#5e5470]"
      >
        キャンセル
      </button>
    </Sheet>
  );
}
