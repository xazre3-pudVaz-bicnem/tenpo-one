'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cancelApprovers, CLERK_ROLE_LABELS, type ClerkRole } from '@/lib/clerk-roles';
import {
  CLERK_SESSION_KEY,
  isClerkSessionExpired,
  parseClerkSession,
  serializeClerkSession,
  type ClerkSession,
} from '@/lib/clerk-session';

export interface GateClerk {
  id: string;
  name: string;
  role: ClerkRole;
}

export interface ApproverAnswer {
  /** 承認が取れた（店長以上が未登録の店舗は承認なしで true） */
  ok: boolean;
  approver: GateClerk | null;
}

interface ClerkGateValue {
  /** いまレジを操作している担当者。3分さわらないと切れる */
  clerk: ClerkSession | null;
  clerks: GateClerk[];
  /** 取消を承認できる担当者（店長以上） */
  managers: GateClerk[];
  /** 取消の前に店長以上の承認をもらう */
  askApprover: () => Promise<ApproverAnswer>;
  /** 担当者を選び直す */
  change: () => void;
}

const ClerkGateContext = createContext<ClerkGateValue | null>(null);

/** レジ以外（パソコン・ハンディ）では null。呼ぶ側は null なら今まで通りの動きにする */
export function useClerkGate(): ClerkGateValue | null {
  return useContext(ClerkGateContext);
}

/** 期限の書き戻しは押すたびではなく10秒に1回（3分の判定には十分） */
const TOUCH_WRITE_MS = 10_000;
/** 切れていないかを見に行く間隔 */
const CHECK_MS = 15_000;

function readStored(): ClerkSession | null {
  try {
    return parseClerkSession(window.sessionStorage.getItem(CLERK_SESSION_KEY), Date.now());
  } catch {
    return null;
  }
}

function writeStored(session: ClerkSession | null) {
  try {
    if (session) window.sessionStorage.setItem(CLERK_SESSION_KEY, serializeClerkSession(session));
    else window.sessionStorage.removeItem(CLERK_SESSION_KEY);
  } catch {
    // プライベートモード等で使えなくても、担当者はこの画面の間だけ覚えておけばよい
  }
}

/**
 * レジ（iPad）の担当者ポップアップ。
 *
 * 店舗要望（2026-09-24）:
 *   - オーダー・会計・レジ閉め・入出金、どれをやるときも担当者が自動で出る
 *   - 3分だれもレジを触らなかったら、もう一度選んでもらう
 *   - 取消は店長以上の担当者の承認が必要
 *
 * レジ端末（/register-login でログインした iPad）だけで出す。パソコンとハンディは今まで通り。
 * 担当者が1人も登録されていない店舗では何も出さない（レジが止まらないように）。
 */
export function ClerkGate({ clerks, children }: { clerks: GateClerk[]; children: React.ReactNode }) {
  const [clerk, setClerk] = useState<ClerkSession | null>(null);
  const [picking, setPicking] = useState(false);
  const [approving, setApproving] = useState(false);
  const clerkRef = useRef<ClerkSession | null>(null);
  const resolveApprover = useRef<((answer: ApproverAnswer) => void) | null>(null);

  const managers = useMemo(() => cancelApprovers(clerks), [clerks]);
  const enabled = clerks.length > 0;

  // 画面を開いたとき：覚えていれば続き、無ければ（＝切れていれば）選んでもらう。
  // sessionStorage は端末側にしか無いので、描画のあと（mount 後）に反映する。
  useEffect(() => {
    if (!enabled) return;
    const stored = readStored();
    const keep = stored && clerks.some((c) => c.id === stored.id) ? stored : null;
    clerkRef.current = keep;
    if (!keep) writeStored(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 端末に覚えた担当者は client でしか読めない
    setClerk(keep);
    setPicking(!keep);
  }, [enabled, clerks]);

  // さわっている間は期限を延ばす
  useEffect(() => {
    if (!enabled) return;
    const touch = () => {
      const current = clerkRef.current;
      if (!current) return;
      const now = Date.now();
      if (now - current.at < TOUCH_WRITE_MS) return;
      const next = { ...current, at: now };
      clerkRef.current = next;
      writeStored(next);
    };
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('keydown', touch, true);
    return () => {
      window.removeEventListener('pointerdown', touch, true);
      window.removeEventListener('keydown', touch, true);
    };
  }, [enabled]);

  // 3分さわらなかったら切って、もう一度選んでもらう
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      const current = clerkRef.current;
      if (!current) return;
      if (!isClerkSessionExpired(current.at, Date.now())) return;
      clerkRef.current = null;
      writeStored(null);
      setClerk(null);
      setPicking(true);
    }, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const choose = useCallback((picked: GateClerk) => {
    const next: ClerkSession = { id: picked.id, name: picked.name, role: picked.role, at: Date.now() };
    clerkRef.current = next;
    writeStored(next);
    setClerk(next);
    setPicking(false);
  }, []);

  const askApprover = useCallback(
    () =>
      new Promise<ApproverAnswer>((resolve) => {
        // 店長以上をまだ登録していない店舗は止めない（設定 > POS担当者 で役職を決めてもらう）
        if (managers.length === 0) {
          resolve({ ok: true, approver: null });
          return;
        }
        resolveApprover.current = resolve;
        setApproving(true);
      }),
    [managers]
  );

  const answerApprover = useCallback((answer: ApproverAnswer) => {
    setApproving(false);
    const resolve = resolveApprover.current;
    resolveApprover.current = null;
    resolve?.(answer);
  }, []);

  const value = useMemo<ClerkGateValue>(
    () => ({ clerk, clerks, managers, askApprover, change: () => setPicking(true) }),
    [clerk, clerks, managers, askApprover]
  );

  return (
    <ClerkGateContext.Provider value={value}>
      {children}
      {picking && (
        <ClerkPickerOverlay
          title="担当者を選んでください"
          en="Who is on the register?"
          note="3分そのままだと、もう一度出ます / Asks again after 3 min"
          clerks={clerks}
          onPick={choose}
          onCancel={clerk ? () => setPicking(false) : undefined}
        />
      )}
      {approving && (
        <ClerkPickerOverlay
          title="取消には店長の承認が必要です"
          en="Manager approval required to cancel"
          note="店長以上を選んでください / Manager or above"
          clerks={managers}
          manager
          onPick={(picked) => answerApprover({ ok: true, approver: picked })}
          onCancel={() => answerApprover({ ok: false, approver: null })}
        />
      )}
    </ClerkGateContext.Provider>
  );
}

/** 担当者を選ぶ小さいポップアップ（レジ＝iPad なので指で押せる大きさ・文字は小さめ） */
function ClerkPickerOverlay({
  title,
  en,
  note,
  clerks,
  manager,
  onPick,
  onCancel,
}: {
  title: string;
  en: string;
  note: string;
  clerks: GateClerk[];
  manager?: boolean;
  onPick: (clerk: GateClerk) => void;
  /** 省略すると閉じられない（担当者を選ぶまでレジを使わせない） */
  onCancel?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy/60" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-[300px] rounded-xl bg-white p-3 shadow-xl"
      >
        <div className="flex items-center gap-1.5">
          {manager ? (
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
          ) : (
            <UserRound className="h-3.5 w-3.5 shrink-0 text-royal" aria-hidden />
          )}
          <p className={cn('text-[13px] font-bold leading-tight', manager ? 'text-danger' : 'text-navy')}>
            {title}
            <span className="ml-1.5 text-[10px] font-normal text-ink-3">{en}</span>
          </p>
        </div>

        <ul className="mt-2 max-h-[52vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {clerks.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className="flex h-10 w-full items-center justify-between gap-2 bg-white px-3 text-left hover:bg-lilac-soft"
              >
                <span className="truncate text-[13px] font-bold text-navy">{c.name}</span>
                <span className="shrink-0 text-[10px] text-ink-3">{CLERK_ROLE_LABELS[c.role]}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[10px] leading-tight text-ink-3">{note}</p>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-lilac-soft"
            >
              やめる
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 上部バーに出す「いまの担当者」。押すと選び直せる。
 * レジ以外（ClerkGate の外）では何も出さない。
 */
export function ClerkChip() {
  const gate = useClerkGate();
  if (!gate || gate.clerks.length === 0) return null;
  return (
    <button
      type="button"
      onClick={gate.change}
      title="担当者を選び直す / Change clerk"
      className="inline-flex max-w-[160px] items-center gap-1.5 rounded-full bg-white/12 py-1 pr-3 pl-2 text-[13px] font-medium whitespace-nowrap hover:bg-white/20"
    >
      <UserRound className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="truncate">{gate.clerk ? gate.clerk.name : '担当者'}</span>
    </button>
  );
}
