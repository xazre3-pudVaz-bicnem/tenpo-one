'use client';

import { useLayoutEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { enqueueOrderSlipPrint } from '@/app/app/pos/print-actions';
import { Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { nextReservation, type TableView } from './types';

/** 着席（ファーストオーダー）のときに決めるコース・時間 */
export interface WalkInSeatOptions {
  durationMinutes?: number;
  courseId?: string;
}

/** ポップアップの幅（レジのテーブル一覧で使う小さいカード） */
const POP_W = 296;

/** 空席から「注文」で着席するときの人数。人数は注文画面で直す（2026-09-25 店舗要望） */
const DEFAULT_PARTY_SIZE = 1;

/** ポップアップの小さなボタン（日本語＋小さく英語）。見本と同じ並びに使う */
function PopBtn({
  ja,
  en,
  on,
  disabled,
  onClick,
}: {
  ja: string;
  en: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'tap3d flex h-[46px] flex-col items-center justify-center rounded-xl border px-1 text-[12px] font-bold leading-tight disabled:opacity-40',
        on ? 'border-royal bg-royal text-white' : 'border-line bg-white text-navy'
      )}
    >
      {ja}
      <span className={cn('text-[9px] font-semibold', on ? 'text-white/80' : 'text-ink-3')}>{en}</span>
    </button>
  );
}

/** ポップアップの見出し（レジの見本と同じ「テーブル」「印刷」の区切り） */
function Section({ ja, en }: { ja: string; en: string }) {
  return (
    <p className="px-0.5 pt-1 text-[11px] font-bold text-ink-3">
      {ja}
      <span className="ml-1 text-[9px] font-semibold opacity-70">{en}</span>
    </p>
  );
}

export function TableSheet({
  table,
  anchor,
  now,
  canOperate,
  onClose,
  startWalkInAction,
  defaultStayMinutes = 120,
  goToOrderAction,
  completeCleaningAction,
  setTableAvailabilityAction,
  saveTableGroupAction,
  allTables,
  mergeOrdersAction,
  setGuestCountAction,
  setPaymentMemoAction,
  printExpoSlipAction,
  printSelectedItemsAction,
}: {
  table: TableView | null;
  /** 押したテーブルの画面上の位置。その近くに小さく出す */
  anchor?: { x: number; y: number; w: number; h: number } | null;
  now: number;
  canOperate: boolean;
  onClose: () => void;
  startWalkInAction: (tableId: string, partySize: number, options?: WalkInSeatOptions) => Promise<{ orderId: string }>;
  defaultStayMinutes?: number;
  goToOrderAction: (tableId: string) => Promise<{ orderId: string }>;
  completeCleaningAction: (tableId: string) => Promise<void>;
  setTableAvailabilityAction: (tableId: string, unavailable: boolean) => Promise<void>;
  /** まとめる卓の保存（1卓以下で解除）。2026-09-25 店舗要望 */
  saveTableGroupAction: (tableIds: string[]) => Promise<{ error?: string }>;
  /** 同じフロアの卓（テーブルグループ設定で選ぶ） */
  allTables: TableView[];
  /** テーブル合算: もう1つの卓の伝票を、この卓の伝票にまとめる */
  mergeOrdersAction: (targetOrderId: string, sourceOrderId: string) => Promise<void>;
  /** お客様情報: 人数を直す */
  setGuestCountAction: (orderId: string, guestCount: number) => Promise<void>;
  /** 支払メモ: 伝票にメモを残す */
  setPaymentMemoAction: (orderId: string, memo: string) => Promise<{ error?: string }>;
  /** デシャップ伝票印刷 */
  printExpoSlipAction: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 選択印刷 */
  printSelectedItemsAction: (orderId: string, itemIds: string[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const popRef = useRef<HTMLDivElement>(null);

  // 押したテーブルの「上」に出す。上に入らないときだけ、テーブルに重ねて下へ伸ばす。
  // 高さは中身で変わるので、描画後に実寸を測って位置をあてる（state は使わない＝再描画しない）
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el || !anchor) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, anchor.x + anchor.w / 2 - POP_W / 2), Math.max(8, vw - POP_W - 8));
    const above = anchor.y - h - 8;
    const top = above >= 64 ? above : Math.min(Math.max(64, anchor.y), Math.max(64, vh - h - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  });
  const { toast } = useToast();
  /** テーブルグループ設定を開いているか。開いたら同じ組にする卓を選ぶ */
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupPick, setGroupPick] = useState<string[] | null>(null);
  /** 着席中の卓で開いているパネル（合算・選択印刷・お客様情報・支払メモ） */
  const [panel, setPanel] = useState<'merge' | 'print' | 'guest' | 'memo' | null>(null);
  const [printPick, setPrintPick] = useState<string[]>([]);
  const [memoText, setMemoText] = useState('');
  const [guestEdit, setGuestEdit] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  if (!table) return null;

  /**
   * この卓の未会計伝票（古い順）。伝票分割・相席・締め忘れで2枚以上あることがある。
   * 以前は一番新しい伝票しか開けず、古い伝票が会計できないまま卓に残ってしまった（2026-09-24 高田馬場 T12）。
   * ここで全部出して、どれを会計・追加オーダーするか選べるようにする。
   */
  const slips = table.order?.slips ?? [];
  // 1卓＝1組なので、伝票を選ばせる画面は出さない（2026-09-25 店舗要望）。
  // 万一2枚以上残っていても、古いほうから順に会計できるよう常に一番古い伝票を対象にする。
  const selected = slips[0] ?? null;

  const run = (fn: () => Promise<void>) => {
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        toast(e instanceof Error ? e.message : '操作に失敗しました', 'error');
      }
    });
  };

  const goPos = (fn: () => Promise<{ orderId: string }>) => {
    startTransition(async () => {
      try {
        const { orderId } = await fn();
        router.push(`/app/pos?order=${orderId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : '操作に失敗しました', 'error');
      }
    });
  };

  /** お会計伝票をその場で印刷する（レジ画面へ移動しない） */
  const handlePrintBill = () => {
    if (!selected) return;
    startTransition(async () => {
      try {
        const res = await enqueueOrderSlipPrint(selected.id);
        toast(res.ok ? 'お会計伝票を印刷します' : (res.error ?? 'お会計伝票の印刷に失敗しました'), res.ok ? 'success' : 'error');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'お会計伝票の印刷に失敗しました', 'error');
      }
    });
  };

  const status = table.current_status;
  const next = nextReservation(table, now);
  const seated = slips.length > 0 || status === 'seated' || status === 'ordering' || status === 'billing';
  const guests = selected?.guestCount ?? table.order?.guestCount ?? 0;
  const total = selected?.total ?? table.order?.total ?? 0;
  const perGuest = guests > 0 ? Math.round(total / guests) : 0;
  /** テーブル合算で選べる卓＝この卓以外で、未会計の伝票がある卓 */
  const mergeCandidates = allTables.filter(
    (t) => t.id !== table.id && (t.order?.slips.length ?? 0) > 0
  );

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} role="presentation">
      <div
        ref={popRef}
        role="dialog"
        aria-label={table.name}
        onClick={(e) => e.stopPropagation()}
        style={{ width: POP_W, visibility: 'hidden' }}
        className="absolute max-h-[calc(100vh-72px)] overflow-y-auto rounded-2xl border border-line bg-white p-2.5 shadow-[0_18px_44px_rgba(36,20,54,0.28)]"
      >
      {/* 見本と同じく、卓名だけを真ん中に出す（状態はタイルの色で分かる。外を押すと閉じる） */}
      <p className="mb-2 text-center text-[17px] font-extrabold text-navy">{table.name}</p>

      {table.groupTableIds.length > 1 && (
        <div className="mb-2 rounded-lg bg-royal/10 px-2.5 py-1.5 text-[11px] font-bold text-royal">
          グループ{' '}
          {table.groupTableIds
            .map((id) => allTables.find((t) => t.id === id)?.name)
            .filter(Boolean)
            .join(' + ')}
        </div>
      )}

      {next && (
        <div className="mb-2.5 rounded-lg bg-iris-soft px-2.5 py-1.5 text-[11px] text-royal">
          次の予約 <span className="tabular-nums">{next.time}</span>　{next.name.replace(/ ?様$/, '')} 様（{next.partySize}名）
        </div>
      )}

      <div className="space-y-1.5">
        {!seated && status !== 'cleaning' && status !== 'unavailable' && (
          <>
            {/* 見本と同じく「注文」1つだけ。人数は注文画面の人数から直す（2026-09-25 店舗要望） */}
            <Button
              size="pos"
              className="h-[48px] w-full flex-col gap-0 text-[16px] leading-tight"
              disabled={pending}
              onClick={() =>
                goPos(() =>
                  startWalkInAction(table.id, DEFAULT_PARTY_SIZE, {
                    durationMinutes: defaultStayMinutes,
                  })
                )
              }
            >
              注文
              <span className="text-[10px] font-semibold opacity-80">Order</span>
            </Button>

            <div className="my-1 border-t border-line" />
            <Section ja="テーブル" en="Table" />
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="md"
                variant="secondary"
                className="h-[46px] w-full flex-col gap-0 text-[12px] leading-tight"
                disabled={pending || !canOperate}
                onClick={() => run(() => setTableAvailabilityAction(table.id, true))}
              >
                <span className="flex items-center gap-1">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  テーブルブロック
                </span>
                <span className="text-[10px] font-semibold text-ink-3">Block</span>
              </Button>
              <Button
                size="md"
                variant={groupOpen ? 'primary' : 'secondary'}
                className="h-[46px] w-full flex-col gap-0 text-[12px] leading-tight"
                disabled={pending || !canOperate}
                onClick={() => {
                  setGroupPick(table.groupTableIds.length > 0 ? table.groupTableIds : [table.id]);
                  setGroupOpen((v) => !v);
                }}
              >
                テーブルグループ設定
                <span className={cn('text-[10px] font-semibold', groupOpen ? 'opacity-80' : 'text-ink-3')}>
                  Table group
                </span>
              </Button>
            </div>

          </>
        )}

        {/* お客様が入っている卓（2026-09-25 店舗要望：レジの見本と同じ並び）。
            未会計の伝票が残っている卓は、状態が「清掃中」などでも必ずここを出す
            （会計できない伝票が卓に残らないように） */}
        {seated && (
          <>
            {/* まとめ：人数・顧客・来店経路と、いまの金額（かっこ内は客単価） */}
            <div className="flex items-center gap-2 rounded-xl bg-lilac-soft px-2.5 py-2">
              <dl className="min-w-0 flex-1 space-y-0.5 text-[11px] leading-tight">
                <div className="flex gap-1.5">
                  <dt className="w-[42px] shrink-0 font-bold text-ink-2">人数</dt>
                  <dd className="text-navy tabular-nums">{guests}名</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="w-[42px] shrink-0 font-bold text-ink-2">顧客</dt>
                  <dd className="truncate text-navy">{table.order?.customerName ?? '未登録'}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="w-[42px] shrink-0 font-bold text-ink-2">来店</dt>
                  <dd className="truncate text-navy">{table.order?.sourceLabel || '—'}</dd>
                </div>
              </dl>
              <div className="shrink-0 text-right">
                <div className="text-[18px] font-extrabold text-navy tabular-nums">{yen(total)}</div>
                <div className="text-[10px] text-ink-3 tabular-nums">（{yen(perGuest)}）</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="md"
                className="h-[46px] w-full flex-col gap-0 text-[15px] leading-tight"
                disabled={pending}
                onClick={() =>
                  selected ? router.push(`/app/pos?order=${selected.id}`) : goPos(() => goToOrderAction(table.id))
                }
              >
                注文
                <span className="text-[10px] font-semibold opacity-80">Order</span>
              </Button>
              <Button
                size="md"
                variant="navy"
                className="h-[46px] w-full flex-col gap-0 text-[15px] leading-tight"
                disabled={pending || !selected}
                onClick={() => selected && router.push(`/app/pos?order=${selected.id}&checkout=1`)}
              >
                レジ会計
                <span className="text-[10px] font-semibold opacity-80">Checkout</span>
              </Button>
            </div>

            <div className="my-1 border-t border-line" />
            <Section ja="テーブル" en="Table" />
            <div className="grid grid-cols-3 gap-1.5">
              <PopBtn
                ja="テーブル移動"
                en="Move"
                disabled={pending || !selected}
                onClick={() => selected && router.push(`/app/pos?order=${selected.id}&move=1`)}
              />
              <PopBtn
                ja="テーブル合算"
                en="Merge"
                on={panel === 'merge'}
                disabled={pending || !selected}
                onClick={() => setPanel((v) => (v === 'merge' ? null : 'merge'))}
              />
              <PopBtn
                ja="グループ設定"
                en="Group"
                on={groupOpen}
                disabled={pending || !canOperate}
                onClick={() => {
                  setGroupPick(table.groupTableIds.length > 0 ? table.groupTableIds : [table.id]);
                  setGroupOpen((v) => !v);
                }}
              />
            </div>

            {/* テーブル合算: お客様が入っている他の卓を選ぶと、その伝票がこの卓の伝票にまとまる */}
            {panel === 'merge' && (
              <div className="rounded-xl border border-line p-2">
                <p className="mb-1.5 text-[11px] font-bold text-ink-2">
                  どの卓をまとめますか / Merge which table
                </p>
                {mergeCandidates.length === 0 ? (
                  <p className="text-[11px] text-ink-3">ほかにお客様が入っている卓がありません</p>
                ) : (
                  <div className="grid grid-cols-3 gap-1">
                    {mergeCandidates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const src = t.order?.slips[0];
                            if (!selected || !src) throw new Error('伝票が見つかりません');
                            await mergeOrdersAction(selected.id, src.id);
                            setPanel(null);
                            toast(`${t.name} の伝票を ${table.name} にまとめました`);
                            router.refresh();
                          })
                        }
                        className="tap3d h-10 rounded-lg border border-line bg-white text-[12px] font-bold text-navy"
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Section ja="印刷" en="Print" />
            <div className="grid grid-cols-3 gap-1.5">
              <PopBtn ja="会計伝票" en="Bill" disabled={pending || !selected} onClick={handlePrintBill} />
              <PopBtn
                ja="選択印刷"
                en="Selected"
                on={panel === 'print'}
                disabled={pending || !selected || (selected?.lines.length ?? 0) === 0}
                onClick={() => {
                  setPrintPick([]);
                  setPanel((v) => (v === 'print' ? null : 'print'));
                }}
              />
              <PopBtn
                ja="デシャップ伝票"
                en="Expo"
                disabled={pending || !selected}
                onClick={() =>
                  run(async () => {
                    if (!selected) return;
                    const res = await printExpoSlipAction(selected.id);
                    if (!res.ok) throw new Error(res.error ?? 'デシャップ伝票の印刷に失敗しました');
                    toast('デシャップ伝票を印刷します');
                  })
                }
              />
            </div>

            {/* 選択印刷: 出したい品だけを選んで1枚にまとめて出す */}
            {panel === 'print' && selected && (
              <div className="rounded-xl border border-line p-2">
                <p className="mb-1.5 text-[11px] font-bold text-ink-2">印刷する品を選ぶ / Pick items</p>
                <div className="max-h-[160px] space-y-1 overflow-y-auto">
                  {selected.lines.map((l) => {
                    const on = printPick.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setPrintPick((prev) => (on ? prev.filter((id) => id !== l.id) : [...prev, l.id]))
                        }
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px] font-bold',
                          on ? 'border-royal bg-lilac-soft text-royal' : 'border-line bg-white text-navy'
                        )}
                      >
                        <span className="truncate">{l.name}</span>
                        <span className="shrink-0 tabular-nums text-ink-3">x{l.quantity}</span>
                      </button>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  className="mt-1.5 h-[36px] w-full text-[12px]"
                  disabled={pending || printPick.length === 0}
                  onClick={() =>
                    run(async () => {
                      const res = await printSelectedItemsAction(selected.id, printPick);
                      if (!res.ok) throw new Error(res.error ?? '選択印刷に失敗しました');
                      setPanel(null);
                      toast(`${printPick.length}品を印刷します`);
                    })
                  }
                >
                  この{printPick.length}品を印刷 / Print
                </Button>
              </div>
            )}

            <div className="my-1 border-t border-line" />
            <div className="grid grid-cols-2 gap-1.5">
              <PopBtn
                ja="お客様情報"
                en="Guest info"
                on={panel === 'guest'}
                disabled={pending || !selected}
                onClick={() => {
                  setGuestEdit(selected?.guestCount ?? 1);
                  setPanel((v) => (v === 'guest' ? null : 'guest'));
                }}
              />
              <PopBtn
                ja="支払メモ"
                en="Payment note"
                on={panel === 'memo'}
                disabled={pending || !selected}
                onClick={() => {
                  setMemoText('');
                  setPanel((v) => (v === 'memo' ? null : 'memo'));
                }}
              />
            </div>

            {/* お客様情報: いまはここで人数を直す（注文は1名で立つので、入ったらすぐ直せるように） */}
            {panel === 'guest' && (
              <div className="rounded-xl border border-line p-2">
                <p className="mb-1.5 text-[11px] font-bold text-ink-2">人数 / Guests</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="人数を1人減らす"
                    disabled={pending || (guestEdit ?? 1) <= 1}
                    onClick={() => setGuestEdit((n) => Math.max(1, (n ?? 1) - 1))}
                    className="tap3d flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-lilac-soft text-xl font-bold text-royal disabled:opacity-40"
                  >
                    −
                  </button>
                  <div className="flex h-11 flex-1 items-baseline justify-center gap-1 rounded-xl border border-line">
                    <span className="text-2xl font-extrabold tabular-nums text-navy">{guestEdit ?? 1}</span>
                    <span className="text-sm text-ink-3">名</span>
                  </div>
                  <button
                    type="button"
                    aria-label="人数を1人増やす"
                    disabled={pending || (guestEdit ?? 1) >= 99}
                    onClick={() => setGuestEdit((n) => Math.min(99, (n ?? 1) + 1))}
                    className="tap3d flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-lilac-soft text-xl font-bold text-royal disabled:opacity-40"
                  >
                    ＋
                  </button>
                </div>
                <Button
                  size="sm"
                  className="mt-1.5 h-[36px] w-full text-[12px]"
                  disabled={pending || !selected}
                  onClick={() =>
                    run(async () => {
                      if (!selected) return;
                      await setGuestCountAction(selected.id, guestEdit ?? 1);
                      setPanel(null);
                      toast('人数を変えました');
                      router.refresh();
                    })
                  }
                >
                  保存 / Save
                </Button>
              </div>
            )}

            {/* 支払メモ: カードのつもりが現金だった等の理由を伝票に残す */}
            {panel === 'memo' && (
              <div className="rounded-xl border border-line p-2">
                <p className="mb-1.5 text-[11px] font-bold text-ink-2">支払メモ / Payment note</p>
                <input
                  type="text"
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                  maxLength={200}
                  placeholder="例）カード決済のつもりが現金で受領"
                  className="h-10 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-navy placeholder:text-ink-3"
                />
                <Button
                  size="sm"
                  className="mt-1.5 h-[36px] w-full text-[12px]"
                  disabled={pending || !selected}
                  onClick={() =>
                    run(async () => {
                      if (!selected) return;
                      const res = await setPaymentMemoAction(selected.id, memoText);
                      if (res.error) throw new Error(res.error);
                      setPanel(null);
                      toast('支払メモを保存しました');
                      router.refresh();
                    })
                  }
                >
                  保存 / Save
                </Button>
              </div>
            )}
          </>
        )}

        {/* まとめる卓を選ぶ。まとめた卓のどれかに伝票が立つと、同じ組として全部に出る */}
        {groupOpen && (
          <div className="rounded-xl border border-line p-2">
            <p className="mb-1.5 text-[11px] font-bold text-ink-2">
              同じ組にする卓を選ぶ / Tables in this group
            </p>
            <div className="grid max-h-[180px] grid-cols-3 gap-1 overflow-y-auto">
              {allTables
                .filter((t) => t.floor_id === table.floor_id)
                .map((t) => {
                  const on = (groupPick ?? []).includes(t.id);
                  const self = t.id === table.id;
                  return (
                <button
                  key={t.id}
                  type="button"
                  disabled={self}
                  aria-pressed={on}
                  onClick={() =>
                    setGroupPick((prev) => {
                      const list = prev ?? [table.id];
                      return on ? list.filter((id) => id !== t.id) : [...list, t.id];
                    })
                  }
                  className={cn(
                    'tap3d h-9 rounded-lg border text-[12px] font-bold disabled:opacity-100',
                    on ? 'border-royal bg-royal text-white' : 'border-line bg-white text-navy'
                  )}
                >
                  {t.name}
                </button>
                  );
                })}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="h-[36px] w-full text-[12px]"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                const res = await saveTableGroupAction([]);
                if (res.error) throw new Error(res.error);
                setGroupOpen(false);
                toast('グループを解除しました');
                router.refresh();
                  })
                }
              >
                解除 / Clear
              </Button>
              <Button
                size="sm"
                className="h-[36px] w-full text-[12px]"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                const res = await saveTableGroupAction(groupPick ?? [table.id]);
                if (res.error) throw new Error(res.error);
                setGroupOpen(false);
                toast('テーブルグループを保存しました');
                router.refresh();
                  })
                }
              >
                保存 / Save
              </Button>
            </div>
          </div>
        )}

        {status === 'cleaning' && slips.length === 0 && (
          <Button
            size="pos"
            variant="navy"
            className="w-full"
            disabled={pending}
            onClick={() => run(() => completeCleaningAction(table.id))}
          >
            清掃完了
            <span className="text-[10px] font-semibold opacity-80">Cleaned</span>
          </Button>
        )}

        {/* 卓ロック解除：ブロック中の卓だけ（お客様が入っている卓はロックできない。2026-09-24 店舗要望） */}
        {canOperate && slips.length === 0 && status === 'unavailable' && (
          <Button
            size="md"
            variant="secondary"
            className="h-[44px] w-full flex-col gap-0 text-[13px] leading-tight"
            disabled={pending}
            onClick={() => run(() => setTableAvailabilityAction(table.id, false))}
          >
            <span className="flex items-center gap-1.5">
              <LockOpen className="h-4 w-4" aria-hidden />
              ブロック解除
            </span>
            <span className="text-[10px] font-semibold text-ink-3">Unblock</span>
          </Button>
        )}
      </div>
      </div>
    </div>
  );
}
