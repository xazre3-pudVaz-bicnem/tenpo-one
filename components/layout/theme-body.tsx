'use client';

import { useEffect } from 'react';

/**
 * 店舗画面の表示中だけ <body> に theme-regi を付ける。
 * 本文は layout 側のラッパーでテーマ済みだが、body 直下に描画されるトースト等にも配色を効かせるため。
 */
export function ThemeBody() {
  useEffect(() => {
    document.body.classList.add('theme-regi');
    return () => document.body.classList.remove('theme-regi');
  }, []);
  return null;
}
