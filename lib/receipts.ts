/**
 * レシートエンジン（純関数・テスト対象）。
 * 注文・支払・返金・店舗設定からレシート表示モデルを構築する。
 * 58mm / 80mm の両レイアウトはこのモデルをUI側でレンダリングする。
 */

export interface ReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiers: { name: string; price: number }[];
  cancelled: boolean;
}

export interface ReceiptTaxRow {
  rate: number; // 10 / 8
  taxable: number; // 税込対象額
  tax: number;
}

export interface ReceiptData {
  storeName: string;
  storeAddress: string | null;
  storePhone: string | null;
  registrationNumber: string | null; // 適格請求書発行事業者番号
  headerMessage: string | null;
  footerMessage: string | null;
  registerName: string | null;
  staffName: string | null;
  orderNo: string;
  issuedAt: string; // 表示用日時
  isReissue: boolean;
  isRefundReceipt: boolean;
  lines: ReceiptLine[];
  subtotal: number; // 税抜
  taxRows: ReceiptTaxRow[];
  serviceCharge: number;
  discount: number;
  couponCode: string | null;
  total: number;
  payments: { label: string; amount: number }[];
  tendered: number | null;
  change: number | null;
  refundTotal: number;
  netPaid: number; // total - refundTotal
  pointsEarned: number | null;
  pointsUsed: number | null;
  pointBalance: number | null;
  /** QRコード内容（取引番号照会用テキスト） */
  qrContent: string;
}

export interface BuildReceiptInput {
  store: {
    name: string;
    address?: string | null;
    phone?: string | null;
    registrationNumber?: string | null;
    headerMessage?: string | null;
    footerMessage?: string | null;
  };
  order: {
    orderNo: number | string;
    closedAt: string | Date | null;
    subtotal: number;
    taxTotal: number;
    serviceCharge: number;
    discountTotal: number;
    couponCode?: string | null;
    total: number;
  };
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    taxRate: number;
    modifiers?: { name: string; price: number }[];
    cancelled?: boolean;
  }[];
  payments: { method: string; amount: number; tendered?: number | null; change?: number | null }[];
  refunds?: { amount: number }[];
  registerName?: string | null;
  staffName?: string | null;
  isReissue?: boolean;
  methodLabels: Record<string, string>;
  points?: { earned?: number | null; used?: number | null; balance?: number | null };
}

/** 税率別の内訳を集計する（内税前提。行の税込額から逆算） */
export function buildTaxRows(
  items: { lineTotal: number; taxRate: number; cancelled?: boolean }[]
): ReceiptTaxRow[] {
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const item of items) {
    if (item.cancelled) continue;
    const rate = item.taxRate;
    const entry = byRate.get(rate) ?? { taxable: 0, tax: 0 };
    entry.taxable += item.lineTotal;
    entry.tax += item.lineTotal - Math.floor((item.lineTotal * 100) / (100 + rate));
    byRate.set(rate, entry);
  }
  return [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, v]) => ({ rate, taxable: v.taxable, tax: v.tax }));
}

export function buildReceipt(input: BuildReceiptInput): ReceiptData {
  const activeItems = input.items.filter((i) => !i.cancelled);
  const refundTotal = (input.refunds ?? []).reduce((a, r) => a + r.amount, 0);
  const cash = input.payments.find((p) => p.method === 'cash');
  const closedAt = input.order.closedAt ? new Date(input.order.closedAt) : new Date();

  return {
    storeName: input.store.name,
    storeAddress: input.store.address ?? null,
    storePhone: input.store.phone ?? null,
    registrationNumber: input.store.registrationNumber ?? null,
    headerMessage: input.store.headerMessage ?? null,
    footerMessage: input.store.footerMessage ?? null,
    registerName: input.registerName ?? null,
    staffName: input.staffName ?? null,
    orderNo: String(input.order.orderNo),
    issuedAt: closedAt.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }),
    isReissue: input.isReissue ?? false,
    isRefundReceipt: refundTotal > 0,
    lines: input.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      modifiers: i.modifiers ?? [],
      cancelled: i.cancelled ?? false,
    })),
    subtotal: input.order.subtotal,
    taxRows: buildTaxRows(activeItems),
    serviceCharge: input.order.serviceCharge,
    discount: input.order.discountTotal,
    couponCode: input.order.couponCode ?? null,
    total: input.order.total,
    payments: input.payments.map((p) => ({
      label: input.methodLabels[p.method] ?? p.method,
      amount: p.amount,
    })),
    tendered: cash?.tendered ?? null,
    change: cash?.change ?? null,
    refundTotal,
    netPaid: input.order.total - refundTotal,
    pointsEarned: input.points?.earned ?? null,
    pointsUsed: input.points?.used ?? null,
    pointBalance: input.points?.balance ?? null,
    qrContent: `TENPOONE:${input.order.orderNo}:${closedAt.getTime()}`,
  };
}
