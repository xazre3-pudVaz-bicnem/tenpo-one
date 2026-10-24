import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { loadStoreBusinessCard } from '@/lib/store-business-cards-server';
import type { NativeModuleGet } from '@/lib/native-modules/registry';

/**
 * 店舗名刺（A4 に横名刺 91×55mm を10枚）の iPad ネイティブ（GET part=businessCards）。
 * 中身は Web の /app/settings/store/business-cards と同じ（lib/store-business-cards-server.ts）。権限も同じ store.settings。
 * QR・A4 の絵・PDF・AirPrint は iPad の中で作る（ios/Shared/NativeBusinessCardsView.swift）。2026-10-24 Ronnie「全部ネイティブ」
 */
export const businessCardsGet: NativeModuleGet = async ({ ctx, store }) => {
  if (!can(ctx.role, 'store.settings')) return { status: 403, body: { ok: false, error: '店舗の設定を見る権限がありません' } };
  const card = await loadStoreBusinessCard(await createClient(), store.id);
  return {
    body: {
      ok: true,
      store,
      // 予約URL（スラッグ）が無ければ作れない（Web の「予約URLがありません」と同じ）
      card: card && card.bookingUrl ? card : null,
    },
  };
};
