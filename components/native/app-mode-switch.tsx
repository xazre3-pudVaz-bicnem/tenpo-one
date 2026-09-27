'use client';

import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { nativeBridge } from '@/lib/native-app';
import { cn } from '@/lib/utils';

/**
 * iPhone アプリ（ハンディ・オーナー）の「アプリの使い方を変える」。アプリの中でだけ出る（ブラウザでは何も出さない）。
 * 2026-09-28 Ronnie「ハンディとオーナーは iPhone のアプリ」
 */
export function AppModeSwitch({ className }: { className?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.TenpoNative は client でしか読めない
    setVisible(nativeBridge()?.app === 'handy');
  }, []);
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => nativeBridge()?.changeMode()}
      className={cn('flex w-full items-center gap-2 text-left text-sm text-[#7b3fe4]', className)}
    >
      <Smartphone className="h-[18px] w-[18px]" aria-hidden />
      アプリの使い方を変える（ハンディ／オーナー）
    </button>
  );
}
