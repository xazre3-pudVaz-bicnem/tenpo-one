'use client';

import { useEffect, useRef } from 'react';

/**
 * ログアウトのフォームに「この画面はタッチか」（navigator.maxTouchPoints）を添える。
 * iPadOS は「デスクトップ用サイト」で Macintosh を名乗るため、サーバーは User-Agent だけでは iPad とパソコンを見分けられない。
 * レジを閉めていないときにログアウトを止めるのは iPad だけ（lib/device-kind.ts の shouldBlockRegisterSignOut）。
 * 値は送信のとき（form の formdata イベント）に入れる。描画は SSR と同じなので hydration の食い違いは起きない。
 */
export function TouchHint() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onFormData = (e: FormDataEvent) => {
      e.formData.set('touch', String(navigator.maxTouchPoints || 0));
    };
    form.addEventListener('formdata', onFormData);
    return () => form.removeEventListener('formdata', onFormData);
  }, []);
  return <input ref={ref} type="hidden" name="touch" defaultValue="" />;
}
