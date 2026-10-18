'use client';

import { useEffect } from 'react';

/**
 * 店舗画面の表示中だけ <body> に theme-regi を付ける。
 * 本文は layout 側のラッパーでテーマ済みだが、body 直下に描画されるトースト等にも配色を効かせるため。
 * iPad（Chrome・Safari）は2本指で画面が拡大して揺れるので、店舗画面では拡大のジェスチャーを止める
 * （2026-10-19 Ronnie「iPad の Chrome で画面が揺れないように」。user-scalable=no は iOS が無視するため）。
 */
export function ThemeBody() {
  useEffect(() => {
    document.body.classList.add('theme-regi');
    const stopZoom = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stopZoom);
    document.addEventListener('gesturechange', stopZoom);
    return () => {
      document.body.classList.remove('theme-regi');
      document.removeEventListener('gesturestart', stopZoom);
      document.removeEventListener('gesturechange', stopZoom);
    };
  }, []);
  return null;
}
