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
    primary: '#7B3FF2', // Primary Purple
    primaryDeep: '#5A2ED6', // Deep Purple
    navy: '#0F1120', // Dark Navy
    lightGray: '#F2F4F7',
    white: '#FFFFFF',
    success: '#15803D',
    warning: '#EA580C',
    error: '#DC2626',
  },
} as const;
