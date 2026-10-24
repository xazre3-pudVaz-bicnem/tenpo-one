import { isUuid } from '@/lib/native-pos';
import { TAX_RATE_OPTIONS } from '@/components/inventory/labels';

/**
 * iPad アプリのネイティブの「仕入先」「発注」（Web の /app/vendors・/app/purchases と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=vendors|vendorOrders|purchases|poNew|po、
 * 操作は POST { type: 'vendorSave' | 'vendorDelete' | 'poCreate' | 'poStatus' | 'poCancel' | 'poReceive', … }。
 * 中身は Web と同じ Server Action（app/app/vendors/actions.ts・app/app/purchases/actions.ts）を呼ぶだけ。どれも vendors.manage。
 */

export interface NativeVendorInput {
  name: string;
  nameKana: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  closingDay: number | null;
  paymentDay: number | null;
  bankInfo: string | null;
  note: string | null;
}

export type NativePurchasingAction =
  | { type: 'vendorSave'; id: string | null; input: NativeVendorInput }
  | { type: 'vendorDelete'; id: string; reason: string }
  | {
      type: 'poCreate';
      vendorId: string;
      expectedAt: string | null;
      note: string | null;
      lines: { inventoryItemId: string | null; name: string; quantity: number; unit: string; unitCost: number; taxRate: number }[];
    }
  | { type: 'poStatus'; id: string; action: 'request' | 'approve' | 'order' }
  | { type: 'poCancel'; id: string; reason: string }
  | { type: 'poReceive'; id: string; receipts: { itemId: string; quantity: number; unitCost: number }[] };

const TYPES = ['vendorSave', 'vendorDelete', 'poCreate', 'poStatus', 'poCancel', 'poReceive'] as const;

export function isNativePurchasingActionType(v: unknown): v is NativePurchasingAction['type'] {
  return TYPES.includes(v as (typeof TYPES)[number]);
}

const MAX = 1_000_000_000;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optText = (v: unknown, max: number) => text(v, max) || null;
const day = (v: unknown): number | null | undefined => {
  if (v == null || v === '') return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31 ? v : undefined;
};
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

type R = { ok: true; action: NativePurchasingAction } | { ok: false; error: string };

export function parseNativePurchasingAction(raw: unknown): R {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'vendorSave': {
      if (b.id != null && !isUuid(b.id)) return { ok: false, error: '仕入先が見つかりません' };
      const name = text(b.name, 120);
      if (!name) return { ok: false, error: '名前を入力してください' };
      const closingDay = day(b.closingDay);
      const paymentDay = day(b.paymentDay);
      if (closingDay === undefined || paymentDay === undefined) return { ok: false, error: '締め日・支払日は1〜31で入力してください' };
      return {
        ok: true,
        action: {
          type: 'vendorSave',
          id: (b.id as string | null | undefined) ?? null,
          input: {
            name,
            nameKana: optText(b.nameKana, 120),
            contactName: optText(b.contactName, 120),
            phone: optText(b.phone, 40),
            email: optText(b.email, 200),
            address: optText(b.address, 300),
            closingDay,
            paymentDay,
            bankInfo: optText(b.bankInfo, 300),
            note: optText(b.note, 1000),
          },
        },
      };
    }
    case 'vendorDelete':
    case 'poCancel': {
      if (!isUuid(b.id)) return { ok: false, error: b.type === 'vendorDelete' ? '仕入先が見つかりません' : '発注書が見つかりません' };
      const reason = text(b.reason, 500);
      if (!reason) return { ok: false, error: '理由を入力してください' };
      return { ok: true, action: { type: b.type, id: b.id as string, reason } };
    }
    case 'poCreate': {
      if (!isUuid(b.vendorId)) return { ok: false, error: '仕入先を選択してください' };
      if (b.expectedAt != null && b.expectedAt !== '' && !isDate(b.expectedAt)) return { ok: false, error: '入荷予定日が正しくありません' };
      if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 200) return { ok: false, error: '明細を1件以上入力してください' };
      const lines: Extract<NativePurchasingAction, { type: 'poCreate' }>['lines'] = [];
      for (const l of b.lines) {
        const r = l as Record<string, unknown>;
        if (!r || typeof r !== 'object') return { ok: false, error: '明細が正しくありません' };
        if (r.inventoryItemId != null && !isUuid(r.inventoryItemId)) return { ok: false, error: '明細が正しくありません' };
        const name = text(r.name, 120);
        const quantity = r.quantity;
        const unitCost = r.unitCost;
        if (!name) return { ok: false, error: '品目名を入力してください' };
        if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > MAX) return { ok: false, error: '数量を正しく入力してください' };
        if (typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > MAX) return { ok: false, error: '単価を正しく入力してください' };
        if (!TAX_RATE_OPTIONS.includes(r.taxRate as (typeof TAX_RATE_OPTIONS)[number])) return { ok: false, error: '税率が正しくありません' };
        lines.push({
          inventoryItemId: (r.inventoryItemId as string | null | undefined) ?? null,
          name,
          quantity,
          unit: text(r.unit, 20) || '個',
          unitCost: Math.round(unitCost),
          taxRate: r.taxRate as number,
        });
      }
      return {
        ok: true,
        action: { type: 'poCreate', vendorId: b.vendorId as string, expectedAt: isDate(b.expectedAt) ? b.expectedAt : null, note: optText(b.note, 1000), lines },
      };
    }
    case 'poStatus':
      if (!isUuid(b.id)) return { ok: false, error: '発注書が見つかりません' };
      if (b.action !== 'request' && b.action !== 'approve' && b.action !== 'order') return { ok: false, error: '内容が正しくありません' };
      return { ok: true, action: { type: 'poStatus', id: b.id as string, action: b.action } };
    case 'poReceive': {
      if (!isUuid(b.id)) return { ok: false, error: '発注書が見つかりません' };
      if (!Array.isArray(b.receipts) || b.receipts.length > 200) return { ok: false, error: '入荷数量を入力してください' };
      const receipts: { itemId: string; quantity: number; unitCost: number }[] = [];
      for (const x of b.receipts) {
        const r = x as Record<string, unknown>;
        if (!r || !isUuid(r.itemId)) return { ok: false, error: '明細が正しくありません' };
        if (typeof r.quantity !== 'number' || !Number.isFinite(r.quantity) || r.quantity <= 0 || r.quantity > MAX) return { ok: false, error: '入荷数量を入力してください' };
        if (typeof r.unitCost !== 'number' || !Number.isFinite(r.unitCost) || r.unitCost < 0 || r.unitCost > MAX) return { ok: false, error: '単価を正しく入力してください' };
        receipts.push({ itemId: r.itemId as string, quantity: r.quantity, unitCost: r.unitCost });
      }
      if (receipts.length === 0) return { ok: false, error: '入荷数量を入力してください' };
      return { ok: true, action: { type: 'poReceive', id: b.id as string, receipts } };
    }
    default:
      return { ok: false, error: '内容が正しくありません' };
  }
}
