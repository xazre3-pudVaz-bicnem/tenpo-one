'use client';

import { createContext, useContext } from 'react';
import { QR_STRINGS, qrStrings, type QrStrings } from './strings';

const QrStringsContext = createContext<QrStrings>(qrStrings);

export function QrStringsProvider({ value, children }: { value: QrStrings; children: React.ReactNode }) {
  return <QrStringsContext.Provider value={value}>{children}</QrStringsContext.Provider>;
}

/** 現在ロケールのQRオーダー文言を取得（既定 ja）。 */
export function useQrStrings(): QrStrings {
  return useContext(QrStringsContext);
}

export { QR_STRINGS };
