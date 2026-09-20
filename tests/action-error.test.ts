import { describe, it, expect } from 'vitest';
import { toUserMessage, actionOk, actionFail } from '@/lib/action-error';

describe('toUserMessage', () => {
  it('サーバーの日本語メッセージはそのまま使う', () => {
    expect(toUserMessage(new Error('このレジは既に開局しています'), '失敗しました')).toBe(
      'このレジは既に開局しています'
    );
  });

  it('本番で伏せられたReactのエラーはフォールバックに置き換える', () => {
    const redacted = new Error(
      'An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.'
    );
    expect(toUserMessage(redacted, 'レジの開局に失敗しました')).toBe('レジの開局に失敗しました');
  });

  it('Minified React error 表記もフォールバックに置き換える', () => {
    const minified = new Error('Minified React error #441; visit https://react.dev/errors/441 for the full message');
    expect(toUserMessage(minified, '店舗日次締めに失敗しました')).toBe('店舗日次締めに失敗しました');
  });

  it('Error以外・空文字はフォールバック', () => {
    expect(toUserMessage('boom', '失敗しました')).toBe('失敗しました');
    expect(toUserMessage(new Error('   '), '失敗しました')).toBe('失敗しました');
  });
});

describe('ActionResult', () => {
  it('ok / fail を作れる', () => {
    expect(actionOk()).toEqual({ ok: true });
    expect(actionFail('だめでした')).toEqual({ ok: false, error: 'だめでした' });
  });
});
