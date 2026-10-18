"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Armchair,
  CalendarClock,
  ClipboardList,
  Mail,
  MessageSquareText,
  NotebookPen,
  Phone,
  Tag,
  UserRound,
  Users,
  Utensils,
  X,
  Loader2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import {
  assignTables,
  cancelReservation,
  markNoShow,
  transitionReservationStatus,
} from "@/app/app/reservations/actions";
import { stayLabel } from "@/lib/reservation-entry";
import { TableSuggest } from "@/components/reservations/entry/entry-parts";
import { TagChips } from "@/components/reservations/entry/tag-chips";
import { useReservationEntryData } from "@/components/reservations/entry/use-entry-data";
import type { HandyReservationRow } from "./handy-reservation-list";

/** 詳細から操作できる予約（来店前） */
const OPEN_STATUSES = new Set(["pending", "confirmed", "waiting"]);
/** キャンセル理由（2026-10-19 Ronnie「レストランボードと同じ：貴店都合・お客様都合・無断キャンセル」） */
const CANCEL_REASONS = ["貴店都合", "お客様都合", "無断キャンセル"] as const;

/** 'HH:MM'〜'HH:MM' の分（日をまたぐときは翌日として） */
function minutesBetween(a: string, b: string | null): number {
  if (!b) return 120;
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  const d = bh * 60 + bm - (ah * 60 + am);
  return d > 0 ? d : d + 24 * 60;
}

/**
 * 予約の詳細（2026-10-16 Ronnie「予約一覧を押したら詳細をポップアップで」）。
 * 一覧では1行に切っている要望・メモも全部出す。電話・メールはタップでかけられる。着席済みなら「HANDYで注文」。
 * 2026-10-19 Ronnie「レストランボードのように詳細から操作できるように」→ 来店・予約キャンセル（理由：貴店都合・
 * お客様都合・無断キャンセル）・テーブル変更（その時間に空いている卓・ピッタリ）。確保時間・キーワードも出す。
 * 操作はレジの予約台帳と同じサーバーの処理（権限も同じ）。
 */
export function HandyReservationDetail({
  reservation: r,
  statusTone,
  dateLabel,
  actions,
  onClose,
}: {
  reservation: HandyReservationRow;
  /** 来店・キャンセル・テーブル変更（無ければ見るだけ） */
  actions?: {
    storeId: string;
    date: string;
    today: string;
    canWrite: boolean;
    canCancel: boolean;
  };
  /** 一覧と同じ状態のバッジの色 */
  statusTone: string;
  /** 10/16（金） */
  dateLabel?: string;
  onClose: () => void;
}) {
  // Esc で閉じる・後ろをスクロールさせない
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const guests =
    r.adults != null || r.children != null
      ? [
          r.adults ? `大人 ${r.adults}` : null,
          r.children ? `子ども ${r.children}` : null,
        ]
          .filter(Boolean)
          .join("・")
      : "";
  const request = r.request ?? (r.memo == null ? r.note : null);
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<null | "cancel" | "tables">(null);
  const [nowMs] = useState(() => Date.now());
  const stay = minutesBetween(r.time, r.endTime);
  const canAct = !!actions?.canWrite && OPEN_STATUSES.has(r.status);
  const [pickedTables, setPickedTables] = useState<string[]>(r.tableIds ?? []);
  const { data: entry, loading: entryLoading } = useReservationEntryData(
    mode === "tables" && actions ? actions.storeId : "",
    actions?.date ?? "",
  );

  const run = (fn: () => Promise<unknown>, done: string) =>
    startTransition(async () => {
      try {
        await fn();
        toast(done);
        router.refresh();
        onClose();
      } catch (e) {
        toast(e instanceof Error ? e.message : "変更できませんでした", "error");
      }
    });
  const arrive = () =>
    run(async () => {
      // 仮予約はいったん確定にしてから来店
      if (r.status === "pending")
        await transitionReservationStatus(r.id, "confirmed");
      await transitionReservationStatus(r.id, "arrived");
    }, `${r.name} 様を来店にしました`);
  const cancel = (reason: (typeof CANCEL_REASONS)[number]) =>
    run(
      () =>
        reason === "無断キャンセル"
          ? markNoShow(r.id, reason)
          : cancelReservation(r.id, reason),
      reason === "無断キャンセル"
        ? "無断キャンセルにしました"
        : `キャンセルしました（${reason}）`,
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${r.name} 様の予約`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#29272588] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-10px_40px_#0004] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 上：状態・予約番号・閉じる */}
        <div className="flex items-center gap-2 border-b border-[#efe9e1] px-4 pt-3 pb-2.5">
          <span
            className={cn(
              "rounded-[4px] border-[1.5px] px-1.5 py-px text-[11px] font-bold",
              statusTone,
            )}
          >
            {r.statusLabel}
          </span>
          {r.code && (
            <span className="text-[11px] text-[#766b62] tabular-nums">
              予約番号 {r.code}
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-full text-[#5c5650] active:bg-[#f3efe8]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
          {/* お名前・日時・人数 */}
          <p className="text-[19px] leading-snug font-bold break-words text-[#292725]">
            {r.name} 様
          </p>
          {r.nameKana && (
            <p className="text-[11.5px] text-[#766b62]">{r.nameKana}</p>
          )}
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div className="rounded-[10px] bg-[#f9ede6] px-3 py-2">
              <p className="flex items-center gap-1 text-[10.5px] font-semibold text-[#9f4630]">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                {dateLabel ?? "日時"}
              </p>
              <p className="mt-0.5 text-[17px] font-bold text-[#292725] tabular-nums">
                {r.time}〜{r.endTime ?? ""}
              </p>
            </div>
            <div className="rounded-[10px] bg-[#f3efe8] px-3 py-2">
              <p className="flex items-center gap-1 text-[10.5px] font-semibold text-[#5c5650]">
                <Users className="h-3.5 w-3.5" aria-hidden />
                人数
              </p>
              <p className="mt-0.5 text-[17px] font-bold text-[#292725] tabular-nums">
                {r.partySize}名
                {guests && (
                  <span className="ml-1 text-[11px] font-semibold text-[#766b62]">
                    （{guests}）
                  </span>
                )}
              </p>
            </div>
          </div>

          <dl className="mt-3 divide-y divide-[#f1ece4] rounded-[10px] border border-[#ece6dd]">
            <Row icon={Armchair} label="席">
              {r.tableLabel}
              {r.seatType ? (
                <span className="ml-1 text-[11px] text-[#766b62]">
                  （希望：{r.seatType}）
                </span>
              ) : null}
            </Row>
            <Row icon={Utensils} label="コース">
              {r.courseName || "-"}
            </Row>
            <Row icon={Clock} label="確保時間">
              {stayLabel(stay)}
            </Row>
            <Row icon={Tag} label="キーワード">
              {r.tags && r.tags.length > 0 ? <TagChips tags={r.tags} /> : "-"}
            </Row>
            <Row icon={Tag} label="経路">
              {r.sourceLabel || "-"}
            </Row>
            {r.purpose && (
              <Row icon={ClipboardList} label="利用目的">
                {r.purpose}
              </Row>
            )}
            <Row icon={UserRound} label="担当">
              {r.clerkName || "-"}
            </Row>
            <Row icon={Phone} label="電話">
              {r.phone ? (
                <a
                  href={`tel:${r.phone}`}
                  className="font-bold text-[#9f4630] underline-offset-2 tabular-nums active:underline"
                >
                  {r.phone}
                </a>
              ) : (
                "-"
              )}
            </Row>
            {r.email && (
              <Row icon={Mail} label="メール">
                <a
                  href={`mailto:${r.email}`}
                  className="break-all text-[#9f4630] underline-offset-2 active:underline"
                >
                  {r.email}
                </a>
              </Row>
            )}
            {r.allergy && (
              <Row icon={AlertTriangle} label="アレルギー" strong>
                {r.allergy}
              </Row>
            )}
            <Row icon={MessageSquareText} label="要望" multiline>
              {request || "-"}
            </Row>
            <Row icon={NotebookPen} label="メモ" multiline>
              {r.memo || "-"}
            </Row>
            {r.cancelReason && (
              <Row icon={X} label="キャンセル理由" multiline>
                {r.cancelReason}
              </Row>
            )}
          </dl>
          {r.receivedAt && (
            <p className="mt-2 text-right text-[10.5px] text-[#766b62] tabular-nums">
              受付 {r.receivedAt}
            </p>
          )}
        </div>

        {/* 操作：テーブル変更（その時間に空いている卓・ピッタリ）／キャンセル理由 */}
        {canAct && mode === "tables" && actions && (
          <div className="border-t border-[#efe9e1] bg-[#fbf9f5] px-4 pt-2.5 pb-3">
            <div className="max-h-[38dvh] overflow-x-hidden overflow-y-auto pt-1">
              <TableSuggest
                tables={entry.tables}
                booked={entry.booked}
                date={actions.date}
                time={r.time}
                stayMinutes={stay}
                party={r.partySize}
                today={actions.today}
                nowMs={nowMs}
                selected={pickedTables}
                loading={entryLoading}
                excludeReservationId={r.id}
                showLater={false}
                onSelect={(ids) => setPickedTables(ids)}
              />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="min-h-[44px] rounded-[10px] border border-[#e5dfd5] bg-white text-[14px] font-bold text-[#5c5650]"
              >
                やめる
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => assignTables(r.id, pickedTables),
                    "テーブルを変更しました",
                  )
                }
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[10px] bg-[#bc5940] text-[14px] font-bold text-white disabled:opacity-50"
              >
                {pending && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                このテーブルにする
              </button>
            </div>
          </div>
        )}
        {canAct && mode === "cancel" && (
          <div className="border-t border-[#efe9e1] bg-[#fbf9f5] px-4 pt-2.5 pb-3">
            <p className="mb-2 text-[13px] font-bold text-[#45403b]">
              キャンセル理由を選んでください
            </p>
            <div className="grid gap-2">
              {CANCEL_REASONS.map((reason) => {
                const allowed =
                  reason === "無断キャンセル"
                    ? r.status !== "pending"
                    : !!actions?.canCancel;
                return (
                  <button
                    key={reason}
                    type="button"
                    disabled={pending || !allowed}
                    onClick={() => cancel(reason)}
                    className={cn(
                      "min-h-[46px] rounded-full text-[15px] font-bold disabled:opacity-40",
                      reason === "無断キャンセル"
                        ? "bg-[#f6e4df] text-[#c62828]"
                        : "bg-[#ece7e0] text-[#292725]",
                    )}
                  >
                    {reason}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setMode(null)}
                className="min-h-[40px] text-[13px] font-bold text-[#766b62]"
              >
                やめる
              </button>
            </div>
          </div>
        )}
        {canAct && mode === null && (
          <div className="grid grid-cols-3 gap-2 border-t border-[#efe9e1] px-4 pt-2.5">
            <button
              type="button"
              onClick={() => setMode("cancel")}
              className="min-h-[46px] rounded-[10px] border border-[#e5dfd5] bg-white text-[13.5px] font-bold text-[#c62828] active:bg-[#f3efe8]"
            >
              予約キャンセル
            </button>
            <button
              type="button"
              onClick={() => setMode("tables")}
              className="min-h-[46px] rounded-[10px] border border-[#e5dfd5] bg-white text-[13.5px] font-bold text-[#292725] active:bg-[#f3efe8]"
            >
              テーブル変更
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={arrive}
              className="flex min-h-[46px] items-center justify-center gap-1 rounded-[10px] bg-[#bc5940] text-[14px] font-bold text-white active:bg-[#9f4630] disabled:opacity-50"
            >
              {pending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              来店
            </button>
          </div>
        )}

        {/* 下：電話・注文・閉じる */}
        <div className="flex gap-2 border-t border-[#efe9e1] px-4 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {r.phone && (
            <a
              href={`tel:${r.phone}`}
              className="flex min-h-[46px] flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#e5dfd5] bg-white text-[14px] font-bold text-[#292725] active:bg-[#f3efe8]"
            >
              <Phone className="h-4 w-4" aria-hidden />
              電話する
            </a>
          )}
          {r.tableId && r.status !== "cancelled" && r.status !== "no_show" && (
            <Link
              href={`/handy/${r.tableId}`}
              className="flex min-h-[46px] flex-1 items-center justify-center rounded-[10px] bg-[#bc5940] text-[14px] font-bold text-white active:bg-[#9f4630]"
            >
              HANDYで注文
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[46px] flex-1 items-center justify-center rounded-[10px] bg-[#292725] text-[14px] font-bold text-white active:bg-[#45403b]"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
  multiline,
  strong,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
  multiline?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 px-3 py-2",
        multiline ? "items-start" : "items-center",
      )}
    >
      <dt className="flex w-[78px] shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[#766b62]">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 flex-1 text-[13.5px] text-[#292725]",
          multiline && "leading-relaxed break-words whitespace-pre-wrap",
          strong && "font-bold text-[#c62828]",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
