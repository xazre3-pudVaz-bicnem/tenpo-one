# データベース設計（→ 移動）

本ファイルの内容は `docs/database.md` に統合・最新化した。以後はそちらを参照すること。

- Migration一覧（00001〜00014）の要約
- テーブル群のER的説明・命名規約・主要インデックス
- `finalize_order()` 等の集計・連動の実装

正式なスキーマ定義は常に `supabase/migrations/*.sql` が唯一のソース。
