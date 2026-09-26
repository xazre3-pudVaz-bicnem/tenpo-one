'use server';

import { revalidatePath } from 'next/cache';
import { SLUG_CHANGE_BY_CYPRESS_ONLY, normalizeStoreSlug } from '@/lib/store-slug';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractPageMeta, isFetchablePageUrl } from '@/lib/page-photo';

export interface ActionResult {
  error?: string;
}

const SLOT_MINUTES_VALUES = [15, 30, 60];

// 予約URLに使えないスラッグ（ルーティング・混乱回避）

/**
 * 公開予約URLのスラッグ（stores.slug）を変更する。
 * 2026-09-27 Ronnie「店舗からは変えられないように。CYPRESS からだけ」→ 運営（is_cypress_admin）だけが呼べる。
 * グローバル一意（全テナント横断）のため、DBのunique制約(23505)で重複を検出する
 * （他組織の店舗はRLSで参照できないため、アプリ側の事前チェックは自組織内に限られる）。
 * 変更すると既存の公開URL・QRコードは無効になる（呼び出し側UIで警告する）。
 */
export async function updateStoreSlug(input: { storeId: string; slug: string }): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.isCypressAdmin) {
    return { error: SLUG_CHANGE_BY_CYPRESS_ONLY };
  }
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }
  const { slug, error: slugError } = normalizeStoreSlug(input.slug);
  if (slugError) return { error: slugError };

  const supabase = await createClient();
  const { error } = await supabase
    .from('stores')
    .update({ slug, updated_by: ctx.userId })
    .eq('id', input.storeId)
    .eq('organization_id', ctx.organizationId);
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'この予約URL（スラッグ）は既に使われています。別の文字列を指定してください' };
    }
    return { error: `予約URLの変更に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'settings.store.slug_update',
    p_target_table: 'stores',
    p_target_id: input.storeId,
    p_before: null,
    p_after: { slug },
    p_note: '公開予約URLのスラッグを変更（既存URL・QRは無効化）',
  });

  revalidatePath('/app/settings/booking');
  revalidatePath('/app/settings/store');
  return {};
}

export async function updateBookingSettings(input: {
  storeId: string;
  slotMinutes: number;
  defaultStayMinutes: number;
  bookingCutoffMinutes: number;
  bookingWindowDays: number;
  maxPartySize: number;
  cancelDeadlineHours: number;
  cleaningBufferMinutes: number;
  bookingPhotoUrl: string;
  bookingNotes: string;
  cancellationPolicy: string;
  reminderEnabled: boolean;
  reminderHoursBefore: number;
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }
  if (!SLOT_MINUTES_VALUES.includes(input.slotMinutes)) {
    return { error: '予約枠間隔の指定が不正です' };
  }
  if (input.defaultStayMinutes <= 0 || input.bookingCutoffMinutes < 0 || input.bookingWindowDays <= 0) {
    return { error: '数値の指定が正しくありません' };
  }
  if (input.maxPartySize <= 0 || input.cancelDeadlineHours < 0) {
    return { error: '数値の指定が正しくありません' };
  }
  if (input.cleaningBufferMinutes < 0 || input.cleaningBufferMinutes > 120) {
    return { error: '清掃バッファは0〜120分で指定してください' };
  }
  const photoUrl = input.bookingPhotoUrl.trim();
  // 写真URLは同一オリジンの絶対パス（/...）またはhttpsのみ許可（javascript:等を排除）
  if (photoUrl && !/^\/(?!\/)/.test(photoUrl) && !/^https:\/\//i.test(photoUrl)) {
    return { error: '写真URLは「/」で始まるパスか https:// で始まるURLを指定してください' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      slot_minutes: input.slotMinutes,
      default_stay_minutes: input.defaultStayMinutes,
      booking_cutoff_minutes: input.bookingCutoffMinutes,
      booking_window_days: input.bookingWindowDays,
      max_party_size: input.maxPartySize,
      cancel_deadline_hours: input.cancelDeadlineHours,
      cleaning_buffer_minutes: input.cleaningBufferMinutes,
      booking_photo_url: photoUrl || null,
      booking_notes: input.bookingNotes.trim() || null,
      cancellation_policy: input.cancellationPolicy.trim() || null,
      reminder_enabled: input.reminderEnabled,
      reminder_hours_before: input.reminderHoursBefore > 0 ? input.reminderHoursBefore : 24,
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `予約設定の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'settings.booking.update',
    p_target_table: 'store_settings',
    p_target_id: input.storeId,
    p_before: null,
    p_after: {
      slot_minutes: input.slotMinutes,
      default_stay_minutes: input.defaultStayMinutes,
      max_party_size: input.maxPartySize,
      cancel_deadline_hours: input.cancelDeadlineHours,
      cleaning_buffer_minutes: input.cleaningBufferMinutes,
    },
    p_note: null,
  });

  revalidatePath('/app/settings/booking');
  return {};
}

// ---------------------------------------------------------------------------
// 店舗写真を 食べログ・ホームページの URL から取り込む（2026-09-28 Ronnie「URL を貼ったら自動で」）
// ---------------------------------------------------------------------------
const PHOTO_BUCKET = 'menu-images';
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function fetchWithLimit(url: string, maxBytes: number, accept: string): Promise<{ bytes: Uint8Array; contentType: string } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TENPO ONE/1.0; +https://www.tenpo-one.com)',
        Accept: accept,
        'Accept-Language': 'ja,en;q=0.8',
      },
    });
    if (!res.ok) return { error: `ページを開けませんでした（${res.status}）` };
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { error: 'サイズが大きすぎます' };
    return { bytes: buf, contentType };
  } catch (e) {
    return { error: e instanceof Error && e.name === 'AbortError' ? '時間切れです' : '取得に失敗しました' };
  } finally {
    clearTimeout(timer);
  }
}

export interface ImportPhotoResult {
  error?: string;
  /** 保存した写真の公開 URL（店舗写真URLに入る） */
  photoUrl?: string;
  title?: string | null;
  description?: string | null;
}

/**
 * 食べログ・ホットペッパー・お店のホームページの URL を貼ると、そのページの代表写真（OGP 画像）を
 * 取ってきて Supabase Storage に保存し、公開予約ページの店舗写真にする。
 * 外部の画像 URL をそのまま使わないのは、CSP（img-src）と、先方が画像を消したときに壊れないようにするため。
 */
export async function importStorePhotoFromPage(input: { storeId: string; pageUrl: string }): Promise<ImportPhotoResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === input.storeId)) return { error: '対象店舗にアクセス権がありません' };
  const pageUrl = input.pageUrl.trim();
  if (!isFetchablePageUrl(pageUrl)) return { error: 'https:// から始まるページの URL を入れてください' };

  // 画像の URL を直接貼った場合もそのまま使える
  let imageUrl: string | null = null;
  let meta: { title: string | null; description: string | null } = { title: null, description: null };
  if (/\.(jpe?g|png|webp)(\?.*)?$/i.test(pageUrl)) {
    imageUrl = pageUrl;
  } else {
    const page = await fetchWithLimit(pageUrl, 3 * 1024 * 1024, 'text/html,application/xhtml+xml');
    const blockedHint = 'このサイトはサーバーからの取得を止めています。ページの写真を長押し（右クリック）→「画像アドレスをコピー」して、その URL（.jpg）を貼ってください';
    if ('error' in page) return { error: /tabelog\.com/i.test(pageUrl) ? blockedHint : page.error };
    const html = new TextDecoder('utf-8').decode(page.bytes);
    // Cloudflare 等のボット確認ページ（食べログなど）
    if (/<title>\s*Just a moment/i.test(html) || /challenges\.cloudflare\.com/.test(html)) return { error: blockedHint };
    const m = extractPageMeta(html, pageUrl);
    meta = { title: m.title, description: m.description };
    imageUrl = m.imageUrl;
    if (!imageUrl) return { error: 'このページから写真が見つかりませんでした（写真の URL を直接貼ることもできます）' };
  }

  const img = await fetchWithLimit(imageUrl, 8 * 1024 * 1024, 'image/*');
  if ('error' in img) return { error: `写真を取得できませんでした: ${img.error}` };
  const contentType = PHOTO_TYPES.has(img.contentType) ? img.contentType : imageUrl.match(/\.png(\?|$)/i) ? 'image/png' : imageUrl.match(/\.webp(\?|$)/i) ? 'image/webp' : 'image/jpeg';
  if (!PHOTO_TYPES.has(contentType)) return { error: 'JPEG / PNG / WebP の写真だけ取り込めます' };
  if (img.bytes.byteLength < 2000) return { error: '写真が小さすぎます（アイコンの可能性）' };

  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${ctx.organizationId}/store-photos/${input.storeId}-${Date.now()}.${ext}`;
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from(PHOTO_BUCKET).upload(path, img.bytes, { contentType, upsert: true, cacheControl: '86400' });
  if (upErr) return { error: `保存に失敗しました: ${upErr.message}` };
  const { data: pub } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  const photoUrl = pub.publicUrl;

  const { error: saveErr } = await admin
    .from('store_settings')
    .upsert({ organization_id: ctx.organizationId, store_id: input.storeId, booking_photo_url: photoUrl, updated_by: ctx.userId }, { onConflict: 'store_id' });
  if (saveErr) return { error: `店舗写真の保存に失敗しました: ${saveErr.message}` };

  revalidatePath('/app/settings/booking');
  return { photoUrl, title: meta.title, description: meta.description };
}
