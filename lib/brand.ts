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
    // 紫と黒だけ（2026-09-27 Ronnie）。app/globals.css の @theme と同期
    primary: '#7B3FF2', // 主ボタン（紫）
    primaryDeep: '#5A2ED6', // 主ボタンの濃い側
    navy: '#15121A', // 暗い背景（黒）
    lightGray: '#F2F4F7',
    /** ロゴまわり・見出し・選択中の表示に使うグラデーション（紫の濃淡だけ） */
    gradient: 'linear-gradient(90deg, #3D1C68 0%, #5B2C8F 45%, #7B3FE4 100%)',
    white: '#FFFFFF',
    success: '#15803D',
    warning: '#EA580C',
    error: '#DC2626',
  },
} as const;
