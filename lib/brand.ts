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
    // TABLE ONE と同じ配色（2026-10-15 Ronnie「チャコール＋クリーム＋テラコッタ」）。app/globals.css の @theme と同期
    primary: '#BC5940', // 主ボタン（テラコッタ）
    primaryDeep: '#9F4630', // 主ボタンの濃い側
    navy: '#292725', // 暗い背景（チャコール）
    lightGray: '#F7F5F0', // クリーム
    /** ロゴまわり・見出し・選択中の表示に使う色（2026-10-18 グラデーションをやめて濃いテラコッタの単色） */
    gradient: 'linear-gradient(#8B4536, #8B4536)',
    white: '#FFFFFF',
    success: '#15803D',
    warning: '#B7791F',
    error: '#C62828',
  },
} as const;
