# 多要素認証（MFA）ロールアウト計画

現状: MFAは**未強制**（Supabase Auth の TOTP 機能に依存）。本書は段階導入の計画を示す。
有効化そのものはダッシュボード作業（[OWNER-ACTION-REQUIRED.md](./OWNER-ACTION-REQUIRED.md) A-3）。

## 方針
- 権限が高いロールから順に必須化する（被害の大きい経路から守る）。
- 「絶対に破られない」前提を置かず、MFAは**認証層の一枚**として位置づける
  （後段のRLS・GRANT・監査と併用）。

## ロールアウト段階
1. **CYPRESS運営（is_cypress_admin）**: 最優先で必須化。`/admin/*` は最も強い権限。
2. **org_owner / hq_admin / hq_accounting**: 企業設定・給与・機密にアクセスするため次点で必須化。
3. **area_manager / store_manager**: 任意 → 推奨 → 必須へ段階的に。
4. **一般スタッフ / アルバイト**: 任意（POS運用の現場負荷を考慮）。

## 技術メモ（実装時）
- Supabase の AAL（Authentication Assurance Level）を利用。TOTP登録済みユーザーは `aal2` を要求できる。
- 管理系ルートで**ステップアップ認証**を要求する場合、[lib/auth.ts](../../lib/auth.ts) の
  `requireCypressAdmin` 付近でセッションの AAL を確認し、`aal2` 未満なら再認証へ誘導する
  （実装は Supabase MFA 有効化後）。
- リカバリコードの発行・保管方針、紛失時の再登録フロー（本人確認）を運用手順に含める。

## 有効化前の確認
- MFA必須化はロックアウト事故につながり得る。まず運営アカウントで検証し、
  緊急時の復旧手段（[break-glass.md](./break-glass.md)）を用意してから広げる。
