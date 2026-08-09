/**
 * レート制限（サーバー用）。
 * インメモリのスライディングウィンドウ実装。単一インスタンス前提の簡易版で、
 * 将来Redis等へ差し替えられるよう RateLimiter interface に依存させる。
 * 公開系（予約・QR注文・アップロード）のServer Action / Route で使用する。
 * ※ DBレベルの制限（booking_request_logs / QR注文の分間制限）と併用する二層防御。
 */

export interface RateLimiter {
  /** true = 許可 / false = 制限超過 */
  check(key: string, limit: number, windowMs: number): boolean;
}

class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  check(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    // 溜まりすぎ防止の簡易GC
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => t <= cutoff)) this.hits.delete(k);
      }
    }
    return true;
  }
}

// Next.jsのモジュールキャッシュでプロセス内シングルトン化
const globalStore = globalThis as unknown as { __tenpoRateLimiter?: RateLimiter };
export const rateLimiter: RateLimiter =
  globalStore.__tenpoRateLimiter ?? (globalStore.__tenpoRateLimiter = new InMemoryRateLimiter());

export const RATE_LIMITS = {
  /** 公開予約の作成（IP単位） */
  publicBooking: { limit: 10, windowMs: 60_000 },
  /** 決済チェックアウト作成 */
  bookingCheckout: { limit: 10, windowMs: 60_000 },
  /** ファイルアップロードのメタ登録 */
  upload: { limit: 30, windowMs: 60_000 },
  /**
   * ログイン試行（IP単位）。SupabaseAuthはメール単位のブルートフォース対策を内部的に持つが、
   * アプリ側からは直接制御できない。現状ログインはクライアントから直接 signInWithPassword を
   * 呼んでおりServer Actionを経由しないため、この値は未適用（将来ログインをServer Action化した
   * 際にIP単位の追加防御として使う想定）。
   */
  login: { limit: 10, windowMs: 60_000 },
  /** 共用端末PIN打刻（店舗単位）。総当たり（ブルートフォース）防止のため試行回数を制限する */
  pinPunch: { limit: 20, windowMs: 5 * 60_000 },
  /** 公開予約フォームからの新規予約作成（IP単位）。DB側 booking_request_logs と併用する二層防御 */
  publicReservation: { limit: 10, windowMs: 60_000 },
  /** 検索系エンドポイント（IP/ユーザー単位）の連続実行を抑制するための予約枠 */
  search: { limit: 30, windowMs: 60_000 },
  /** マーケティングサイトの問い合わせフォーム（IP単位・スパム抑制） */
  contact: { limit: 5, windowMs: 10 * 60_000 },
} as const;
