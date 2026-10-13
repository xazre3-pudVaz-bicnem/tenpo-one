'use client';

import {
  DIRECT_PRINT_STORAGE_KEY,
  DIRECT_TIMEOUT_MS,
  EPOS_REQUEST_HEADERS,
  eposServiceUrl,
  parseDirectPrintConfig,
  parseEposResponse,
  type DirectPrintConfig,
} from '@/lib/direct-print';

/** この端末で「Wi-Fi で直接印刷」するプリンター（localStorage。読めなければ空＝今まで通り） */
export function readDirectPrintConfig(): DirectPrintConfig {
  try {
    return parseDirectPrintConfig(window.localStorage.getItem(DIRECT_PRINT_STORAGE_KEY));
  } catch {
    return { printerIds: [] };
  }
}

export function writeDirectPrintConfig(config: DirectPrintConfig): boolean {
  try {
    window.localStorage.setItem(DIRECT_PRINT_STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new Event('tenpo-direct-print-changed'));
    return true;
  } catch {
    return false;
  }
}

export type SendResult =
  | { kind: 'printed' }
  /** プリンターは受け取ったが印刷できなかった（紙切れ・カバーなど） */
  | { kind: 'printer-error'; code: string | null }
  /** iPad からプリンターにつながらない（Wi-Fi が違う・証明書を許可していない・電源が切れている） */
  | { kind: 'unreachable' }
  /** 送ったが返事が来なかった（印刷されたかどうか分からない） */
  | { kind: 'timeout' };

/** EPSON の ePOS-Print へ、お店の Wi-Fi で直接送る */
export async function sendToEposPrinter(host: string, soap: string): Promise<SendResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS + 2000);
  try {
    const res = await fetch(eposServiceUrl(host), {
      method: 'POST',
      headers: EPOS_REQUEST_HEADERS,
      body: soap,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    const text = await res.text();
    const r = parseEposResponse(text);
    if (r.success) return { kind: 'printed' };
    return { kind: 'printer-error', code: r.code ?? (res.ok ? null : `HTTP ${res.status}`) };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { kind: 'timeout' };
    return { kind: 'unreachable' };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function postDirect<T>(body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch('/api/print/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok && res.status !== 404) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
