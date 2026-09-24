# D&DREAM レジ — 引き継ぎ仕様書（v32）

このチャットで作った「D&DREAM レジ」モック（単一HTMLファイル）の全内容。別チャットで既存のレジと**結合・レイアウト変更**するための資料です。

- 公開アーティファクト: https://claude.ai/artifact/CRakPmzFsXDVLYMgBtcFGv （Version 32）
  - 別チャットで **このURLを貼って「このアーティファクトを読んで」** と言えばソースをそのまま読み込めます（republish もURL指定で可能）。
- 同梱ファイル: `DD-REGI_v32.html` = 完全な単体HTML（doctype付き。ローカルで開けば動く）
- 構成: 1ファイル / `<title>`+`<style>` → マークアップ → `<script src=qrcodejs(cdnjs)>` → メインJS（IIFE, ES5, フレームワーク無し）。データはすべてメモリ内（リロードで初期化）。

---

## 1. 設計方針・決定事項（ユーザー確定）

| 項目 | 決定 |
|---|---|
| ベース | レジ側 = USENレジ FOOD の画面構成、店舗台帳 = レストランボード、テーブル一覧 = funfo（コンパクトカード）、dinii = 顧客名＋来店回数 |
| 配色 | 紫パレット（下記トークン）。金額アクセントはサフラン |
| ラベル | 日本語 ＋ 小さな英語サブラベル（`.en-inline` / `<small class="en">`） |
| サイドバー | 常に固定幅 196px（ラベル付き slim）。順序: オーダー・会計 / 店舗台帳（タイル）→ ホーム / 即会計 / 伝票明細 / 入出金 / **仕入・経費** / ドロアオープン / 在庫設定 / レジクローズ / **スキャン** / 設定 / アラート |
| ホーム | iPad 1画面: お知らせ（本部・AI検知・**今日のやること**）/ 予算達成率（実績売上高 Sales・予算売上高 Target）/ 時計カード（TAKADANOBABA, TOKYO）/ 統計ストリップ |
| 自動ホーム復帰 | ログイン後・会計後・無操作（設定で変更可） |
| 日次と月次の分離 | **日次（レジ現金）= 入出金 → レジクローズ精算**。**月次（掛け・振込・本部払い）= 仕入・経費 → 月次決算**。日次精算に月次分は絶対に混ぜない |
| スキャン | サイドバー「スキャン」= 入口、その中の「レシートボックス」= 履歴。支払方法で自動振り分け（レジ現金→入出金 / 本部現金・カード・掛け→月次） |
| 会計ソフト | 本部管理画面（このアプリ）が正 ＋ Money Forward / freee へ仕訳送信（切替可、既定 MF）。日次入出金は送信対象外 |
| 支払フロー | 本部でも店舗でも「支払済」にした瞬間に未払から自動涛算。承認ステップ無し |
| 納品書 | 毎日登録 → 月末の請求書と自動照合（差額はアラート） |
| 後回し | 請求書メール取り込み、MF銀行明細での自動消込（構想のみ） |

## 2. デザイントークン

```css
--plum:#241436; --royal:#5B2C8F; --iris:#7B3FE4; --iris-soft:#E9E0FA; --wisteria:#C9B8EA;
--lilac:#EFEAF8; --lilac-soft:#F6F3FB; --line:#E3DBF1; --card:#fff;
--ink / --ink-2 / --ink-3 (本文 3段階); --saffron:#BD660F (金額); --saffron-soft;
--gold; --good:#1E8F62 / --good-soft; --alert:#B3341F / --alert-soft;
fonts: Noto Sans JP (UI), Manrope (数字, tabular-nums) — Google Fonts
```
主要状態色: 着席中=iris-soft / 注文済=iris / L.O.済=#F7C948（黄）/ 時間超過=alert（赤）/ 会計待ち=saffron（橙）/ 空席=破線wisteria。

## 3. 画面一覧（`data-screen` と描画関数）

| screen | 内容 | 主関数 |
|---|---|---|
| home | お知らせ・今日のやること・予算・時計・統計 | renderHome, renderTodo |
| order (view: tables/cust/entry/pay) | テーブル一覧（30卓・4列・funfo風カード）→ お客様情報 → 注文 → 会計 | renderOrderTables, tableTile, openCustForm, renderCart, renderPay |
| quick | 即会計 | showOrderView('entry') |
| reservations (tabs) | 店舗台帳: テーブル管理 / 予約リスト / スケジュール / **月間** / 顧客台帳 / グルメサイト / 集計分析 / 台帳設定 | renderResv, renderBoard, renderMonth, renderFloor, renderRvList, renderCustomers, renderSites, renderRbAna, renderLedgerSettings |
| slips | 伝票明細 | renderSlips |
| cash | 入出金（📷レシートで出金登録、仮払い、履歴＋レシート列） | renderCash, settleAdvance, attachReceipt |
| bills (tabs) | 仕入・経費: 未払・支払 / 納品書 / 月次決算 / 取引先 | renderBills, renderPayables, renderDeliveries, renderMonthClose, renderVendors, payBill, billForm, delivForm, vendorForm, closeMonth, mfExport |
| scan | スキャン（撮影・デモ・結果カード）＋ レシートボックス | renderScan, processScan, autoFix, registerScan, scanDetail, scanEdit, fileScan |
| stock | 在庫設定 | renderStock |
| close | レジクローズ（売上・**出金レシートチェック**・支払方法別・現金実査） | renderClose, closeReport |
| settings | 設定（セクション: 店舗 / デバイス管理 / 予約・顧客 / 会計 / 本部・システム） | renderSettings ＋ 各射用レンダラ |
| analytics | 売上分析 | renderSalesAna |
| alerts | アラート一覧 | collectAlerts, renderAlerts |

ルーティング: `go(name)`（hash `#name`）, `TITLES`/`TITLES_EN`, `updateChrome()`（戻るボタン文言）, `state.view`（order内）, `state.rvView`（台帳タブ）, `state.blTab`（仕入・経費タブ）, `state.setKey`（設定項目）。

### 3.1 テーブル一覧カード（funfo風）
`tableTile(t, withAmt)` — 行: `T-番号`(連結時 `T-2&4` / `T-2+2卓`) ＋ 人数 / ⏱経過分 ＋ 来店回数chip（新規chip）/ 飲放・時間制 残り分 / 顧客名 ＋ dimの予約経路（Pt・クーポン）/ 次の予約（1行, 赤）/ 金額行（状態ラベル・¥合計・¥/人、色ブロック無し）/ **下端 6px の残り時間ライン**（紫→L.O.で黄→超過で赤、会計待ち橙）。`tileStatus(t)`: free/resv/pay/over/lo/ordered/seated。1分ごとに `t.min++`/`t.plan--`（setInterval）。

### 3.2 テーブル連結・貸切
- `t.link = 親ID` で子卓を表現。`linkedOf(id)`, `primaryOf(t)`, `linkLabel(t)`, `tableCap(t)`, `clearTable(t)`（親＋子を空席化）。
- 注文画面「連結」ボタン（`#oe-link`）: 複数選択・貸切（全卓）・空席のみ・解除。使用中卓を選ぶと注文・人数を合流。
- 予約登録ウィザード step2 に「貸切（空いている全卓を連結）」。`r.charter`。
- 子卓タップ → 親の伝票を開く。会計完了で全卓空席。

### 3.3 スケジュール（レストランボード風）
- 30分スロット、現在時刻ライン（30秒更新、デモ時刻ボタン）。
- **予約バーのドラッグ**: 横＝時間変更（15分単位）、縦＝テーブル変更（`.b-row[data-t]`）。pointer events, `applyResvMove(rv,newT,newTbl)`（空き検証 `freeTablesAt`、来店済みは席移動のみ `transferTable`）。
- 予約詳細モーダルに「時間・テーブルを変更」セレクト。
- 月間タブ `renderMonth`（日別 組数/名数、ネット比率バー、貸切、今日枠、日タップで詳細）。

### 3.4 印刷・PDF
`printReport(kind,o)` → プレビューモーダル → `window.print()`（`#print-area` のみ印刷、`@media print`）。kinds: day / schedule / month / customers / bills / monthclose。

## 4. データモデル（JS 配列、そのまま DB テーブル設計に流用可）

```
TABLES  {id, status:'free|busy|pay', guests, min, plan(残分), cust:{name,visits}, info:{male,female,age,type,scene,mode,timed,limit,warnmin,start}, resv, link}
CAP     {tableId: 席数}
ORDERS  {tableId: [ {name, price, qty, sent, opts:[...], fromResv} ]}
RESV    {t:'19:00', name, n, kids, tbl:'T-1 + T-2', src, st:'wait|in|out|unconfirmed|tentative|cancelled|noshow', dur, course, memo, tel, kana, prepaid, points, coupon:{name,value}, charter, paid, reason}
CUSTOMERS {name, visits, last, tel, line, note, hist:[[date,'4名',amt]], points}
SLIPS   {no, tbl, start, end, n, pay, amt, st:'paid|open', age, male, female, src, items, discount, cust}
CASH    {t, kind:'in|out', reason, memo, amt, by, scan(スキャンid), adv, id, receipts[], settled, retOf}
STOCK   {name, cat, qty, th, unit, manual}
SITES   {id, cat:'gourmet|web|other|delivery', name, short, src, via:'API|メール取り込み', on, login, month, stock, sync, fee, f:{resv,stock,perks,prepaid,msg}}
        → SRC_CLASS / SRC_SHORT / NET_SRC は SITES から生成
MESSAGES {t, site, kind, who, st, name}
COURSES, LEDGER{rangeStart,rangeEnd,hold,warn,web,sameDay,slot}, GOAL, BUDGET, STAFF
DEVICES(プリンター・決済端末・周辺機器・ネットワーク), HANDIES, MO(モバイルオーダー設定), ORDER_BASE
VENDORS {id, name, cat:'酒|食材|通信|光熱|家賃|消耗品|その他', kind:'仕入|経費', close, pay, method, payer:'本部|店舗', bank, tno(インボイス), auto, amount, tel}
BILLS   {id, vendor, month:'2026-08', date, due, amount, tax:8|10, method, st:'unpaid|paid', paidAt, paidBy, paidMethod, synced, file, memo}
DELIV   {id, vendor, date, amount, items, file, stock}
MONTHS  {'2026-08':{status:'open|closed', closedAt, sent, sales, labor}}
ACCT    {soft:'Money Forward クラウド会計|freee会計', on, auto, instant, last, map:{カテゴリ→勘定科目}}
SCANS   {id, t, kind:'invoice|deliv|receipt', store, date, amount, amount0(修正前), tax:{8:..,10:..}, items:[[名,金額,'x'=除外]], pay, st:'auto|fixed|check|excluded', fixes[], flags[], link, img(dataURL), conf, mf, tno, due}
PAY_MEMORY {店名: 支払方法}   STORE_AREA ['高田馬場','新大久保']   RULES {drink[], food[], personal[]}
HQ_STORES（本部ビュー用の他店舗モック）
```

## 5. 主要フロー

1. **予約→来店→会計**: RESV(wait) → arrive(r): 卓を busy、子卓は link、コースを注文に投入 → 注文 → 会計（`resvDeductions`: 事前決済・ポイント・クーポンを自動差引 = 自動取り込み）→ SLIPS 追加、顧客 visits++、r.st='out'、`clearTable`。
2. **スキャン**（`processScan(x, ctx)`）: 読み取り(0.9s) → レシートなら支払方法決定（ctx.pay 固定 / PAY_MEMORY / 3ボタンで質問し記憶）→ `autoFix`（重複・店外ドリンク/フード/私物の除外と合計修正・8/10%分割・明細≠合計・日付ズレ→記載月・エリア外→要確認・勘定科目自動）→ `registerScan`（請求書→BILLS未払 / 納品書→DELIV / レシート: レジ現金→CASH出金＋BILLS(paid) / 本部現金・カード→BILLS(paid)のみ / ctx.adv→仮払いに紐付け / ctx.existing→既存出金に添付）→ 結果カード表示。`st==='check'` は未登録のまま承認待ち。
3. **仮払い→精算**: 「買い物に持ち出し」= CASH out(adv) → 戻ったらレシート撮影（複数可、advに紐付け）→ 「精算完了」= お釣り戻し CASH in（不足なら追加出金）→ 差額 ¥0。
4. **レジクローズ**: 売上・支払方法別・現金実査に加え「本日の出金レシート」（経費出金と仮払いの一覧、未スキャン/未精算は赤＋ボタン）。未スキャンがあれば精算レポートに警告。
5. **月次**: 請求書登録（AI読み取り、納品書照合）→ 未払一覧・支払予定 → 支払済（本部/店舗、方法; レジ現金なら入出金にも）→ 月次決算（売上=レジ自動、仕入=酒/食材、経費=科目別、人件費、粗利・営業利益・原価率・FL比率・前月比、仕訳プレビュー）→ 月次締め（ロック、仕訳送信）→ **MF取込ファイル**（仕訳帳インポートCSV: 取引日/借方科目/補助/税区分/金額/貸方科目/補助/金額/摘要/部門。`downloads` capability で保存、API送信ボタン）。
6. **アラート/今日のやること**: `collectAlerts`（在庫・AI会計チェック・現金差額・予約・タイマー・メッセージ・デバイス・支払期日・差額・要確認レシート・月次締め）と `todoItems`（ホームのチップ、タップで該当画面へ）。
7. **本部 全店舗ビュー**（設定 › 本部）: 店舗ごとの本日売上・現金差額・未スキャン・仮払い未精算・要確認・未払・クローズ状態。

## 6. 設定（SETTINGS 配列）
店舗情報 / メニュー編集（価格・売切→注文画面即反映）/ 帳票管理・分析 / **デバイス管理**: ハードウェア（プリンター・決済端末・周辺機器・ネットワーク, funfo風）・テーブルQRコード（卓ごとQR, 注文設定）・ハンディ ログインQR（5分期限） / テーブル・フロア / スタッフ・権限 / **グルメサイト連携**（日本の全チャネル: HP・食べログ・ぐるなび・Retty・一休・OZmall・ヒトサラ・PayPayグルメ・Google・LINE・Instagram・自社(TableCheck)・AutoReserve・SAVOR JAPAN・TableCheck・Uber Eats・出前館・Wolt。連携ON/OFF・設定・在庫同期）/ 予約受付ルール / 在庫連携 / 会計・税率 / レシート設定 / **会計ソフト連携**（MF/freee, 即時/月次送信, 勘定科目マッピング, 取込形式）/ **本部 全店舗ビュー** / 本部連携・AI / ホーム画面（自動復帰）/ 練習モード / 担当者・ログアウト。

## 7. モックである部分（本番で置き換えるもの）
- 永続化なし（メモリ）。複数端末同期なし → DB（Supabase等）＋ realtime。
- AI読み取りはサンプル値（実ファイルは画像表示＋手入力確認）→ OCR API。
- プリンター/ドロア/決済端末/ハンディ/QR注文は表示のみ） → ePOS/WebPRNT, 決済API。
- グルメサイト・MF/freee・本部は状態表示とトースト → メール取り込み/各API。
- `window.print()` はビューアで動かない場合あり。CSVは `claude.use('downloads')` 経由（アーティファクト内）、それ以外は Blob ダウンロード。

## 8. 別チャットで結合するときのヒント
- ソース取得: アーティファクトURLを貼る（読み込み可）か、`DD-REGI_v32.html` を添付。
- CSSクラスは衝突しやすいものを既に分離済み: `.tbl`(卓カード) / `#order-pay`(会計) / `.tkpi` / `.pkpi`(印刷) / `.mc-sum`,`.mc-total`(月次表) / `.akv`(仮払い) / `.qc`(予約変更)。既存レジと混ぜる際は接頭辞を付けると安全。
- 画面追加の型: `<section class="screen" data-screen="xxx">` ＋ サイドバー `data-go="xxx"` ＋ `TITLES/TITLES_EN` ＋ `go()` 内で `renderXxx()`。
- 検証用: Playwright で `pageerror` を拾う walkthrough を回していた（walk4.js 等）。`node --check` でメインJSの構文確認。
