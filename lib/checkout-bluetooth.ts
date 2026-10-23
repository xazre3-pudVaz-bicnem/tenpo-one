/** The physical identifier is device-local; server configuration still owns eligibility and maker. */
export interface CheckoutBluetoothLink {
  printerId: string;
  deviceId: string;
  maker: string;
  via: 'bluetooth' | 'usb';
}
export interface CheckoutReceipt {
  data: string;
  deviceId: string;
  maker: string;
  via: 'bluetooth' | 'usb';
}
export function parseCheckoutBluetoothLink(value: unknown): CheckoutBluetoothLink | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.printerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.printerId)) return null;
  if (typeof v.deviceId !== 'string' || !v.deviceId.trim() || v.deviceId.length > 256 || /[\x00-\x1f]/.test(v.deviceId)) return null;
  if (!['star', 'epson', 'sii', 'escpos'].includes(String(v.maker)) || !['bluetooth', 'usb'].includes(String(v.via))) return null;
  return { printerId: v.printerId, deviceId: v.deviceId, maker: String(v.maker), via: v.via as 'bluetooth' | 'usb' };
}
