/**
 * マーケティングサイトの共通データ定義（単一ソース）。
 * ナビゲーション・機能カタログ・画像の割り当てをここに集約し、
 * TOP・/features・各詳細ページ・mega menu・sitemap の整合を保つ。
 *
 * 表記ルール:
 * - 実装済みの機能のみ「利用できる」として記載する。
 * - 給与・税の法定計算は「試算」であり正式対応ではない（docs/external-blockers.md #12）。
 * - OCR・LINE・プリンターSDK・外部予約連携・正式給与計算は「開発予定（ロードマップ）」。
 */

export type FeatureCategoryKey = 'operations' | 'backoffice' | 'management';

export const FEATURE_CATEGORIES: Record<
  FeatureCategoryKey,
  { label: string; description: string }
> = {
  operations: {
    label: '店舗運営',
    description: '予約から会計まで、店内オペレーションを止めない機能群。',
  },
  backoffice: {
    label: 'バックオフィス',
    description: '仕入・在庫・原価・経理・労務まで、閉店後の作業をなくす機能群。',
  },
  management: {
    label: '経営',
    description: '1店舗でも多店舗でも、数字で判断するための機能群。',
  },
};

/** 主要機能ページ（専用の詳細ページを持つ） */
export interface FeaturePage {
  slug: string; // /features/{slug}
  category: FeatureCategoryKey;
  name: string;
  tagline: string;
  includes: string[];
  heroTitle: string;
  image: string;
  imageAlt: string;
  seoTitle: string;
  seoDescription: string;
}

export const FEATURE_PAGES: FeaturePage[] = [
  {
    slug: 'reservations',
    category: 'operations',
    name: '予約・フロア',
    tagline: 'Web予約から着席・テーブル割当までを1つの台帳で。',
    includes: ['オンライン予約', '予約リスト', 'カレンダー', '予約台帳', 'ウォークイン受付', 'テーブル割当・席移動', 'フロアマップ', 'キャンセル・No-show管理'],
    heroTitle: '予約から着席まで、ひとつの台帳で。',
    image: '/lp-reservations.png',
    imageAlt: 'タブレットのTENPO ONE予約台帳で当日の予約を確認する店舗スタッフ',
    seoTitle: '飲食店の予約管理・予約台帳｜TENPO ONE',
    seoDescription: 'Web予約・予約台帳・フロアマップ・ウォークイン受付を1画面に統合。予約から着席・注文まで同じデータでつながる飲食店向け予約管理。',
  },
  {
    slug: 'pos',
    category: 'operations',
    name: 'POS・会計',
    tagline: '注文から会計、レジ締めまでをひとつの流れで。',
    includes: ['商品・カテゴリ選択', '注文・追加注文', '個別会計・複数支払', '税率(10%/8%)自動判定', '返金・部分返金・取消(VOID)', 'レシート', 'レジ開局・締め', '現金差異・日報'],
    heroTitle: '注文から会計、締め作業まで。レジ業務をひとつに。',
    image: '/lp-pos-checkout.png',
    imageAlt: 'タブレットのTENPO ONE POSレジで会計するスタッフ',
    seoTitle: '飲食店向けPOSレジ・会計・レジ締め｜TENPO ONE',
    seoDescription: '注文入力から複数支払・返金・レジ締めまで対応する飲食店向けPOSレジ。売上はそのまま在庫・顧客・会計へ連動します。',
  },
  {
    slug: 'qr-kds',
    category: 'operations',
    name: 'QRオーダー・KDS',
    tagline: 'お客様のスマホ注文が、そのまま厨房まで届く。',
    includes: ['テーブルQR', 'スマホからのセルフ注文', '追加注文', '売り切れ即時反映', 'キッチンディスプレイ(KDS)', '調理中・提供待ち・提供済の管理', 'POSとの共有'],
    heroTitle: '注文はお客様から厨房まで、そのまま届く。',
    image: '/lp-qr-order.png',
    imageAlt: 'スマートフォンのQRコードからTENPO ONEでメニューを注文する来店客',
    seoTitle: '飲食店のQRオーダー・キッチンディスプレイ(KDS)｜TENPO ONE',
    seoDescription: 'テーブルのQRからお客様が注文し、そのままPOS・厨房のKDSへ。専用アプリ不要のセルフ注文と調理進捗管理を実現します。',
  },
  {
    slug: 'crm',
    category: 'operations',
    name: '顧客管理・CRM',
    tagline: '予約とPOSから、顧客データが自動で蓄積される。',
    includes: ['顧客台帳', '予約・注文履歴', '来店回数・累計利用額・客単価', 'アレルギー・接客メモ', 'タグ・セグメント', 'クーポン', 'ポイント', 'リピート分析'],
    heroTitle: '「誰が来たか」が、次の来店につながる。',
    image: '/lp-tableside-order.png',
    imageAlt: 'テーブルでTENPO ONEを使い接客するスタッフと来店客',
    seoTitle: '飲食店の顧客管理・CRM｜TENPO ONE',
    seoDescription: '予約とPOSから来店履歴・利用額・接客メモが自動で蓄積。クーポン・ポイント・リピート分析まで、飲食店の顧客管理を1つに。',
  },
  {
    slug: 'inventory',
    category: 'backoffice',
    name: '仕入・在庫・原価',
    tagline: '売れた瞬間から、在庫と原価までつながる。',
    includes: ['仕入先管理', '発注・入荷', '在庫・店舗間移動', '棚卸', '廃棄', '食材・レシピ', '理論原価・実原価・原価差異', '仕入価格履歴', '在庫不足アラート'],
    heroTitle: '売れた瞬間から、在庫と原価までつながる。',
    image: '/lp-inventory.png',
    imageAlt: 'バックヤードでタブレットのTENPO ONE在庫一覧を確認するスタッフ',
    seoTitle: '飲食店の在庫管理・原価管理・発注管理｜TENPO ONE',
    seoDescription: '仕入・発注・在庫・棚卸・レシピ原価を1つに。POSの売上から理論在庫・原価が自動更新され、原価差異まで把握できます。',
  },
  {
    slug: 'accounting',
    category: 'backoffice',
    name: '経費・会計',
    tagline: '店舗の数字が、そのまま経理につながる。',
    includes: ['レジ締め', '小口現金', '経費', '請求書・書類', '仕訳・仕訳帳', '総勘定元帳', '試算表', 'P/L・B/S', '月次締め'],
    heroTitle: '店舗の数字が、そのまま経理につながる。',
    image: '/lp-accounting.png',
    imageAlt: 'ノートPCのTENPO ONE会計画面と請求書・領収書を扱う経理担当',
    seoTitle: '飲食店の経理・売上管理・店舗会計｜TENPO ONE',
    seoDescription: 'POSの売上から仕訳・帳簿・試算表・P/L・B/Sまでを内部で作成。レジ締め・小口・経費・請求書を同じデータで管理します。',
  },
  {
    slug: 'workforce',
    category: 'backoffice',
    name: '勤怠・給与',
    tagline: '働いた時間から、給与・歩合の試算までつながる。',
    includes: ['出勤・休憩・退勤の打刻', '勤怠修正申請', 'シフト', '有給管理', '実働・残業・深夜の集計', '給与・歩合の試算', '給与明細'],
    heroTitle: '働いた時間から、給与・歩合までつながる。',
    image: '/lp-attendance.png',
    imageAlt: 'TENPO ONEで出勤打刻をするホールスタッフ',
    seoTitle: '飲食店の勤怠管理・シフト管理・給与試算｜TENPO ONE',
    seoDescription: '打刻・シフト・有給から勤怠を集計し、給与・歩合を試算。勤怠実績がそのまま給与の下地になり、再入力をなくします。',
  },
  {
    slug: 'analytics',
    category: 'management',
    name: 'レポート・分析',
    tagline: '感覚ではなく、店舗の数字で判断する。',
    includes: ['売上・粗利益・利益率', '原価率・人件費率・FL比率', '客数・客単価', '商品ランキング', 'スタッフ分析', '店舗ランキング', '前月比・前年比', '異常検知アラート', '明細ドリルダウン'],
    heroTitle: '感覚ではなく、店舗の数字で判断する。',
    image: '/lp-owner-analytics.png',
    imageAlt: 'ノートPCでTENPO ONEの売上ダッシュボードを確認するオーナー',
    seoTitle: '飲食店の経営分析・売上分析｜TENPO ONE',
    seoDescription: '売上・粗利・原価率・人件費率・FL比率・客単価を期間や店舗軸で分析。数字をクリックして明細まで掘り下げられます。',
  },
  {
    slug: 'multi-store',
    category: 'management',
    name: '本社・多店舗管理',
    tagline: '1店舗でも100店舗でも、本社から全部見える。',
    includes: ['全店舗ダッシュボード', '店舗切替・店舗比較', '店舗ランキング', 'エリア管理', 'ロール権限管理', '企業(テナント)管理', '異常検知アラート', 'CSV出力', '本社経営分析'],
    heroTitle: '1店舗でも、100店舗でも。本社から全部見える。',
    image: '/lp-analytics-team.png',
    imageAlt: 'ノートPCでTENPO ONEの全店ダッシュボードを一緒に確認する本社メンバー',
    seoTitle: '飲食店の多店舗管理・本社経営管理｜TENPO ONE',
    seoDescription: '全店舗の売上・利益・人件費・異常を本社から1画面で。店舗ごとのExcelを集める運用から、リアルタイムの多店舗管理へ。',
  },
];

export function featureBySlug(slug: string): FeaturePage | undefined {
  return FEATURE_PAGES.find((f) => f.slug === slug);
}

export function featuresByCategory(category: FeatureCategoryKey): FeaturePage[] {
  return FEATURE_PAGES.filter((f) => f.category === category);
}

/** 開発予定（ロードマップ）— 実装済みと混同しないこと */
export const ROADMAP_ITEMS = [
  { title: 'プリンターSDK連携', desc: 'レシート・キッチンプリンターとの直接連携（現状はブラウザ印刷）。' },
  { title: 'LINE連携', desc: '予約通知・来店促進のLINE公式アカウント連携。' },
  { title: '請求書OCR', desc: '請求書画像からの項目自動読み取り（結果は必ず人が確認）。' },
  { title: '外部予約サイト連携', desc: 'グルメサイト等の外部予約チャネルとの在庫・予約連携。' },
  { title: '正式な給与・税計算', desc: '社会保険・源泉徴収・年末調整を含む法定給与計算への対応（現在は試算）。' },
];

/** 導入の流れ */
export const ONBOARDING_STEPS = [
  { step: 'STEP 1', title: '相談・デモ', desc: 'お問い合わせ後、店舗の状況をお聞きし、画面を見ながらご説明します。' },
  { step: 'STEP 2', title: '店舗情報ヒアリング', desc: '店舗数・現在お使いのツール・運用フローを確認します。' },
  { step: 'STEP 3', title: '初期設定・データ登録', desc: '企業アカウントを発行し、店舗・メニュー・スタッフを登録します。' },
  { step: 'STEP 4', title: 'スタッフ操作確認', desc: 'POS・打刻・予約台帳など、現場の操作を確認します。' },
  { step: 'STEP 5', title: '利用開始', desc: '日々の運用を開始。運営チームが操作をサポートします。' },
];
