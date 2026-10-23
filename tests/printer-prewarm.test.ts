import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const swift = readFileSync(new URL('../ios/Shared/WebViewController.swift', import.meta.url), 'utf8');
const script = swift.split('let printerWarmup = AppConfig.isPad ? """')[1].split('""" : ""')[0];
const star = { maker: 'star', deviceId: 'paired-star', via: 'bluetooth' };
function boot(links: unknown, path = '/app/dashboard', visible = 'visible') {
  const calls: { type: string; payload: unknown }[] = [];
  const events: Record<string, () => void> = {};
  const window: { __tenpoPreparePrinter?: () => void; addEventListener: (name: string, cb: () => void) => void } = {
    addEventListener: (name, cb) => { events[name] = cb; },
  };
  const document = { visibilityState: visible, addEventListener: window.addEventListener };
  runInNewContext(script, {
    window, document, location: { pathname: path },
    localStorage: { getItem: () => JSON.stringify({ bluetooth: links }) },
    call: (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return Promise.resolve({ ok: true });
    },
  });
  return { calls, events, document, window };
}

describe('native app prepares the selected printer before a print click', () => {
  it('prepares only one saved Star, without a print or drawer command', () => {
    const { calls } = boot([star]);
    expect(calls).toEqual([{ type: 'btPrepare', payload: star }]);
  });
  it('does not guess between printers, connect an agent/other maker, or operate on login/hidden pages', () => {
    for (const links of [[], null, [star, { ...star, deviceId: 'second' }], [{ ...star, via: 'agent' }], [{ ...star, maker: 'epson' }]]) {
      expect(boot(links).calls).toHaveLength(0);
    }
    expect(boot([star], '/register-login').calls).toHaveLength(0);
    expect(boot([star], '/app/dashboard', 'hidden').calls).toHaveLength(0);
  });
  it('coalesces overlapping prepare requests and prepares again on foreground', async () => {
    const { calls, events } = boot([star]);
    events['tenpo-direct-print-changed']();
    events.visibilitychange();
    expect(calls).toHaveLength(1);
    await Promise.resolve();
    events.visibilitychange();
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.type === 'btPrepare')).toBe(true);
  });
});
