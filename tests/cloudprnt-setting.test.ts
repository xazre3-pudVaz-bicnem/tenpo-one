import { describe, expect, it } from 'vitest';
import {
  CLOUDPRNT_SETTING_RELOAD_MIN,
  DEFAULT_CLOUDPRNT_POLL_SECONDS,
  cloudprntPollSeconds,
  cloudprntServerSetting,
  isCloudprntToken,
} from '@/lib/cloudprnt-setting';

describe('Star CloudPRNT サーバー設定情報（問い合わせ間隔）', () => {
  it('標準は 1 秒', () => {
    expect(DEFAULT_CLOUDPRNT_POLL_SECONDS).toBe(1);
    expect(cloudprntPollSeconds(null)).toBe(1);
    expect(cloudprntPollSeconds(undefined)).toBe(1);
    expect(cloudprntPollSeconds(0)).toBe(1);
    expect(cloudprntPollSeconds(Number.NaN)).toBe(1);
  });

  it('保存した値は 1〜60 秒に収める', () => {
    expect(cloudprntPollSeconds(1)).toBe(1);
    expect(cloudprntPollSeconds(3)).toBe(3);
    expect(cloudprntPollSeconds(2.6)).toBe(3);
    expect(cloudprntPollSeconds(500)).toBe(60);
  });

  it('Star の仕様どおりの JSON（HTTP のまま・URL は変えない）', () => {
    const s = cloudprntServerSetting(1);
    expect(s).toEqual({
      title: 'star_cloudprnt_server_setting',
      version: '1.0.0',
      serverSupportProtocol: ['HTTP'],
      reloadIntervalMin: CLOUDPRNT_SETTING_RELOAD_MIN,
      settingForHTTP: { pollingTimeSec: 1 },
    });
    expect(s.settingForHTTP).not.toHaveProperty('url');
    expect(s.reloadIntervalMin).toBeGreaterThanOrEqual(1);
    expect(s.reloadIntervalMin).toBeLessThanOrEqual(1440);
  });

  it('トークンの形だけ受け付ける', () => {
    expect(isCloudprntToken('42b84f6889692dd0dab3e6009154ab66ae5a5')).toBe(true);
    expect(isCloudprntToken('')).toBe(false);
    expect(isCloudprntToken(null)).toBe(false);
    expect(isCloudprntToken('short')).toBe(false);
    expect(isCloudprntToken('../../etc/passwd')).toBe(false);
    expect(isCloudprntToken("abc' or 1=1 --xxxxxxxxxx")).toBe(false);
  });
});
