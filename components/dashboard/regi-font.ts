/**
 * レジ（iPad）ホームの細い数字（時刻・気温）。Apple の天気・時計と同じような細字（2026-10-19 Ronnie）。
 * サーバー・クライアントどちらの部品からも使うので 'use client' の外に置く。
 */
import { Inter } from 'next/font/google';

export const thinDigits = Inter({ subsets: ['latin'], weight: ['200', '300', '500'], display: 'swap' });

/** 時刻・気温の色（オーダー・会計 と同じ濃い青） */
export const REGI_BLUE = '#0f4fc4';

export const blueGradientText = {
  backgroundImage: 'linear-gradient(180deg, #2a6fe6, #0a3fa8)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;
