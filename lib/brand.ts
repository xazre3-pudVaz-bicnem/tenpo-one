/**
 * ブランド設定 — サービス名・カラーは必ずここから参照する。
 * 名称やカラー変更はこのファイルの修正だけで全画面へ反映される。
 */
export const brand = {
  name: 'TENPO ONE',
  nameJa: 'テンポワン',
  tagline: '店舗運営を、ひとつに。',
  taglineEn: 'One Platform. Every Store.',
  company: '株式会社サイプレス',
  supportEmail: 'info@cypress-all.co.jp',
  colors: {
    // Midnight Sunset（2026-09-27 デザイナー指定）。app/globals.css の @theme と同期
    primary: '#9F2C6C', // 主ボタン（マゼンタ）
    primaryDeep: '#7E2256', // 主ボタンの濃い側
    navy: '#211C28', // 暗い背景
    lightGray: '#F4F1F4',
    /** ロゴまわり・見出し・選択中の表示に使うグラデーション */
    gradient: 'linear-gradient(90deg, #6B3094 0%, #9E2B6C 25%, #B92859 50%, #C95034 75%, #CF8F38 100%)',
    white: '#FFFFFF',
    success: '#15803D',
    warning: '#EA580C',
    error: '#DC2626',
  },
} as const;
