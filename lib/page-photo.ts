/**
 * 食べログ・ホームページなどの URL から店舗写真（OGP 画像）を見つける（2026-09-28 Ronnie「URL を貼ったら自動で」）。
 * ここは HTML の読み取りだけ（純粋・テスト対象）。取得と保存は app/app/settings/booking/actions.ts。
 */

export interface PageMeta {
  imageUrl: string | null;
  title: string | null;
  description: string | null;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function decode(s: string | null): string | null {
  if (s == null) return null;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** <meta property="og:image" content="…"> 等を読む。相対 URL は pageUrl で絶対にする */
export function extractPageMeta(html: string, pageUrl: string): PageMeta {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const found: Record<string, string> = {};
  for (const tag of metas) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    const content = decode(attr(tag, 'content'));
    if (!key || !content || found[key]) continue;
    found[key] = content;
  }
  const rawImage = found['og:image:secure_url'] ?? found['og:image'] ?? found['twitter:image'] ?? found['twitter:image:src'] ?? null;
  let imageUrl: string | null = null;
  if (rawImage) {
    try {
      imageUrl = new URL(rawImage, pageUrl).toString();
    } catch {
      imageUrl = null;
    }
  }
  if (!imageUrl) {
    // OGP が無いページ: 最初の大きめの <img>（幅・高さの指定が小さいアイコンは飛ばす）
    for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
      const src = decode(attr(tag, 'src') ?? attr(tag, 'data-src'));
      if (!src || /\.(svg|gif)(\?|$)/i.test(src) || /logo|icon|sprite|banner_s|btn/i.test(src)) continue;
      const w = Number(attr(tag, 'width') ?? 0);
      const h = Number(attr(tag, 'height') ?? 0);
      if ((w && w < 200) || (h && h < 200)) continue;
      try {
        imageUrl = new URL(src, pageUrl).toString();
        break;
      } catch {
        /* 次へ */
      }
    }
  }
  const title = found['og:title'] ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null);
  return { imageUrl, title: title?.slice(0, 200) ?? null, description: (found['og:description'] ?? found['description'] ?? null)?.slice(0, 500) ?? null };
}

/** 取りに行ってよい URL か（https / http だけ・社内アドレスは不可） */
export function isFetchablePageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return false;
  }
  if (host.includes(':')) return false; // IPv6 リテラルは不可
  return true;
}
