# マイグレーション運用方針

TENPO ONE は GitHub → Vercel（アプリ）+ Supabase（DB migration）で更新される。
店舗営業中の更新でも壊れにくいことを最優先に、以下を厳守する。

## 大原則

1. **既存migrationファイルを書き換えない**。変更は必ず新しい連番migrationを追加する
   （00001〜は適用済み・改変するとlocal/remoteのハッシュ不整合や再現不能を招く）。
2. **前方修正（forward fix）を基本とする**。DBのrollbackは単純でない（データ損失リスク）ため、
   問題が出たら「打ち消す新しいmigration」を足す。
3. アプリの旧版が短時間残っても即エラーにならないよう、破壊的変更は分割する。

## Expand / Contract パターン

列のリネーム・削除・NOT NULL化など後方非互換な変更は、1回のデプロイで完結させない。

```
Expand   : 新列/新テーブルを追加（NULL許容）。旧も残す。アプリは両対応 or 旧のまま
  ↓ deploy（旧アプリでも動く）
Migrate  : データを新へバックフィル（別migration or バッチ）
  ↓ deploy（新アプリが新を使う）
Contract : 旧列/旧制約を削除（十分な期間後・全アプリが新版になってから）
```

例（列リネーム `foo` → `bar`）:
1. `bar` を追加（NULL可）+ `foo`→`bar` の同期トリガー or 二重書き込み
2. 既存行を `bar` にバックフィル
3. アプリを `bar` 参照へ切替してデプロイ
4. 後日 `foo` を削除

## 破壊的変更の扱い（要注意リスト）

| 操作 | リスク | 方針 |
|---|---|---|
| DROP COLUMN / TABLE | 旧アプリが即500 | Expand/Contractで分割。Contractは全アプリ更新後 |
| RENAME | 旧アプリが即500 | 新列追加→同期→切替→旧削除 |
| ADD NOT NULL | 既存NULL行で失敗 | まずDEFAULT付きで追加→バックフィル→後でNOT NULL |
| 型変更 | キャスト失敗・ロック | 新列追加方式 |
| UNIQUE 追加 | 既存重複で失敗 | 事前に重複解消migrationを別途 |
| 大テーブルへのindex | 長時間ロック | `create index concurrently`（トランザクション外）を検討 |

## 確定データの不変性（v0.4系で導入済み）

以下はDBトリガーで UPDATE/DELETE を禁止済み。migrationでこれらに触れる場合は特に慎重に:
- journal_entries / journal_entry_lines（posted/voided）— 00020/00023/00024
- refunds（作成後）— 00025
- payroll_items / payroll_runs（approved）— 00022
- stock_counts / stock_count_items（completed）— 00028
- legal_rule_versions（active後のparameters）— 00022

## migration失敗時の手順

1. `npx supabase migration list` で local/remote の乖離を確認（どこまで適用されたか）。
2. 途中失敗したmigrationは**部分適用**の可能性がある → 該当migrationを冪等に書き直すのではなく、
   状態を確認し、不足分だけを行う**新しいmigration**で前進修正する。
3. トランザクション内で完結するDDLは自動ロールバックされる（PostgreSQLのDDLはトランザクショナル）。
   複数ステートメントは1ファイル=1トランザクションであることを利用し、途中失敗なら全ロールバック。
4. どうしても戻す必要がある場合のみ、打ち消しmigrationを追加（DROP追加分 等）。手動でremoteを
   いじらない（次回のlist不整合の原因になる）。

## デプロイ順序

- **原則: DB migration を先、アプリを後**（Expandパターンなら旧アプリが新DBで動くため安全）。
- Contract（削除）を含むデプロイは、アプリ側が旧列を参照しなくなったことを確認してから。

## チェック（デプロイ前）

- [ ] 新規migrationのみ追加（既存改変なし）を `git diff` で確認
- [ ] ローカル/テストDBで `supabase db push` が通る
- [ ] `supabase migration list` で local=remote
- [ ] 破壊的変更が含まれる場合、Expand/Contractに分割済み
- [ ] `lib/database.types.ts` を再生成（`gen types typescript --linked`）
- [ ] 型・ビルドが通る（旧アプリ互換の確認）

関連: docs/release-strategy.md / docs/disaster-recovery.md
