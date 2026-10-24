import { isUuid } from '@/lib/native-pos';
import { GOURMET_SITE_BY_KEY, type GourmetSiteKey, type MailKind } from '@/lib/gourmet-mail';

/**
 * iPad アプリのネイティブの「グルメ連携」（店舗台帳 › 📅 › グルメ連携。2026-10-24 Ronnie「iOS でもグルメ連携を台帳に」）。
 * Web の 予約台帳設定 › グルメ連携（components/settings/gourmet-mail-panel.tsx・gourmet-mail-imports.tsx）と同じ働き：
 *   取り込み専用アドレス（コピー）／オン・オフ／サイトごとの「登録した」印と状態／取り込み履歴（要確認 → 対応済み）
 * 読み込みは GET /api/app/v1/pos?part=gourmet（lib/native-gourmet-server.ts）、操作は POST { type: 'gourmet…' }。
 * 中身は Web と同じ Server Action（app/app/settings/reservation-book/actions.ts）。ここは純粋な型と検証だけ。
 */

export type NativeGourmetAction =
  /** メール取り込みのオン・オフ */
  | { type: 'gourmetEnable'; enabled: boolean }
  /** 「このサイトの管理画面に登録した」の印 */
  | { type: 'gourmetMarkSite'; site: GourmetSiteKey; registered: boolean }
  /** 「要確認」のメールを対応済みにする */
  | { type: 'gourmetResolve'; importId: string }
  /** 取り込み専用アドレスを作り直す（運営 CYPRESS だけ。サーバーで権限を見る） */
  | { type: 'gourmetRegenerate' };

export type NativeGourmetActionType = NativeGourmetAction['type'];

export const NATIVE_GOURMET_ACTION_TYPES: readonly NativeGourmetActionType[] = ['gourmetEnable', 'gourmetMarkSite', 'gourmetResolve', 'gourmetRegenerate'];

export function isNativeGourmetActionType(v: unknown): v is NativeGourmetActionType {
  return typeof v === 'string' && (NATIVE_GOURMET_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeGourmetAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

export function parseNativeGourmetAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'gourmetEnable':
      if (typeof b.enabled !== 'boolean') return bad();
      return { ok: true, action: { type: 'gourmetEnable', enabled: b.enabled } };
    case 'gourmetMarkSite': {
      const site = b.site;
      if (typeof site !== 'string' || !(site in GOURMET_SITE_BY_KEY)) return bad('対象のサイトがありません');
      if (typeof b.registered !== 'boolean') return bad();
      return { ok: true, action: { type: 'gourmetMarkSite', site: site as GourmetSiteKey, registered: b.registered } };
    }
    case 'gourmetResolve':
      if (!isUuid(b.importId)) return bad('対象のメールが見つかりません');
      return { ok: true, action: { type: 'gourmetResolve', importId: b.importId as string } };
    case 'gourmetRegenerate':
      return { ok: true, action: { type: 'gourmetRegenerate' } };
    default:
      return bad();
  }
}

// ---------------------------------------------------------------------------
// 画面に返すもの（GET ?part=gourmet）
// ---------------------------------------------------------------------------

export type NativeGourmetSiteStatus = 'off' | 'registered' | 'verified';

export interface NativeGourmetSite {
  key: GourmetSiteKey;
  name: string;
  en: string;
  /** 店舗管理画面（設定手順のリンク） */
  adminUrl: string | null;
  howTo: string;
  status: NativeGourmetSiteStatus;
  enabledAt: string | null;
  verifiedAt: string | null;
  lastImportAt: string | null;
  lastKind: MailKind | null;
}

export interface NativeGourmetImport {
  id: string;
  site: GourmetSiteKey;
  siteName: string;
  kind: MailKind;
  kindLabel: string;
  status: string;
  /** 画面に出す状態の言葉（Web の STATUS と同じ） */
  statusLabel: string;
  subject: string | null;
  fromAddress: string | null;
  externalId: string | null;
  receivedAt: string;
  reservationId: string | null;
  /** 紐付いた予約の来店日（「台帳で見る」でその日を開く） */
  reservedDate: string | null;
  error: string | null;
  resolvedAt: string | null;
  parsed: { date?: string | null; time?: string | null; partySize?: number | null; guestName?: string | null; phone?: string | null; links?: string[] } | null;
  bodyText: string | null;
}

export interface NativeGourmetPayload {
  store: { id: string; name: string };
  enabled: boolean;
  /** 取り込み専用アドレス（オンで token があるとき） */
  address: string | null;
  domain: string;
  /** サーバーにメールの受け口（INBOUND_MAIL_SECRET）が設定されているか */
  inboundReady: boolean;
  /** アドレスを作り直せるか（運営 CYPRESS だけ） */
  canRegenerate: boolean;
  /** 設定を変えられるか（store.settings） */
  canWrite: boolean;
  verifiedCount: number;
  sites: NativeGourmetSite[];
  imports: NativeGourmetImport[];
  pendingReview: number;
}

/** 取り込み履歴の状態の言葉（Web の components/settings/gourmet-mail-imports.tsx の STATUS と同じ） */
export const GOURMET_IMPORT_STATUS_LABEL: Record<string, string> = {
  imported: '台帳に登録',
  updated: '変更を反映',
  cancelled: 'キャンセル反映',
  verified: 'メール認証',
  duplicate: '重複（登録済）',
  ignored: '対象外',
  needs_review: '要確認',
};
