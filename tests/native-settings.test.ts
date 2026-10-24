import { describe, expect, it } from 'vitest';
import { isNativeSettingsActionType, parseNativeSettingsAction } from '@/lib/native-settings';

const ID = '11111111-1111-4111-8111-111111111111';

describe('native settings actions', () => {
  it('parses the receipt printer choice (null = store default)', () => {
    expect(isNativeSettingsActionType('settingsPrinterSelect')).toBe(true);
    expect(isNativeSettingsActionType('noticeRead')).toBe(false);
    expect(parseNativeSettingsAction({ type: 'settingsPrinterSelect', printerId: null })).toEqual({ ok: true, action: { type: 'settingsPrinterSelect', printerId: null } });
    expect(parseNativeSettingsAction({ type: 'settingsPrinterSelect', printerId: '' })).toEqual({ ok: true, action: { type: 'settingsPrinterSelect', printerId: null } });
    expect(parseNativeSettingsAction({ type: 'settingsPrinterSelect', printerId: ID }).ok).toBe(true);
    expect(parseNativeSettingsAction({ type: 'settingsPrinterSelect', printerId: 'abc' }).ok).toBe(false);
  });

  it('parses add like the web form (maker・via・model・paper・auto print・drawer)', () => {
    expect(
      parseNativeSettingsAction({ type: 'settingsPrinterAdd', maker: 'star', via: 'usb', name: ' mC-Print3 ', modelId: 'star-mcp31', paperWidthMm: 80, autoPrint: true, drawerKick: false })
    ).toEqual({
      ok: true,
      action: { type: 'settingsPrinterAdd', printerId: null, name: 'mC-Print3', maker: 'star', via: 'usb', modelId: 'star-mcp31', paperWidthMm: 80, autoPrint: true, drawerKick: false },
    });
    // つなぎ直し（既存の行）
    expect(parseNativeSettingsAction({ type: 'settingsPrinterAdd', maker: 'epson', via: 'bluetooth', printerId: ID }).ok).toBe(true);
    // 分からない値は受け付けない
    expect(parseNativeSettingsAction({ type: 'settingsPrinterAdd', maker: 'brother', via: 'bluetooth' }).ok).toBe(false);
    expect(parseNativeSettingsAction({ type: 'settingsPrinterAdd', maker: 'star', via: 'bluetooth', modelId: 'Star MCP31!' }).ok).toBe(false);
    expect(parseNativeSettingsAction({ type: 'settingsPrinterAdd', maker: 'star', via: 'bluetooth', printerId: 'x' }).ok).toBe(false);
    // 紙幅は 58 / 80 だけ（それ以外は null＝機種の既定）
    const r = parseNativeSettingsAction({ type: 'settingsPrinterAdd', maker: 'escpos', via: 'bluetooth', paperWidthMm: 76 });
    expect(r.ok && r.action.type === 'settingsPrinterAdd' && r.action.paperWidthMm).toBe(null);
  });

  it('parses save', () => {
    expect(parseNativeSettingsAction({ type: 'settingsPrinterSave', printerId: ID, modelId: null, paperWidthMm: 58, autoPrint: false, drawerKick: true })).toEqual({
      ok: true,
      action: { type: 'settingsPrinterSave', printerId: ID, modelId: null, paperWidthMm: 58, autoPrint: false, drawerKick: true },
    });
    expect(parseNativeSettingsAction({ type: 'settingsPrinterSave', printerId: '' }).ok).toBe(false);
    expect(parseNativeSettingsAction({ type: 'unknown' }).ok).toBe(false);
  });
});
