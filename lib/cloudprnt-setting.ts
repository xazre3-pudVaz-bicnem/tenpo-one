/**
 * Star CloudPRNT の「サーバー設定情報」（Server setting information, GET）。
 *
 * CloudPRNT Version MQTT に対応した Star 機（新しいファームの mC-Print3 など）は、電源を入れてネットにつながったときと
 * reloadIntervalMin ごとに、CloudPRNT の URL の最後の部分を `cloudprnt-setting.json` に置き換えた URL を GET する
 * （例：/api/cloudprnt/<token> → /api/cloudprnt/cloudprnt-setting.json?mac=...&replaced_path=<token>）。
 * ここで返す settingForHTTP.pollingTimeSec を、プリンターが自分の「問い合わせ間隔」として使う。
 * これで、TENPO ONE の 設定 › プリンター の「問い合わせ間隔（秒）」がプリンターに届くようになる（今までは保存するだけだった）。
 * 対応していない古いファームの機械はこの GET をしない → 今まで通り、プリンター側の設定（Star Quick Setup Utility）の間隔で動く。
 *
 * 2026-10-25 Ronnie「LAN ko late hunxa」「aba bata default nai 1 sec」— 問い合わせ間隔の標準を 5 秒 → 1 秒に。
 * 仕様：https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-reference/http-method-reference/server-info-get/get-response.html
 */

/** 問い合わせ間隔の標準（秒）。2026-10-25 から 1 秒（前は 5 秒） */
export const DEFAULT_CLOUDPRNT_POLL_SECONDS = 1;

/** 設定画面で選べる範囲（app/app/settings/printers/actions.ts と同じ 1〜60 秒） */
const MIN_POLL = 1;
const MAX_POLL = 60;

/** プリンターが設定を取り直す間隔（分）。TENPO ONE で間隔を変えたら、電源を入れ直さなくても 10 分以内に反映 */
export const CLOUDPRNT_SETTING_RELOAD_MIN = 10;

/** 保存されている値からプリンターに渡す問い合わせ間隔（秒）。空・おかしい値は標準の 1 秒 */
export function cloudprntPollSeconds(stored: number | null | undefined): number {
  if (typeof stored !== 'number' || !Number.isFinite(stored) || stored <= 0) return DEFAULT_CLOUDPRNT_POLL_SECONDS;
  return Math.min(MAX_POLL, Math.max(MIN_POLL, Math.round(stored)));
}

/** CloudPRNT の URL のトークンとして受け付ける形（app/api/cloudprnt/[token] のトークン） */
export function isCloudprntToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

export type CloudprntServerSetting = {
  title: 'star_cloudprnt_server_setting';
  version: '1.0.0';
  serverSupportProtocol: ['HTTP'];
  reloadIntervalMin: number;
  settingForHTTP: { pollingTimeSec: number };
};

/** サーバー設定情報の JSON（HTTP のまま。URL は変えない＝今の CloudPRNT の URL をそのまま使う） */
export function cloudprntServerSetting(pollSeconds: number): CloudprntServerSetting {
  return {
    title: 'star_cloudprnt_server_setting',
    version: '1.0.0',
    serverSupportProtocol: ['HTTP'],
    reloadIntervalMin: CLOUDPRNT_SETTING_RELOAD_MIN,
    settingForHTTP: { pollingTimeSec: cloudprntPollSeconds(pollSeconds) },
  };
}
