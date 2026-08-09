# 災害復旧 Runbook（ケース別手順）

各ケースで「まず確認 → 封じ込め → 復旧 → 事後」の順に行う。
本番データの物理削除・秘密鍵rotation・破壊的操作は人間の承認を得てから実行する。

## 共通の初動

1. 影響範囲の特定: 全企業か単一企業か、単一店舗か。`/api/health` と CYPRESS の System 画面を確認。
2. 記録開始: 発生時刻・症状・エラーID（あれば）をインシデント記録へ（docs/incident-response.md）。
3. 顧客影響があれば店舗へ連絡（営業中は特に）。

---

## ケース1: データ誤削除

- **確定データ（会計/勤怠/仕訳/給与/締め）**: 物理削除はトリガーで禁止済み。もし消えている場合は
  トリガー迂回（service role直叩き等）が疑われる → まず該当操作の audit_logs / system_errors を確認。
- **論理削除（status='deleted'等）**: audit_logsで操作者・時刻を特定 → statusを戻すSQL（最小範囲）。
- 広範囲削除で論理復旧が困難: Supabase PITRで削除直前へ復元（下記ケース4の手順）。
- 事後: 誤削除を許した操作経路をふさぐ（権限・確認ダイアログ）。

## ケース2: 誤ったmigration適用

1. `npx supabase migration list` で local/remote の乖離を確認。
2. DDLはトランザクショナル: 単一migrationの途中失敗は自動ロールバックされる（部分適用なし）。
3. 適用され切ったが誤り: **打ち消す新しいmigration**を追加（forward fix。既存改変・手動remote操作はしない）。
4. データ破損を伴う場合: PITRで適用直前へ復元（ケース4）。
5. 事後: docs/migration-policy.md のExpand/Contract・チェックリスト遵守を再確認。

## ケース3: アプリ更新失敗（Vercelデプロイ）

1. Vercelダッシュボードで直前の正常デプロイを確認。
2. **Instant Rollback**（Vercelの previous deployment へ切替）で即時復旧。
3. DBが新migrationに進んでいてアプリだけ戻す場合: Expandパターンならば旧アプリでも動作するはず
   （docs/migration-policy.md）。動かない場合はDB側もforward fixを検討。
4. 原因（ビルド/型/env）を特定して再デプロイ。

## ケース4: DB障害（Supabase）

1. `/api/health` の db 状態、Supabaseステータスページを確認。
2. 一時障害: アプリは timeout + エラーID表示で degrade（PHASE2の障害耐性）。復旧を待つ。
3. データ損失を伴う障害: Supabaseダッシュボードで PITR/バックアップ復元（人間が実行）。
   - 復元ポイントを決定（RPO目標 ≤5分）→ 復元 → `scripts/audit-data-integrity.mjs --strict` で検証。
4. 復旧後、未締めレジ・未確定仕訳など中断状態を CYPRESS/店舗で確認。

## ケース5: Storage障害

1. 画像・書類の表示不可。会計等のコア業務は継続可能（Storageは補助）。
2. アップロードは失敗時にエラーID表示（PHASE2）。復旧後に再アップロード。
3. データ損失時: バケットバックアップから復元（BLOCKED B: 本番バックアップ設定に依存）。

## ケース6: 認証障害（Supabase Auth）

1. ログイン不可 → Supabase Authステータス確認。
2. 既存セッションは短時間有効な場合がある（営業中の店舗は継続できる可能性）。
3. Site URL / Redirect URL 設定ミスが原因なら設定修正（docs/deployment.md）。
4. 復旧まで新規ログインは不可。店舗には既存端末のセッション維持を案内。

## ケース7: 秘密鍵漏えい（SUPABASE_SERVICE_ROLE_KEY 等）

> 実際のrotationは人間が承認のうえ実施（本フェーズでは実行しない = BLOCKED）。

1. **封じ込め**: 漏えいした鍵の無効化・rotationをSupabaseダッシュボードで実施。
2. Vercel/ローカルの環境変数を新鍵へ更新し再デプロイ。
3. 影響調査: system_errors / audit_logs で不審アクセスを確認。
4. anon/publishable鍵の場合はRLSが最終防御（RLSが正しければ影響限定的）。service role漏えいは重大
   （RLSバイパス可能）→ 全テナントのデータアクセス痕跡を精査。
5. 事後: 鍵の保管方法見直し、Gitヒストリ混入がないか再監査。

---

## 復旧後の必須チェック

```bash
node --env-file=.env.local scripts/audit-data-integrity.mjs --strict
node --env-file=.env.local scripts/verify-flow.mjs
```
- 未締めレジ・未確定仕訳・整合性エラーの有無を確認し、あれば正規操作（修正仕訳・締め）で解消。

関連: docs/backup-restore.md / docs/incident-response.md / docs/migration-policy.md / docs/release-strategy.md
