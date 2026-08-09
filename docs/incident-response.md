# インシデント対応

## 深刻度（severity）

| Sev | 定義 | 例 | 初動目標 |
|---|---|---|---|
| SEV1 | 全社/全店の業務停止・データ損失・情報漏えい | DB全断・service role漏えい・会計データ消失 | 即時 |
| SEV2 | 単一企業/店舗の業務停止・重要機能不全 | 特定店のPOS会計不可・返金不可 | 30分以内 |
| SEV3 | 業務継続可能な不具合・軽微なデータ不整合 | レポート数値ずれ・画面崩れ | 当営業日中 |
| SEV4 | 軽微・回避策あり | 表示文言・非クリティカルなUI | 通常対応 |

## フロー

1. **検知**: ユーザー報告（エラーID付き）/ CYPRESS System画面 / system_errors の急増。
2. **記録**: 発生時刻・症状・影響範囲・エラーID・request_id を記録。
3. **分類**: severity判定。SEV1/2は担当者を割り当て。
4. **封じ込め**: 被害拡大を止める（機能フラグOFF・デプロイrollback・鍵無効化 等）。
5. **復旧**: docs/disaster-recovery.md のケース別手順。
6. **検証**: `scripts/audit-data-integrity.mjs --strict` と該当業務の動作確認。
7. **事後（postmortem）**: 原因・時系列・恒久対策を記録。再発防止をコード/手順へ反映。

## 調査に使う情報源

- **エラーID**: ユーザー提示の`ERR-XXXXXX`で system_errors / Vercelログ（構造化JSON）を検索。
- **audit_logs**: 誰が・いつ・何を変更したか（返金・締め・権限変更・仕訳修正等）。
- **system_errors**: アプリ例外（PII/秘密値は含まない設計）。CYPRESS運営のみ閲覧。
- **/api/health**: app/db/authの状態。
- **CYPRESS System画面**: バージョン・migration・テナント/店舗/ユーザー数・最近のエラー。

## 情報漏えい時の追加対応

- 影響を受けた可能性のあるデータ種別（個人情報/給与/経営）を特定。
- service role漏えいは全テナント影響の前提で調査（RLSバイパス可能なため）。
- 法令上の通知義務の要否は専門家確認（**BLOCKED E**: 法的判断は行わない）。

## エスカレーション

- SEV1/2 かつ本番設定・鍵・外部サービスに関わる対応 → 人間（運用責任者）の承認必須。
- コードで前進修正できるものはforward fixで対応（docs/migration-policy.md）。

関連: docs/disaster-recovery.md / docs/observability.md / docs/production-runbook.md
