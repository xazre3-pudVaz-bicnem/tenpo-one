/**
 * 観測性（エラーID・構造化ログ）の共通層。
 * - ユーザーへは「エラーID: ERR-XXXXXX」を表示し、内部では system_errors（DB・CYPRESS閲覧）と
 *   構造化console出力（Vercelログ）で同じIDを追跡できる。
 * - 個人情報・秘密鍵・トークンをログへ含めないこと（メッセージは500文字で切る）。
 * - 外部監視SaaS（Sentry等）への接続は本モジュールの差し替えで行う（未接続）。
 */

const ERROR_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外

/** ユーザー提示用の短いエラーID（例: ERR-7KQ2MX） */
export function newErrorId(): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += ERROR_ID_ALPHABET[Math.floor(Math.random() * ERROR_ID_ALPHABET.length)];
  }
  return `ERR-${s}`;
}

export interface ErrorContext {
  route?: string;
  organizationId?: string | null;
  storeId?: string | null;
  userId?: string | null;
  requestId?: string | null;
  severity?: 'warning' | 'error' | 'critical';
  /** 追加情報（PII・秘密値を入れない） */
  detail?: Record<string, unknown>;
}

/** 秘密値らしきキーを落とした安全なdetailを作る */
export function sanitizeDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detail) return {};
  const banned = /pass(word)?|secret|token|key|authorization|cookie|bank|salary/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (banned.test(k)) continue;
    out[k] = typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v;
  }
  return out;
}

/**
 * 構造化エラーログ（Vercel関数ログへJSON1行で出力）。
 * DBへの永続化はサーバー側で lib/observability-server.ts の captureServerError を使う。
 */
export function logStructuredError(errorId: string, message: string, ctx: ErrorContext = {}): void {
  const entry = {
    level: ctx.severity ?? 'error',
    errorId,
    message: message.slice(0, 500),
    route: ctx.route,
    organizationId: ctx.organizationId ?? undefined,
    storeId: ctx.storeId ?? undefined,
    userId: ctx.userId ?? undefined,
    requestId: ctx.requestId ?? undefined,
    detail: sanitizeDetail(ctx.detail),
    ts: new Date().toISOString(),
  };
  // 1行JSON: Vercel/ローカルどちらでも機械可読
  console.error(JSON.stringify(entry));
}

/** ユーザー向けエラーメッセージの定型（エラーID付き） */
export function userFacingError(errorId: string, base = '処理に失敗しました'): string {
  return `${base}（エラーID: ${errorId}）。解決しない場合はこのIDを添えてお問い合わせください`;
}

/**
 * 公開（匿名）アクションでRPCエラーをクライアントへ返す際、内部エラーテキストの
 * 漏洩を防ぐ。業務RPCが raise する契約コード（`^[A-Z][A-Z0-9_]+$` 形式）のみ通過させ、
 * それ以外（Postgresの内部メッセージ・制約名・permission denied 等）はサーバーログへ
 * 記録し 'UNKNOWN' を返す。呼び出し側UIはコード→日本語メッセージへ変換する。
 */
export function safePublicErrorCode(raw: string | null | undefined, ctx: ErrorContext = {}): string {
  if (!raw) return 'UNKNOWN';
  const code = raw.split(':')[0].trim();
  if (/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) return code;
  // 契約コードでない＝想定外の内部エラー。IDを発行してサーバーにのみ残す。
  const errorId = newErrorId();
  logStructuredError(errorId, raw, { ...ctx, severity: ctx.severity ?? 'error' });
  return 'UNKNOWN';
}
