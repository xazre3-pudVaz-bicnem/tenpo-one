'use client';

/** ルートレイアウト自体が失敗した場合の最終フォールバック */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: 'sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#F2F4F7' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ color: '#0F1120', fontSize: 18 }}>システムエラーが発生しました</h1>
          <p style={{ color: '#6B7280', fontSize: 14, marginTop: 8 }}>
            時間をおいて再度アクセスしてください。
            {error.digest ? ` (エラーID: ${error.digest})` : ''}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 24, background: '#7B3FF2', color: '#fff', border: 0, borderRadius: 8, padding: '10px 20px', cursor: 'pointer' }}
          >
            再試行する
          </button>
        </div>
      </body>
    </html>
  );
}
