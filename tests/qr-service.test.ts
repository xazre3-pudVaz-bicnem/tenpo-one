import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QR_SERVICE_ITEMS,
  QR_SERVICE_NOTE_MAX,
  QR_SERVICE_QTY_MAX,
  formatQrServiceRequest,
  mergeQrServiceNote,
  qrServiceFrom,
  qrServiceToJson,
  sanitizeQrServiceItems,
  visibleQrServiceItems,
} from '@/lib/qr-service';
import { serviceCallPushPayload } from '@/lib/service-call-alert';

const items = [
  { name: 'お水', nameEn: 'Water' },
  { name: 'お箸', nameEn: 'Chopsticks' },
  { name: '取り皿交換', nameEn: 'New plates' },
];

describe('お客様QRの「サービス」（2026-10-18 Ronnie「QR の最後に SERVICE ボタン」）', () => {
  it('保存が無い店舗は標準の一覧で出す。「出さない」なら空', () => {
    expect(qrServiceFrom({})).toEqual({ enabled: true, items: [...DEFAULT_QR_SERVICE_ITEMS] });
    expect(qrServiceFrom(null).items.map((i) => i.name)).toEqual(['お水', '取り皿交換', 'お箸', 'スプーン']);
    const off = qrServiceFrom({ qrService: { enabled: false, items } });
    expect(visibleQrServiceItems(off)).toEqual([]);
    expect(visibleQrServiceItems(qrServiceFrom({ qrService: { enabled: true, items } }))).toEqual(items);
  });

  it('一覧を整える（空・重複を捨てる、空白をそろえる、英語は無ければ null）', () => {
    expect(
      sanitizeQrServiceItems([
        { name: ' お水 ', nameEn: ' Water ' },
        { name: 'お水', nameEn: 'dup' },
        { name: '', nameEn: 'x' },
        { name: '一味', nameEn: '' },
        'bad',
        null,
      ])
    ).toEqual([
      { name: 'お水', nameEn: 'Water' },
      { name: '一味', nameEn: null },
    ]);
    expect(sanitizeQrServiceItems('x')).toEqual([]);
    expect(qrServiceToJson({ enabled: true, items: [{ name: 'お水', nameEn: null }] })).toEqual({
      enabled: true,
      items: [{ name: 'お水', nameEn: null }],
    });
  });

  it('頼まれたものを1行にする（お店の一覧にある名前・数だけ、一覧の順）', () => {
    expect(
      formatQrServiceRequest(
        [
          { name: 'お箸', qty: 2 },
          { name: 'お水', qty: 3 },
          { name: 'ビール', qty: 1 },
          { name: 'お水', qty: 0 },
          { name: '取り皿交換', qty: 1.5 },
        ],
        items
      )
    ).toBe('お水×3・お箸×2');
    expect(formatQrServiceRequest([{ name: 'お水', qty: 50 }], items)).toBe(`お水×${QR_SERVICE_QTY_MAX}`);
    expect(formatQrServiceRequest([{ name: '<script>', qty: 1 }], items)).toBe('');
    expect(formatQrServiceRequest('x', items)).toBe('');
  });

  it('まだ対応していない呼び出しにもう一度頼まれたら「／」でつなぐ。長すぎるときは足さない', () => {
    expect(mergeQrServiceNote(null, 'お水×2')).toBe('お水×2');
    expect(mergeQrServiceNote('お水×2', 'お箸×1')).toBe('お水×2／お箸×1');
    expect(mergeQrServiceNote('x'.repeat(QR_SERVICE_NOTE_MAX), 'お水×1')).toBeNull();
    expect(mergeQrServiceNote('お水×1', '  ')).toBeNull();
  });

  it('お店への通知（Push）に頼まれたものを出す。もう一度頼まれたときも鳴るよう tag を分ける', () => {
    const p = serviceCallPushPayload({ tableName: 'T3', kind: 'staff', callId: 'c1', detail: 'お水×2', seq: 5 });
    expect(p.title).toBe('T3　スタッフ呼び出し');
    expect(p.body).toBe('ご要望：お水×2');
    expect(p.tag).toBe('call-c1-5');
  });
});
