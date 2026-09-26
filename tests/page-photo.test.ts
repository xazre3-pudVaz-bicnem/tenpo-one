import { describe, expect, it } from 'vitest';
import { extractPageMeta, isFetchablePageUrl } from '@/lib/page-photo';

describe('ページから店舗写真（OGP）を見つける（2026-09-28 Ronnie）', () => {
  it('og:image を読む（相対 URL は絶対に）', () => {
    const html = `<html><head><title>店 - 食べログ</title>
      <meta property="og:title" content="熟成和牛 肉ギャング 渋谷本店" />
      <meta property="og:image" content="https://tblg.k-img.com/restaurant/images/Rvw/123/640x640_rect_123.jpg">
      <meta name="description" content="渋谷の肉バル &amp; 居酒屋"></head><body></body></html>`;
    const m = extractPageMeta(html, 'https://tabelog.com/tokyo/A1303/A130301/13253283/');
    expect(m.imageUrl).toBe('https://tblg.k-img.com/restaurant/images/Rvw/123/640x640_rect_123.jpg');
    expect(m.title).toBe('熟成和牛 肉ギャング 渋谷本店');
    expect(m.description).toBe('渋谷の肉バル & 居酒屋');
    const rel = extractPageMeta('<meta property="og:image" content="/img/top.jpg">', 'https://example.com/shop/');
    expect(rel.imageUrl).toBe('https://example.com/img/top.jpg');
  });

  it('OGP が無ければ最初の大きい img', () => {
    const html = '<img src="/logo.png" width="80"><img src="/photos/main.jpg" width="800" height="600">';
    expect(extractPageMeta(html, 'https://shop.example.com/').imageUrl).toBe('https://shop.example.com/photos/main.jpg');
    expect(extractPageMeta('<p>no image</p>', 'https://x.example.com/').imageUrl).toBeNull();
  });

  it('取りに行ってよい URL', () => {
    expect(isFetchablePageUrl('https://tabelog.com/tokyo/A1303/')).toBe(true);
    expect(isFetchablePageUrl('http://192.168.1.10/admin')).toBe(false);
    expect(isFetchablePageUrl('https://localhost/')).toBe(false);
    expect(isFetchablePageUrl('ftp://x.com/')).toBe(false);
    expect(isFetchablePageUrl('not a url')).toBe(false);
  });
});
