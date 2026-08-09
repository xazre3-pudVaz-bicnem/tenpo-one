# セキュリティ設計

TENPO ONE は商用マルチテナントSaaS。防御は多層（Permission Gate → Server Action → RPC → RLS）で、
**フロントのcan()だけに依存しない**。最終防御は常にDB（RLS + SECURITY DEFINER RPC）。

## 認可の4層

1. **UI**: lib/permissions.ts の can(role, action) で表示制御（利便性。防御ではない）。
2. **Server Action**: requirePermission/requireMember でロール・所属を検証。
3. **RPC（SECURITY DEFINER）**: anon経路・トランザクション処理。内部で app_has_store_access 等を再検証。
4. **RLS**: 全テーブルで organization_id / store_id 境界を強制。`format()` の `%I` + ハードコードrole配列で
   生成しSQLインジェクション不可。

## 権限昇格の防御（v0.5.0で強化・migration 00031）

セキュリティ監査で発見した3つのCRITICALを封鎖:

- **C1（自己スーパー管理者昇格）**: profiles の自己更新で is_cypress_admin / status / pin_code を
  書き換える攻撃を BEFORE UPDATE トリガーで拒否。正規フロー（service role・auth.uid()=null）は通す。
- **C2（自己org_owner昇格）**: memberships / membership_stores の書込RLSを org_owner / hq_admin のみに厳格化。
  加えて自分自身のmembershipのrole/status変更をトリガーで拒否。
- **アプリ層 role ceiling（C3）**: 招待・role変更で caller のロールを超える付与を拒否（canAssignRole）。
  store/area manager がHQロールを作れない。招待時に平文パスワードを扱わない。
- **M2（監査ログ汚染）**: log_audit が p_org のアクティブメンバー資格を検証。他orgへの記録を無視。

## Service Role 鍵

- `lib/supabase/admin.ts` は `import 'server-only'`。クライアント・NEXT_PUBLIC・HTML・response・ログに出さない。
- createAdminClient()（RLSバイパス）の全使用箇所は、直前で requirePermission / 所有権チェックを行う
  （セキュリティ監査で全11系統を確認・C3/H2で不足を補修）。

## Session / 失効

- lib/auth.ts はリクエスト毎に profile.status / membership.status を再読込。suspended は即サインアウト、
  membership が active でなければアクセス不可。role変更・所属変更は次リクエストで反映。
- organizations.status（suspended/cancelled/pending_deletion）でのログイン遮断（データ保護・privacy-operations）。

## Rate Limit（v0.5.0で適用拡大）

- lib/rate-limit.ts は RateLimiter interface（将来Redis差し替え可）。公開・認証面へ適用:
  公開予約・予約決済チェックアウト・予約状態照会（enumeration防止）・QR注文（DB側5/min/table）・
  PIN打刻（ブルートフォース制限）・アップロード。
- **多インスタンス注意**: 現状のin-memory実装はVercelサーバーレスで不完全。本番では共有ストア（Redis/Upstash）
  へ差し替える（**BLOCKED D**: 外部サービス）。ログインはSupabase Auth側の制限に依存。

## XSS / インジェクション

- dangerouslySetInnerHTML は JSON-LD（静的サイトデータ）の1箇所のみ。ユーザー入力は React が自動エスケープ。
- SQLは全てパラメータ化（Supabaseクライアント / RPC引数）。DB関数の動的SQLは `%I`/`%L`。文字列連結SQLなし。

## PIN（v0.5.0で強化）

- 店舗共用端末の打刻PINをハッシュ化して保存（Node標準crypto・per-userソルト）。平文保存を廃止。
- 既存平文PINは後方互換で照合し、次回設定時に自動移行。打刻はレート制限でブルートフォース対策。

## File / Storage

- アップロードはサーバー側で MIME・拡張子・サイズ・ファイル名（path traversal）を検証。
- Supabase Storage はフォルダ第1階層=organization_id のRLSで境界を強制（他企業ファイルはURL推測でも取得不可）。
- documents.file_path はクライアント供給を organization_id プレフィックスで検証（二重防御）。

## Security Headers（next.config.ts）

- X-Content-Type-Options: nosniff / Referrer-Policy / X-Frame-Options: SAMEORIGIN / Permissions-Policy。
- **CSP**（v0.5.0で強化）: default-src 'self' 基盤 + base-uri 'none' + object-src 'none' + frame-ancestors 'self' +
  img-src/connect-src に Supabaseホスト。開発環境は緩めて開発を壊さない。
- HSTS は本番（HTTPS）のみ。

## 検証

- `scripts/verify-security.mjs`: PostgREST直叩き攻撃の再現（IDOR・権限昇格・給与アクセス・RPC直叩き・log_audit汚染）。
- `e2e/security-idor.spec.ts`: URL直接入力での越境アクセス。
- CI/リリース前に全GREENを必須とする。

関連: docs/tenant-security.md / docs/storage-security.md / docs/privacy-operations.md
