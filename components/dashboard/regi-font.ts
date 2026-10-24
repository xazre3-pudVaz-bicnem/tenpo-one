/**
 * レジ（iPad）ホームの細い数字（時刻・気温）。Apple の天気・時計と同じような細字（2026-10-19 Ronnie）。
 * サーバー・クライアントどちらの部品からも使うので 'use client' の外に置く。
 */
import localFont from 'next/font/local';

/** Inter（字のファイルはリポジトリの中 app/fonts。前の next/font/google と同じ 200・300・500 の3つの太さ） */
export const thinDigits = localFont({
  src: [
    { path: '../../app/fonts/inter-latin-wght.woff2', weight: '200', style: 'normal' },
    { path: '../../app/fonts/inter-latin-wght.woff2', weight: '300', style: 'normal' },
    { path: '../../app/fonts/inter-latin-wght.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
});

/** 時刻・気温の色（オーダー・会計 と同じ濃い青） */
export const REGI_BLUE = '#0f4fc4';

export const blueGradientText = {
  backgroundImage: 'linear-gradient(180deg, #2a6fe6, #0a3fa8)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;
