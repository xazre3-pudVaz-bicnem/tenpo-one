# TENPO ONE セキュリティ文書（Security Fortress）

TENPO ONE の防御は **多層防御（Defense in Depth）** を基本方針とする。
Prevent（予防）→ Detect（検知）→ Contain（封じ込め）→ Audit（監査）→ Recover（復旧）。
「絶対安全」を前提にせず、1層が破られても次で守る。**CRITICAL=0・HIGH=0** を維持する。

## まず読むもの
- 📄 [security-fortress-report.md](./security-fortress-report.md) — 要塞化の結論・是正した脆弱性・残存リスク・検証結果
- 🔧 [OWNER-ACTION-REQUIRED.md](./OWNER-ACTION-REQUIRED.md) — **コードで完結しない**手動設定（Supabase/Vercel/GitHub）。
  未完了の間は当該防御は無効。エンジニア以外でも実施できる手順。

## 設計・監査
- [threat-model.md](./threat-model.md) — 資産・攻撃者・信頼境界・多層防御マップ
- [asvs-audit.md](./asvs-audit.md) — OWASP ASVS L2/L3 チェックリスト対応
- [database-grants.md](./database-grants.md) — GRANT/REVOKE 設計とPostgresの落とし穴（PUBLIC継承・DEFINER・列GRANT）
- [csp.md](./csp.md) — CSP・セキュリティヘッダと nonce 化計画

## 運用
- [incident-response.md](./incident-response.md) — インシデント対応（SEV1-3・ケース別）
- [break-glass.md](./break-glass.md) — バックドアを作らない緊急アクセス手順
- [secret-rotation.md](./secret-rotation.md) — 鍵・シークレットのローテーション
- [mfa-rollout.md](./mfa-rollout.md) — MFA段階導入計画
- [penetration-test-plan.md](./penetration-test-plan.md) — 認可されたテストの範囲・手順（本番/実データ/第三者禁止）
- [security-release-checklist.md](./security-release-checklist.md) — リリース前セキュリティ確認

## 関連（既存の全体ドキュメント）
機密・分離・保存の詳細はプロジェクト全体ドキュメントも参照（重複を避けクロスリファレンス）:
- [../security.md](../security.md) / [../security-design.md](../security-design.md)
- [../tenant-isolation.md](../tenant-isolation.md) / [../tenant-security.md](../tenant-security.md)
- [../storage-security.md](../storage-security.md)
- [../permissions-matrix.md](../permissions-matrix.md) / [../permissions.md](../permissions.md)
- [../observability.md](../observability.md) / [../data-retention.md](../data-retention.md) / [../privacy-operations.md](../privacy-operations.md)
- [../disaster-recovery.md](../disaster-recovery.md) / [../resilience.md](../resilience.md)

## 検証コマンド
```bash
npx tsc --noEmit
npx vitest run tests/security/                                  # 24 ユニット（redirect/csv/error/authz）
node --env-file=.env.local scripts/verify-security.mjs          # 45 ライブ（IDOR/権限/RPC境界 ほか）
node --env-file=.env.local scripts/verify-security-fortress.mjs # 14 ライブ（PUBLIC剥奪/pin_code/機密分離/不変性）
```

## 監視
- 運営セキュリティダッシュボード: [/admin/security](../../app/admin/security/page.tsx)（CYPRESS限定）
  — セキュリティ関連エラー・高額返金・権限/機密操作の監査・直近サインイン。

## 変更時の鉄則
1. 既存マイグレーションは書き換えず**新規追加**。
2. 関数を再定義したら**REVOKE/GRANTを再適用**（[database-grants.md](./database-grants.md)）。
3. クライアント入力（org/store/role/price/amount/approved_by/admin）は**信用しない**。
4. ダッシュボード設定が必要な対策を「実装済み」と報告しない。
5. バックドアを作らない（秘密URLでの昇格等は禁止）。
