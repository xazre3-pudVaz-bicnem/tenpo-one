import { promises as dns } from 'node:dns';

/**
 * Forward Email（無料のメール受け口）からの送信かを確かめる（2026-10-19）。
 * 無料プランは Webhook の URL が DNS（TXT）で誰でも見えるので、合言葉ではなく送り元の IP で確かめる：
 * 逆引きが *.forwardemail.net で、その名前を引き直すと同じ IP に戻ること。
 */
export async function isForwardEmailIp(ip: string | null): Promise<boolean> {
  if (!ip) return false;
  try {
    const names = await dns.reverse(ip);
    for (const name of names) {
      if (!/(^|\.)forwardemail\.net\.?$/i.test(name)) continue;
      const back: string[] = ip.includes(':') ? await dns.resolve6(name) : await dns.resolve4(name);
      if (back.includes(ip)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Vercel の前段が付ける送り元 IP */
export function clientIp(request: Request): string | null {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : null;
}
