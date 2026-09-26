'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, CornerDownRight, House, LogOut, Zap } from 'lucide-react';
import { NO_CLERK_NAME } from '@/lib/handy-clerk';

export interface HandyClerkOption {
  id: string;
  name: string;
}

/**
 * ログイン画面（承認済みレイアウト 2026-09-21 の login）。
 *
 * 端末は QR で登録済み（端末用アカウントでログイン済み）なので、ここで選ぶのは
 * 「誰が操作しているか」＝POS担当者だけ。パスワードは無い。
 * 左上の「POS設定」は接続状態（店舗）の確認と、この端末のログアウト。
 */
export function HandyLoginScreen({
  storeName,
  accountName,
  clerks,
  today,
  loginAction,
  signOutAction,
}: {
  storeName: string;
  /** 端末のアカウント表示名（POS設定の確認用） */
  accountName: string;
  clerks: HandyClerkOption[];
  /** 今日の日付（サーバーで JST に整形） */
  today: string;
  loginAction: (clerkId: string | null) => Promise<void>;
  signOutAction: () => Promise<void>;
}) {
  const router = useRouter();
  const [clerkId, setClerkId] = useState<string>(clerks[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const login = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await loginAction(clerkId || null);
        router.replace('/handy');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'ログインできませんでした');
      }
    });
  };

  return (
    <section
      aria-label="ハンディ ログイン"
      className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-[#15121a] px-7 pt-[max(16px,env(safe-area-inset-top))] pb-7 text-white"
    >
      <div className="-mx-2.5 flex items-center gap-2.5 text-[11px]">
        <span
          className="inline-flex h-[25px] w-11 items-center justify-end rounded-[20px] bg-[#7b3fe4] p-0.5"
          aria-hidden
        >
          <i className="block h-[21px] w-[21px] rounded-full bg-white" />
        </span>
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          className="flex min-h-[35px] items-center gap-1 rounded border border-[#ffffff26] bg-[#ffffff16] px-2.5 text-[#e3dbf1]"
        >
          <Zap className="h-3.5 w-3.5" aria-hidden />
          POS設定
        </button>
      </div>

      <div className="mt-12 text-center">
        <span className="inline-flex items-center gap-[9px] text-[30px] font-extrabold tracking-[-0.4px]">
          {/* 本体の BrandLogo と同じくプレーン img（固定サイズのロゴに next/image は不向き） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="h-12 w-[45px] object-contain" />
          <span className="text-[#b18aff]">TENPO</span>
          <span className="ml-1 text-white">ONE</span>
        </span>
        <p className="mt-7 text-[11px] font-semibold tracking-[0.1em]">HANDY · TENPO ONE</p>
        <p className="mt-[22px] flex items-center justify-center gap-1.5 text-base">
          <CalendarDays className="h-4 w-4 text-[#d8c6f1]" aria-hidden />
          {today}
        </p>
      </div>

      <div className="my-auto grid grid-cols-[60px_1fr] items-center gap-[13px] py-9 text-[13px]">
        <span>店舗名</span>
        <span className="flex min-h-10 w-full items-center rounded-lg border border-[#e3dbf1] bg-white px-2 text-base text-[#2a2138]">
          <span className="truncate">{storeName}</span>
        </span>
        <label htmlFor="handy-clerk">担当者</label>
        <select
          id="handy-clerk"
          value={clerkId}
          onChange={(e) => setClerkId(e.target.value)}
          className="min-h-10 w-full rounded-lg border border-[#e3dbf1] bg-white px-[7px] text-base text-[#2a2138]"
        >
          {clerks.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="">{NO_CLERK_NAME}</option>
        </select>
      </div>

      <button
        type="button"
        onClick={login}
        disabled={pending}
        className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-[9px] bg-[#7b3fe4] text-[19px] font-semibold text-white shadow-[0_3px_10px_#7b3fe41a] active:bg-[#6630c7] disabled:opacity-45"
      >
        <CornerDownRight className="h-5 w-5" aria-hidden />
        {pending ? 'ログイン中…' : 'Login'}
      </button>
      {error && (
        <p role="alert" className="mt-2.5 text-center text-xs text-[#ffb4b4]">
          {error}
        </p>
      )}
      <p className="mt-2.5 text-center text-[9px] leading-relaxed text-[#d8c6f1]">
        {clerks.length === 0
          ? '担当者は 設定 → POS担当者 で登録できます（未登録でも使えます）。'
          : '担当者を選んで Login。ハンディで作った伝票の担当者になります。'}
      </p>

      {setupOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="POS設定"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#15121a88] p-3"
          onClick={() => setSetupOpen(false)}
        >
          <div
            className="w-full max-w-[370px] rounded-xl bg-white p-5 text-[#2a2138] shadow-[0_20px_90px_#0005]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold">POS設定</h2>
            <dl className="text-sm">
              <div className="flex items-center justify-between gap-2 border-b border-[#eee8f6] py-2.5">
                <dt className="text-[#7a7090]">接続</dt>
                <dd className="font-bold text-[#1e6b4d]">接続済み</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-[#eee8f6] py-2.5">
                <dt className="text-[#7a7090]">店舗</dt>
                <dd className="truncate font-bold text-[#4f3868]">{storeName}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-[#eee8f6] py-2.5">
                <dt className="text-[#7a7090]">端末</dt>
                <dd className="truncate text-[#4f3868]">{accountName}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-[#7a7090]">
              別の店舗につなぎ直すときは、レジ（管理画面）の 設定 → ハンディ端末 でこの端末を解除し、
              新しい QR を読み取ってください。
            </p>
            <Link
              href="/app/dashboard"
              className="mt-2 flex min-h-[46px] items-center gap-2 border-b border-[#eee8f6] text-sm text-[#7b3fe4]"
            >
              <House className="h-[18px] w-[18px]" aria-hidden />
              TENPO ONE（本体）へ
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex min-h-[46px] w-full items-center gap-2 text-left text-sm text-[#b3341f]"
              >
                <LogOut className="h-[18px] w-[18px]" aria-hidden />
                この端末をログアウト
              </button>
            </form>
            <button
              type="button"
              onClick={() => setSetupOpen(false)}
              className="mt-3 min-h-[43px] w-full rounded-lg bg-[#efeaf8] text-center text-sm font-bold text-[#5e5470]"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
