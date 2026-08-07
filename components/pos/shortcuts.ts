/**
 * POS画面のキーボードショートカット定義。
 * pos-screen.tsx の keydown ハンドラと、ヘルプ表示（将来実装）の両方から参照する単一ソース。
 */
export interface PosShortcut {
  key: string;
  label: string;
  description: string;
}

export const POS_SHORTCUTS: PosShortcut[] = [
  { key: 'F2', label: 'F2', description: '商品検索欄にフォーカス' },
  { key: 'F4', label: 'F4', description: '会計ダイアログを開く' },
  { key: 'Escape', label: 'Esc', description: '開いているダイアログを閉じる' },
];
