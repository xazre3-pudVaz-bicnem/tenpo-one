/**
 * 画面ごとのヘルプ内容（ルート → 説明）の単一ソース。
 * components/help/help-popover.tsx から参照する。
 */
export interface HelpEntry {
  title: string;
  points: string[];
}

interface HelpMapping {
  prefix: string;
  entry: HelpEntry;
}

export const HELP_CONTENT: HelpMapping[] = [
  {
    prefix: '/app/dashboard',
    entry: {
      title: 'ダッシュボード',
      points: [
        '本日・今月の売上、粗利益、客数などの主要指標を確認できます。',
        '店舗を選択中は当該店舗、「全店舗」選択中は本社サマリーを表示します。',
        '各カードやグラフをクリックするとレポート画面で詳細を確認できます。',
      ],
    },
  },
  {
    prefix: '/app/reservations',
    entry: {
      title: '予約',
      points: [
        '予約台帳・予約リスト・カレンダーで予約状況を確認できます。',
        '新規予約の登録、来店・キャンセル等のステータス変更が行えます。',
        '検索（⌘K）から「新規予約」「本日の予約」にすぐ移動できます。',
      ],
    },
  },
  {
    prefix: '/app/pos',
    entry: {
      title: 'POSレジ',
      points: [
        '注文の入力・会計処理を行います。',
        '商品検索・会計ダイアログの呼び出しはショートカットキーが便利です。',
        '会計完了後はレシート印刷（ブラウザ印刷）が行えます。',
      ],
    },
  },
  {
    prefix: '/app/kitchen',
    entry: {
      title: 'キッチンディスプレイ',
      points: [
        '注文された商品を調理状況ごとに表示します。',
        '調理中・提供済みなどのステータスを画面上で更新できます。',
        'オーダー漏れ防止のため、新規注文は自動的に追加表示されます。',
      ],
    },
  },
  {
    prefix: '/app/floor',
    entry: {
      title: 'フロアマップ',
      points: [
        'テーブルの空き状況・利用状況を一目で確認できます。',
        'テーブルをタップして着席・会計・移動などの操作が行えます。',
        '設定＞フロア・テーブルでレイアウトを変更できます。',
      ],
    },
  },
  {
    prefix: '/app/customers',
    entry: {
      title: '顧客管理（CRM）',
      points: [
        '顧客情報・来店履歴・タグを管理します。',
        '検索は名前・カナ・電話番号に対応しています。',
        '顧客詳細から予約や注文の履歴を確認できます。',
      ],
    },
  },
  {
    prefix: '/app/cash',
    entry: {
      title: 'レジ締め・小口現金',
      points: [
        '営業終了時のレジ締め（実査・差異確認）を行います。',
        '小口現金の入出金を記録できます。',
        '承認が必要な操作は権限のあるロールのみ実行できます。',
      ],
    },
  },
  {
    prefix: '/app/invoices',
    entry: {
      title: '請求書・書類',
      points: [
        '仕入先からの請求書・領収書などを登録・管理します。',
        '「保存ボックス」にアップロードした書類を後から仕訳できます。',
        '支払期日超過や未承認の請求書はサマリーで確認できます。',
      ],
    },
  },
  {
    prefix: '/app/inventory',
    entry: {
      title: '在庫',
      points: [
        '食材・資材などの在庫数量を管理します。',
        '発注・仕入との連携で入出庫を記録できます。',
        '在庫僅少の品目は一覧上で確認できます。',
      ],
    },
  },
  {
    prefix: '/app/attendance',
    entry: {
      title: '勤怠・打刻',
      points: [
        '出勤・退勤・休憩の打刻を行います。',
        '打刻修正には承認権限が必要です。',
        'シフト画面と合わせて実働時間を確認できます。',
      ],
    },
  },
  {
    prefix: '/app/payroll',
    entry: {
      title: '給与・歩合',
      points: [
        '勤怠実績にもとづく給与・歩合の概算を確認できます。',
        '給与ルール（時給・月給・歩合）はスタッフごとに設定します。',
        '確定額はあくまで概算のため、最終確認は必ず行ってください。',
      ],
    },
  },
  {
    prefix: '/app/reports',
    entry: {
      title: 'レポート',
      points: [
        '売上・原価・人件費・利益率などを期間指定で分析できます。',
        '店舗別・商品別・スタッフ別など複数の切り口で確認できます。',
        'CSVエクスポートに対応しています（権限が必要です）。',
      ],
    },
  },
];

/** 現在のパスに最も長く一致するヘルプ内容を返す（該当なしはnull） */
export function findHelpEntry(pathname: string): HelpEntry | null {
  const hits = HELP_CONTENT.filter((h) => pathname.startsWith(h.prefix));
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.prefix.length - a.prefix.length);
  return hits[0].entry;
}
