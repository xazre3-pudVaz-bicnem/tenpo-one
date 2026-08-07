/** CSVインポート機能（v0.3 項目32）共通の型定義。クライアント（プレビュー）とサーバー（本検証）の両方から使う。 */

export type ImportType = 'menu_items' | 'customers' | 'vendors' | 'inventory_items';

export type FieldKind = 'text' | 'kana' | 'phone' | 'email' | 'date' | 'int' | 'decimal' | 'select';

export interface ImportFieldDef {
  /** 正規化後の行オブジェクトのキー */
  key: string;
  /** 画面・テンプレートCSVに表示する列名 */
  label: string;
  required: boolean;
  kind: FieldKind;
  /** selectの場合の許容値 */
  options?: { value: string; label: string }[];
  /** ヘッダー自動対応付けに使う別名（完全一致・部分一致の両方に使用） */
  aliases: string[];
  /** プレビュー・完了画面での説明 */
  hint?: string;
}

/** アップロードから実行までの間、行ごとに保持する状態 */
export type RowStatus = 'ok' | 'error' | 'duplicate';

export interface ParsedRow {
  /** CSV上の行番号（ヘッダーを1行目として2行目から。エラー表示に使う） */
  rowNumber: number;
  /** マッピング後、フィールドキー -> セルの生文字列 */
  values: Record<string, string>;
}

export interface RowIssue {
  rowNumber: number;
  status: RowStatus;
  reason?: string;
  /** 重複判定に使ったキー（表示用）。判定不能（例: 電話番号未入力の顧客）の場合はnull */
  dupKey?: string | null;
}

export interface ImportRowInput {
  rowNumber: number;
  values: Record<string, string>;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  failed: { rowNumber: number; reason: string }[];
}
