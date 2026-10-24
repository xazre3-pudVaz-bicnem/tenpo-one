/**
 * レジ（iPad）ホームの数字（時刻・気温）。
 * サーバー・クライアントどちらの部品からも使うので 'use client' の外に置く。
 */

export const thinDigits = { className: 'font-num' };

/** 時刻・気温の色（オーダー・会計 と同じ濃い青） */
export const REGI_BLUE = '#0f4fc4';

export const blueGradientText = {
  backgroundImage: 'linear-gradient(180deg, #2a6fe6, #0a3fa8)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;
