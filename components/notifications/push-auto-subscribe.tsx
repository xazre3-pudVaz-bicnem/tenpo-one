'use client';

import { useEffect } from 'react';
import { savePushSubscription } from '@/app/app/push-actions';
import { currentPushSubscription, pushSupport, subscribeToPush } from '@/components/notifications/push-client';

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
/** この端末で店舗に保存済みの購読（endpoint）。同じなら毎回サーバーに送らない */
const SAVED_KEY = 'tenpo.push.savedEndpoint';
/** 通知の許可を最後に聞いた時刻。断られた（閉じられた）ときは 1 日あけてもう一度 */
const ASKED_KEY = 'tenpo.push.askedAt';
const ASK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function readLs(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLs(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* プライベートモードなどでは保存できなくてもよい */
  }
}

/**
 * ログインした端末では予約の通知を自動でオンにする（2026-09-27 Ronnie「ボタンを押さなくても、ログインした端末に通知が来るように」）。
 * - 許可済みの端末: 開いた時点で購読して店舗に登録（ボタン不要）
 * - まだ聞いていない端末: 最初のタップで OS の「通知を許可しますか」を出す（iPhone/iPad はタップの中でしか出せない）
 *   → 許可されればそのまま登録。閉じられたら 1 日あけてもう一度
 * - ブロック済み・鍵未設定・ホーム画面に追加していない iPhone/iPad では何もしない（設定 > 予約設定 のボタンに案内が出る）
 * 画面には何も出さない。
 */
export function PushAutoSubscribe() {
  useEffect(() => {
    if (pushSupport(PUBLIC_KEY).kind !== 'ok') return;
    let cancelled = false;
    let armed = false;

    const register = async () => {
      const sub = await subscribeToPush(PUBLIC_KEY!);
      if (cancelled || !sub || sub === 'denied') return;
      if (readLs(SAVED_KEY) === sub.endpoint) return;
      const res = await savePushSubscription(sub);
      if (!res.error) writeLs(SAVED_KEY, sub.endpoint);
    };

    // click は全ブラウザで「ユーザー操作」になる。iPhone/iPad は touchend でも許可を出せるので両方で拾う
    const TAP_EVENTS = ['click', 'touchend'] as const;
    const onFirstTap = () => {
      for (const ev of TAP_EVENTS) document.removeEventListener(ev, onFirstTap, true);
      armed = false;
      writeLs(ASKED_KEY, String(Date.now()));
      // タップの中で呼ぶ（requestPermission が先頭で走る）
      void register().catch(() => undefined);
    };

    (async () => {
      if (Notification.permission === 'denied') return;
      if (Notification.permission === 'granted') {
        // 許可済み: すでに購読していて登録済みなら何もしない
        const cur = await currentPushSubscription().catch(() => null);
        if (cancelled) return;
        if (cur && readLs(SAVED_KEY) === cur.endpoint) return;
        await register().catch(() => undefined);
        return;
      }
      // まだ聞いていない: 最初のタップで聞く（1 日に 1 回まで）
      const asked = Number(readLs(ASKED_KEY) ?? 0);
      if (Date.now() - asked < ASK_INTERVAL_MS) return;
      armed = true;
      for (const ev of TAP_EVENTS) document.addEventListener(ev, onFirstTap, true);
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      if (armed) for (const ev of TAP_EVENTS) document.removeEventListener(ev, onFirstTap, true);
    };
  }, []);

  return null;
}
