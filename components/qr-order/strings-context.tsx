'use client';

import { createContext, useContext } from 'react';
import { QR_STRINGS, qrStrings, type QrStrings, type QrLocale } from './strings';

interface QrLocaleValue {
  strings: QrStrings;
  locale: QrLocale;
}

const QrStringsContext = createContext<QrLocaleValue>({ strings: qrStrings, locale: 'ja' });

export function QrStringsProvider({ locale, children }: { locale: QrLocale; children: React.ReactNode }) {
  return <QrStringsContext.Provider value={{ strings: QR_STRINGS[locale], locale }}>{children}</QrStringsContext.Provider>;
}

/** 現在ロケールのQRオーダー文言を取得（既定 ja）。 */
export function useQrStrings(): QrStrings {
  return useContext(QrStringsContext).strings;
}

/** 現在のロケール（'ja' | 'en'）。商品/カテゴリ名の対訳表示に使う。 */
export function useQrLocale(): QrLocale {
  return useContext(QrStringsContext).locale;
}

/** ロケールに応じた表示名（en は name_en 優先、無ければ日本語へフォールバック）。 */
export function localizedName(locale: QrLocale, name: string, nameEn: string | null | undefined): string {
  return locale === 'en' && nameEn ? nameEn : name;
}

export { QR_STRINGS };
