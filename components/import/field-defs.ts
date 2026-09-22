import { ITEM_KIND_OPTIONS, ITEM_KIND_LABELS } from '@/components/inventory/labels';
import type { ImportFieldDef, ImportType } from './types';

export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  menu_items: '商品',
  menu_option_groups: '選択肢（セットの中身）',
  customers: '顧客',
  vendors: '仕入先',
  inventory_items: '在庫品目',
};

/** 完了画面から遷移する各一覧ページ */
export const IMPORT_TYPE_LIST_PATH: Record<ImportType, string> = {
  menu_items: '/app/settings/menu',
  menu_option_groups: '/app/settings/options',
  customers: '/app/customers',
  vendors: '/app/vendors',
  inventory_items: '/app/inventory',
};

export const MENU_ITEM_TYPE_OPTIONS = [
  { value: 'food', label: 'フード' },
  { value: 'drink', label: 'ドリンク' },
  { value: 'course', label: 'コース' },
  { value: 'option', label: 'オプション' },
];

const INVENTORY_ITEM_KIND_OPTIONS = ITEM_KIND_OPTIONS.map((v) => ({ value: v, label: ITEM_KIND_LABELS[v] }));

export const FIELD_DEFS: Record<ImportType, ImportFieldDef[]> = {
  menu_items: [
    {
      key: 'categoryName',
      label: 'カテゴリ',
      required: false,
      kind: 'text',
      aliases: ['カテゴリ', 'カテゴリー', 'category', '部門'],
      hint: '既存のカテゴリ名と一致すればそのカテゴリに、なければ新しいカテゴリとして自動作成します',
    },
    { key: 'name', label: '商品名', required: true, kind: 'text', aliases: ['商品名', '名前', 'name', '品名'] },
    { key: 'nameKana', label: 'カナ', required: false, kind: 'kana', aliases: ['カナ', 'フリガナ', 'よみ', 'kana'] },
    {
      key: 'nameEn',
      label: '英語名',
      required: false,
      kind: 'text',
      aliases: ['英語名', '英語', 'english', 'name_en', 'en'],
      hint: 'レジ画面・厨房伝票に日本語と並べて表示します。同じカテゴリに同じ商品名が登録済みの行は英語名・カナだけを上書き更新します（カテゴリが違えば同じ商品名でも別の商品として登録します）',
    },
    {
      key: 'price',
      label: '価格',
      required: false,
      kind: 'int',
      aliases: ['価格', '販売価格', 'price', '単価'],
      hint: '新しい商品には必須。登録済みの商品（英語名・カナの更新）では省略できます',
    },
    {
      key: 'takeoutPrice',
      label: 'テイクアウト価格',
      required: false,
      kind: 'int',
      aliases: ['テイクアウト価格', '持ち帰り価格', 'takeout_price', 'takeoutprice'],
    },
    { key: 'cost', label: '原価', required: false, kind: 'int', aliases: ['原価', 'cost', '仕入価格'] },
    {
      key: 'itemType',
      label: '種別',
      required: false,
      kind: 'select',
      options: MENU_ITEM_TYPE_OPTIONS,
      aliases: ['種別', 'type', 'item_type', '区分'],
      hint: '未入力の場合は「フード」として登録します',
    },
  ],
  menu_option_groups: [
    {
      key: 'groupName',
      label: 'グループ名',
      required: true,
      kind: 'text',
      aliases: ['グループ名', 'グループ', 'group', 'group_name', '選択肢グループ'],
      hint: '例: カレーを選ぶ／ご飯かナン／ドリンクを選ぶ。同じ名前のグループが店舗にあればそこに追加します',
    },
    { key: 'optionName', label: '選択肢名', required: true, kind: 'text', aliases: ['選択肢名', '選択肢', 'option', 'option_name', '名前'] },
    { key: 'optionNameEn', label: '英語名', required: false, kind: 'text', aliases: ['英語名', '英語', 'english', 'name_en', 'en'] },
    { key: 'price', label: '追加料金', required: false, kind: 'int', aliases: ['追加料金', '価格', 'price', '差額'], hint: '未入力は 0 円' },
    {
      key: 'isRequired',
      label: '必須',
      required: false,
      kind: 'text',
      aliases: ['必須', 'required', 'is_required'],
      hint: '1／はい／必須 で必須。未入力は必須扱い（セットの中身は必ず選ぶため）',
    },
    { key: 'minSelect', label: '最小', required: false, kind: 'int', aliases: ['最小', 'min', 'min_select'], hint: '未入力は 1' },
    { key: 'maxSelect', label: '最大', required: false, kind: 'int', aliases: ['最大', 'max', 'max_select'], hint: '未入力は 1' },
    {
      key: 'targetItems',
      label: '対象商品',
      required: false,
      kind: 'text',
      aliases: ['対象商品', '対象', '商品名', 'items', 'target_items', 'menu_items'],
      hint: 'このグループを付けるセット商品の商品名。複数は「;」区切り（例: カレーセット;ランチセット）',
    },
  ],
  customers: [
    { key: 'name', label: '名前', required: true, kind: 'text', aliases: ['名前', '氏名', 'name', '顧客名'] },
    { key: 'nameKana', label: 'カナ', required: false, kind: 'kana', aliases: ['カナ', 'フリガナ', 'よみ', 'kana'] },
    {
      key: 'phone',
      label: '電話番号',
      required: false,
      kind: 'phone',
      aliases: ['電話番号', '電話', 'phone', 'tel'],
      hint: '重複判定に使用します（同じ電話番号の行はスキップ）',
    },
    { key: 'email', label: 'メールアドレス', required: false, kind: 'email', aliases: ['メールアドレス', 'メール', 'email', 'mail'] },
    { key: 'birthday', label: '誕生日', required: false, kind: 'date', aliases: ['誕生日', '生年月日', 'birthday'] },
    { key: 'allergyNote', label: 'アレルギー', required: false, kind: 'text', aliases: ['アレルギー', 'allergy'] },
  ],
  vendors: [
    { key: 'name', label: '仕入先名', required: true, kind: 'text', aliases: ['仕入先名', '名前', 'name', '会社名'] },
    { key: 'nameKana', label: 'カナ', required: false, kind: 'kana', aliases: ['カナ', 'フリガナ', 'よみ', 'kana'] },
    { key: 'phone', label: '電話番号', required: false, kind: 'phone', aliases: ['電話番号', '電話', 'phone', 'tel'] },
    { key: 'email', label: 'メールアドレス', required: false, kind: 'email', aliases: ['メールアドレス', 'メール', 'email', 'mail'] },
    {
      key: 'closingDay',
      label: '締め日',
      required: false,
      kind: 'int',
      aliases: ['締め日', 'closing_day', 'closingday'],
      hint: '1〜31（31=月末）',
    },
    { key: 'paymentDay', label: '支払日', required: false, kind: 'int', aliases: ['支払日', 'payment_day', 'paymentday'], hint: '1〜31（31=月末）' },
  ],
  inventory_items: [
    { key: 'name', label: '品目名', required: true, kind: 'text', aliases: ['品目名', '名前', 'name'] },
    {
      key: 'itemKind',
      label: '種別',
      required: false,
      kind: 'select',
      options: INVENTORY_ITEM_KIND_OPTIONS,
      aliases: ['種別', 'type', 'item_kind', '区分'],
      hint: '未入力の場合は「食材」として登録します',
    },
    { key: 'unit', label: '単位', required: true, kind: 'text', aliases: ['単位', 'unit'], hint: '例: kg, g, 個, 本' },
    {
      key: 'currentQuantity',
      label: '現在庫',
      required: false,
      kind: 'decimal',
      aliases: ['現在庫', '在庫数', 'current_quantity', 'quantity'],
      hint: '未入力の場合は0として登録します',
    },
    { key: 'reorderPoint', label: '発注点', required: false, kind: 'decimal', aliases: ['発注点', 'reorder_point'] },
    { key: 'avgCost', label: '平均単価', required: false, kind: 'int', aliases: ['平均単価', '単価', 'avg_cost'] },
    {
      key: 'purchaseUnit',
      label: '仕入単位',
      required: false,
      kind: 'text',
      aliases: ['仕入単位', 'purchase_unit'],
      hint: '例: 箱、ケース（在庫単位と異なる場合のみ）',
    },
    {
      key: 'purchaseToStockFactor',
      label: '変換係数',
      required: false,
      kind: 'decimal',
      aliases: ['変換係数', 'purchase_to_stock_factor', '換算係数'],
      hint: '仕入単位1つあたりの在庫単位の数量。未入力の場合は1として登録します',
    },
  ],
};

/** テンプレートCSVのヘッダー行（画面の列名と同じ順序） */
export function templateHeaders(type: ImportType): string[] {
  return FIELD_DEFS[type].map((f) => f.label);
}
