import 'server-only';
import http2 from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  APNS_HOST,
  APNS_TOPIC,
  apnsPayload,
  base64url,
  isDeadTokenResponse,
  type ApnsEnvironment,
  type NativeApp,
  type NativePushMessage,
} from '@/lib/apns';

/**
 * iPhone/iPad アプリへの通知（APNs）の送信（サーバー専用）。
 *
 * 鍵は環境変数（Apple Developer の「Keys」で作る .p8）：
 *   APNS_KEY_ID       … キー ID（10文字）
 *   APNS_TEAM_ID      … チーム ID（10文字）
 *   APNS_PRIVATE_KEY  … .p8 の中身（-----BEGIN PRIVATE KEY----- …。改行は \n でもよい）
 * 鍵が無ければ何も送らない（アプリの他の動きには影響させない）。例外は投げない。
 */
export function apnsConfigured(): boolean {
  return !!process.env.APNS_KEY_ID && !!process.env.APNS_TEAM_ID && !!process.env.APNS_PRIVATE_KEY;
}

let cachedJwt: { token: string; at: number } | null = null;

/** APNs の認証（ES256 の JWT。1時間まで使えるので 50 分ごとに作り直す） */
function providerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.at < 50 * 60) return cachedJwt.token;
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now }));
  const key = createPrivateKey(process.env.APNS_PRIVATE_KEY!.replace(/\\n/g, '\n'));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  const token = `${header}.${claims}.${base64url(signature)}`;
  cachedJwt = { token, at: now };
  return token;
}

interface TokenRow {
  token: string;
  app: NativeApp;
  environment: ApnsEnvironment;
}

function sendOne(client: http2.ClientHttp2Session, row: TokenRow, body: string): Promise<{ status: number; reason: string | null }> {
  return new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${row.token}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': APNS_TOPIC[row.app],
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 60 * 60),
      'content-type': 'application/json',
    });
    let status = 0;
    let data = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
    });
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      let reason: string | null = null;
      try {
        reason = data ? ((JSON.parse(data) as { reason?: string }).reason ?? null) : null;
      } catch {
        reason = null;
      }
      resolve({ status, reason });
    });
    req.on('error', () => resolve({ status: 0, reason: 'network' }));
    req.setTimeout(10_000, () => {
      req.close();
      resolve({ status: 0, reason: 'timeout' });
    });
    req.end(body);
  });
}

export interface NativePushResult {
  sent: number;
  failed: number;
  removed: number;
}

/** 決めた端末（トークンの行）へ送る。死んだトークンは消す */
async function sendToRows(rows: TokenRow[], message: NativePushMessage): Promise<NativePushResult> {
  const result: NativePushResult = { sent: 0, failed: 0, removed: 0 };
  if (rows.length === 0) return result;
  const body = JSON.stringify(apnsPayload(message));
  const dead: string[] = [];
  for (const env of ['production', 'sandbox'] as const) {
    const group = rows.filter((r) => r.environment === env);
    if (group.length === 0) continue;
    let client: http2.ClientHttp2Session;
    try {
      client = http2.connect(APNS_HOST[env]);
    } catch {
      result.failed += group.length;
      continue;
    }
    client.on('error', () => undefined);
    try {
      const responses = await Promise.all(group.map((r) => sendOne(client, r, body)));
      responses.forEach((res, i) => {
        if (res.status === 200) result.sent++;
        else {
          result.failed++;
          if (isDeadTokenResponse(res.status, res.reason)) dead.push(group[i].token);
        }
      });
    } finally {
      client.close();
    }
  }
  if (dead.length > 0) {
    try {
      const admin = createAdminClient();
      await admin.from('native_push_tokens').delete().in('token', dead);
      result.removed = dead.length;
    } catch {
      // 消せなくても次に送るときにまた消す
    }
  }
  return result;
}

/** 店舗のアプリ（レジ・ハンディ）へ送る */
export async function sendNativePushToStore(
  storeId: string,
  message: NativePushMessage,
  apps: NativeApp[] = ['regi', 'handy']
): Promise<NativePushResult> {
  const empty: NativePushResult = { sent: 0, failed: 0, removed: 0 };
  if (!apnsConfigured()) return empty;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('native_push_tokens')
      .select('token, app, environment')
      .eq('store_id', storeId)
      .in('app', apps)
      .limit(200);
    return await sendToRows((data ?? []) as TokenRow[], message);
  } catch (e) {
    console.error('[apns] send failed', storeId, e instanceof Error ? e.message : e);
    return empty;
  }
}
