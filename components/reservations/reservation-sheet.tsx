'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2, Utensils, Clock, Armchair, StickyNote, Route, UserRound, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatTime, weekdayJa } from '@/lib/format';
import { RESERVATION_STATUS, RESERVATION_TRANSITIONS } from '@/lib/reservations';
import { STAY_MINUTE_OPTIONS, withCurrentStay, hmToMinutes } from '@/lib/reservation-time';
import {
  cancelReservation,
  createOrderFromReservation,
  markNoShow,
  moveReservation,
  transitionReservationStatus,
  updateReservationCourse,
  updateReservationDetails,
  updateReservationStaff,
} from '@/app/app/reservations/actions';
import { CREATED_VIA_LABEL, ASSIGNABLE_STATUSES, MOVABLE_STATUSES } from './constants';
import { AssignTableDialog, type AssignableTable } from './assign-table-dialog';
import type { ReservationListRow } from './list-types';

export interface SheetCourseOption {
  id: string;
  name: string;
  durationMinutes: number | null;
}

/** キャンセル理由（見本のレジと同じ3択。2026-09-26 Ronnie） */
const CANCEL_REASONS = [
  { key: 'store', label: '貴店都合', en: 'Store' },
  { key: 'guest', label: 'お客様都合', en: 'Guest' },
  { key: 'no_show', label: '無断キャンセル', en: 'No-show' },
] as const;
type CancelKey = (typeof CANCEL_REASONS)[number]['key'];

/** 「2026/09/27 (日) 18:30〜20:30 2名」 */
function whenLabel(r: ReservationListRow): string {
  const d = r.reservedDate;
  return `${d.replaceAll('-', '/')} (${weekdayJa(d)}) ${formatTime(r.startAt)}〜${formatTime(r.endAt)} ${r.partySize}名`;
}

function jstDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function jstDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 未来店で開始から15分過ぎたら「未連絡」（ホームの一覧と同じ） */
const LATE_MS = 15 * 60_000;
function statusChip(r: ReservationListRow, now: number): { label: string; className: string } {
  if (r.status === 'pending' || r.status === 'confirmed' || r.status === 'waiting') {
    return now > new Date(r.startAt).getTime() + LATE_MS
      ? { label: '未連絡', className: 'border-danger text-danger' }
      : { label: '来店待ち', className: 'border-royal text-royal' };
  }
  const s = RESERVATION_STATUS[r.status];
  return { label: s?.label ?? r.status, className: 'border-ink-3 text-ink-2' };
}

function InfoRow({ icon, label, children, action }: { icon: React.ReactNode; label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-b-0">
      <span className="mt-0.5 w-5 shrink-0 text-ink-3">{icon}</span>
      <span className="w-[88px] shrink-0 text-[13px] text-ink-3">{label}</span>
      <div className="min-w-0 flex-1 text-[14px] text-ink">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * レジ iPad の「本日のご予約一覧」から開く予約詳細（2026-09-26 Ronnie 要望・見本のレジと同じ並び）。
 * - 上：状態・日時・人数、お名前・電話・来店回数
 * - 中：コース／確保時間／テーブル（変更）／備考（要望・メモ）／予約経路／担当者／受付日
 * - 下：予約をキャンセルする（貴店都合・お客様都合・無断キャンセル）／新規・リピート／来店（着席・注文へ）
 * - 右上「変更する」で 日時・人数・電話・コース・ご要望・担当者 を直す
 * 店舗台帳の詳細ダイアログ（reservation-detail-dialog.tsx）と同じサーバー処理を使う。
 */
export function ReservationSheet({
  reservation,
  now,
  tables,
  staffOptions,
  courses,
  onClose,
}: {
  reservation: ReservationListRow;
  now: number;
  tables: AssignableTable[];
  staffOptions: { id: string; name: string }[];
  courses: SheetCourseOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [cancelPick, setCancelPick] = useState(false);
  const [cancelKey, setCancelKey] = useState<CancelKey | null>(null);
  const r = reservation;
  const chip = statusChip(r, now);
  const stayMinutes = Math.max(0, Math.round((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 60000));

  // ---- 変更フォーム ----
  const [form, setForm] = useState({
    date: r.reservedDate,
    time: formatTime(r.startAt),
    stay: stayMinutes,
    adults: r.adults,
    children: r.children,
    phone: r.guestPhone,
    courseId: r.courseId ?? '',
    request: r.requestNote ?? '',
    staffId: r.staffId ?? '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const run = (fn: () => Promise<unknown>, ok?: string, after?: () => void) =>
    startTransition(async () => {
      try {
        await fn();
        if (ok) toast(ok);
        router.refresh();
        after?.();
      } catch (e) {
        toast(e instanceof Error ? e.message : '処理に失敗しました', 'error');
      }
    });

  const save = () =>
    run(
      async () => {
        const timeChanged = form.date !== r.reservedDate || form.time !== formatTime(r.startAt) || form.stay !== stayMinutes;
        if (timeChanged) {
          if (!MOVABLE_STATUSES.includes(r.status)) throw new Error('この状態の予約は日時を変更できません');
          if (hmToMinutes(form.time) == null) throw new Error('開始時間の形式が正しくありません');
          await moveReservation(r.id, { date: form.date, time: form.time, stayMinutes: form.stay });
        }
        await updateReservationDetails(r.id, {
          adults: form.adults,
          children: form.children,
          guestPhone: form.phone,
          guestEmail: r.guestEmail,
          seatType: r.seatType,
          purpose: r.purpose,
          allergyNote: r.allergyNote,
          requestNote: form.request || null,
        });
        if ((form.courseId || null) !== (r.courseId ?? null)) await updateReservationCourse(r.id, form.courseId || null);
        if ((form.staffId || null) !== (r.staffId ?? null)) await updateReservationStaff(r.id, form.staffId || null);
      },
      '予約を変更しました',
      () => setEditing(false)
    );

  // ---- 状態を進める（来店 → 着席 → 注文へ） ----
  const next = RESERVATION_TRANSITIONS[r.status] ?? [];
  const forward: { label: string; en: string; onClick: () => void } | null = next.includes('arrived')
    ? { label: '来店', en: 'Arrived', onClick: () => run(() => transitionReservationStatus(r.id, 'arrived'), '来店にしました') }
    : next.includes('seated')
      ? { label: '着席', en: 'Seated', onClick: () => run(() => transitionReservationStatus(r.id, 'seated'), '着席にしました') }
      : r.status === 'seated' || r.status === 'billing'
        ? { label: '注文へ', en: 'Order', onClick: () => run(() => createOrderFromReservation(r.id)) }
        : null;
  const canCancel = next.includes('cancelled');
  const canNoShow = next.includes('no_show');

  const doCancel = (note: string) => {
    if (!cancelKey) return;
    const reason = CANCEL_REASONS.find((c) => c.key === cancelKey)!;
    run(
      () =>
        cancelKey === 'no_show'
          ? markNoShow(r.id, note || undefined)
          : cancelReservation(r.id, note ? `${reason.label}：${note}` : reason.label),
      cancelKey === 'no_show' ? '無断キャンセルを記録しました' : '予約をキャンセルしました',
      onClose
    );
  };

  const repeat = r.visitCount != null && r.visitCount > 1 ? 'リピート' : '初回';
  const stayOptions = withCurrentStay(STAY_MINUTE_OPTIONS, form.stay);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-lilac-soft" role="dialog" aria-modal="true" aria-label="予約詳細">
      {/* ヘッダー */}
      <header className="flex items-center justify-between bg-royal px-3 py-2.5 text-white">
        <button type="button" onClick={onClose} aria-label="閉じる" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-white/10">
          <X className="h-6 w-6" />
        </button>
        <h2 className="text-[17px] font-bold">予約詳細</h2>
        {editing ? (
          <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-lg border border-white/70 px-3 text-[14px] font-bold">
            やめる
          </button>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="h-10 rounded-lg border border-white/70 px-3 text-[14px] font-bold">
            変更する
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          {/* 状態・日時・人数 */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn('rounded border-2 px-2 py-0.5 text-[13px] font-bold', chip.className)}>{chip.label}</span>
            <span className="text-[17px] font-bold text-ink tabular-nums">{whenLabel(r)}</span>
          </div>

          {/* お客様 */}
          <div className="mt-3 rounded-xl bg-white/70 px-4 py-3">
            <p className="text-[19px] font-bold text-ink">{r.guestName.replace(/ ?様$/, '')} 様</p>
            <p className="mt-0.5 text-[15px] text-ink-2 tabular-nums">[ {r.guestPhone || '-'} ]</p>
            <p className="mt-1 text-[12.5px] text-ink-3">
              来店回数：{r.visitCount != null ? (r.visitCount > 0 ? `${r.visitCount}回` : '初回') : '初回'}　　前回来店日：{jstDate(r.lastVisitAt)}
            </p>
          </div>

          {editing ? (
            /* ---- 変更フォーム ---- */
            <div className="mt-4 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="rs-date">日付</Label>
                <Input id="rs-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="h-12" />
              </div>
              <div>
                <Label htmlFor="rs-time">開始時間</Label>
                <Input id="rs-time" type="time" step={900} value={form.time} onChange={(e) => set('time', e.target.value)} className="h-12" />
              </div>
              <div>
                <Label htmlFor="rs-stay">確保時間</Label>
                <Select id="rs-stay" value={String(form.stay)} onChange={(e) => set('stay', Number(e.target.value))} className="h-12">
                  {stayOptions.map((m) => (
                    <option key={m} value={m}>
                      {m % 60 === 0 ? `${m / 60}時間` : `${Math.floor(m / 60)}時間${m % 60}分`}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="rs-adults">大人</Label>
                  <Input id="rs-adults" type="number" inputMode="numeric" min={0} value={form.adults} onChange={(e) => set('adults', Number(e.target.value))} className="h-12" />
                </div>
                <div>
                  <Label htmlFor="rs-children">子ども</Label>
                  <Input id="rs-children" type="number" inputMode="numeric" min={0} value={form.children} onChange={(e) => set('children', Number(e.target.value))} className="h-12" />
                </div>
              </div>
              <div>
                <Label htmlFor="rs-phone">電話番号</Label>
                <Input id="rs-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className="h-12" />
              </div>
              <div>
                <Label htmlFor="rs-course">コース</Label>
                <Select id="rs-course" value={form.courseId} onChange={(e) => set('courseId', e.target.value)} className="h-12">
                  <option value="">なし</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="rs-staff">担当者</Label>
                <Select id="rs-staff" value={form.staffId} onChange={(e) => set('staffId', e.target.value)} className="h-12">
                  <option value="">未設定</option>
                  {staffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="rs-request">ご要望</Label>
                <Textarea id="rs-request" rows={3} value={form.request} onChange={(e) => set('request', e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="secondary" size="pos" className="h-12" onClick={() => setEditing(false)} disabled={pending}>
                  やめる
                </Button>
                <Button size="pos" className="h-12 min-w-[140px]" onClick={save} disabled={pending}>
                  {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  保存する
                </Button>
              </div>
            </div>
          ) : (
            /* ---- 表示 ---- */
            <div className="mt-4">
              <InfoRow icon={<Utensils className="h-4 w-4" />} label="コース">
                {r.courseName ?? '-'}
              </InfoRow>
              <InfoRow icon={<Clock className="h-4 w-4" />} label="確保時間">
                {stayMinutes % 60 === 0 ? `${stayMinutes / 60}時間` : `${Math.floor(stayMinutes / 60)}時間${stayMinutes % 60}分`}
              </InfoRow>
              <InfoRow
                icon={<Armchair className="h-4 w-4" />}
                label="テーブル"
                action={
                  ASSIGNABLE_STATUSES.includes(r.status) ? (
                    <AssignTableDialog
                      reservationId={r.id}
                      storeId={r.storeId}
                      partySize={r.partySize}
                      startAt={r.startAt}
                      endAt={r.endAt}
                      currentTableIds={r.tableIds}
                      tables={tables}
                      triggerLabel="テーブルを変更する"
                      triggerVariant="ghost"
                    />
                  ) : undefined
                }
              >
                {r.tableNames.length > 0 ? r.tableNames.join('、') : '席未定'}
              </InfoRow>
              <InfoRow icon={<StickyNote className="h-4 w-4" />} label="備考">
                <p className="text-[13px] text-ink-3">【要望】</p>
                <p className="whitespace-pre-wrap">{r.requestNote || '-'}</p>
                {r.allergyNote && (
                  <>
                    <p className="mt-2 text-[13px] text-ink-3">【アレルギー】</p>
                    <p className="whitespace-pre-wrap">{r.allergyNote}</p>
                  </>
                )}
                <p className="mt-2 border-t border-line pt-2 text-[13px] text-ink-3">【メモ】</p>
                <p className="whitespace-pre-wrap">{r.memo || '-'}</p>
              </InfoRow>
              <InfoRow icon={<Route className="h-4 w-4" />} label="予約経路">
                {CREATED_VIA_LABEL[r.createdVia] ?? r.createdVia}
                {r.sourceName ? `（${r.sourceName}）` : ''}
              </InfoRow>
              <InfoRow icon={<UserRound className="h-4 w-4" />} label="担当者">
                {r.staffName ?? '-'}
              </InfoRow>
              <p className="mt-2 text-right text-[12px] text-ink-3">受付日：{jstDateTime(r.createdAt)}　予約コード {r.code}</p>
            </div>
          )}
        </div>
      </div>

      {/* フッター */}
      {!editing && (
        <footer className="flex items-center justify-between gap-3 border-t border-line bg-white px-4 py-3">
          <div className="relative">
            {(canCancel || canNoShow) && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setCancelPick((v) => !v)}
                className="h-14 rounded-xl border border-line bg-lilac-soft px-4 text-[14px] font-bold text-ink disabled:opacity-50"
              >
                予約をキャンセルする
              </button>
            )}
            {cancelPick && (
              <div className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-line bg-white p-2 shadow-xl">
                <p className="px-2 py-1.5 text-center text-[12px] text-ink-3">キャンセル理由を選択してください。</p>
                {CANCEL_REASONS.filter((c) => (c.key === 'no_show' ? canNoShow : canCancel)).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      setCancelPick(false);
                      setCancelKey(c.key);
                    }}
                    className="flex h-12 w-full items-center justify-center rounded-lg text-[16px] font-bold text-royal hover:bg-lilac-soft"
                  >
                    {c.label}
                    <span className="ml-2 text-[11px] font-normal text-ink-3">{c.en}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-ink-3">
              新規・リピート
              <span className="ml-2 inline-flex h-10 items-center rounded-lg border border-line bg-white px-3 text-[14px] font-bold text-ink">
                {repeat}
                <ChevronDown className="ml-1 h-3.5 w-3.5 text-ink-3" aria-hidden />
              </span>
            </span>
            {forward && (
              <Button size="pos" className="h-14 min-w-[120px] text-[17px]" disabled={pending} onClick={forward.onClick}>
                {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {forward.label}
                <span className="ml-1.5 text-[11px] font-normal opacity-80">{forward.en}</span>
              </Button>
            )}
          </div>
        </footer>
      )}

      <ConfirmDialog
        open={cancelKey != null}
        onClose={() => setCancelKey(null)}
        title={cancelKey === 'no_show' ? '無断キャンセルとして記録' : `予約をキャンセル（${CANCEL_REASONS.find((c) => c.key === cancelKey)?.label ?? ''}）`}
        message={
          cancelKey === 'no_show'
            ? `${r.guestName} 様 ${formatTime(r.startAt)} ${r.partySize}名 の予約を「無断キャンセル」として記録します。`
            : `${r.guestName} 様 ${formatTime(r.startAt)} ${r.partySize}名 の予約をキャンセルします。メモがあれば入れてください。`
        }
        confirmLabel={cancelKey === 'no_show' ? '記録する' : 'キャンセルする'}
        requireReason={false}
        onConfirm={(note) => doCancel(note.trim())}
      />
    </div>
  );
}
