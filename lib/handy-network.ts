/** Browser-safe network address helpers; no server crypto dependencies. */
/** 表記ゆれを吸収する（小文字化・IPv4射影アドレス・ポート付き） */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  // "[2001:db8::1]:1234" → 中身だけ
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  // "203.0.113.5:1234"（IPv4 にポート）→ ポートを落とす
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(':')[0];
  // "::ffff:203.0.113.5"（IPv4 射影）→ IPv4
  if (ip.startsWith('::ffff:') && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.slice(7))) ip = ip.slice(7);
  return ip;
}

/** IPv6 を 8 ブロック・各4桁に展開する。読めない値は null */
function expandIpv6(ip: string): string[] | null {
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (parts.length === 1 && missing !== 0)) return null;
  const full = [...head, ...Array<string>(parts.length === 2 ? missing : 0).fill('0'), ...tail];
  if (full.length !== 8 || full.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return full.map((h) => h.padStart(4, '0'));
}

/**
 * 「同じ回線」を表すキー。
 * IPv4 はルーターの下の端末が全部同じグローバル IP になる（NAT）のでそのまま。
 * IPv6 は端末ごとにアドレスが違うが、同じ回線なら上位 64 ビット（プレフィックス）が同じなので、そこだけ使う。
 */
export function networkKey(ip: string): string {
  const n = normalizeIp(ip);
  if (!n.includes(':')) return n;
  const expanded = expandIpv6(n);
  return expanded ? expanded.slice(0, 4).join(':') : n;
}

