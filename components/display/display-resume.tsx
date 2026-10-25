'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DisplayNotice } from './display-notice';

/**
 * セッションが切れた端末を、端末の鍵（Cookie）で自動でつなぎ直す画面（ログアウトさせないため）。
 * つながったら読み直して元の画面（KDS・呼び出しモニター）へ。だめなら 15 秒ごとにもう一度。
 */
export function DisplayResume({ resumeAction }: { resumeAction: () => Promise<{ ok: boolean; error?: string }> }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      resumeAction()
        .then((r) => {
          if (disposed) return;
          if (r.ok) {
            router.refresh();
            return;
          }
          setMessage(r.error ?? null);
          timer = setTimeout(attempt, 15_000);
        })
        .catch(() => {
          if (disposed) return;
          timer = setTimeout(attempt, 15_000);
        });
    };
    attempt();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [resumeAction, router]);

  return <DisplayNotice icon="loading" title="つなぎ直しています…" body={message ?? 'このままお待ちください（ログアウトはしていません）'} />;
}
