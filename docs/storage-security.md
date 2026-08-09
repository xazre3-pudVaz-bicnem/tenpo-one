# ストレージ・セキュリティ

Supabase Storage を使う。バケットとRLSでテナント境界を強制する。

## バケット構成

| バケット | 公開 | 用途 | サイズ上限 | 許可MIME |
|---|---|---|---|---|
| documents | **非公開** | 請求書・領収書・書類（機密） | 20MB | pdf / png / jpeg / webp |
| menu-images | 公開 | 商品画像（QRメニュー・POS表示） | 5MB | png / jpeg / webp |

## パス設計とRLS（migration 00003 / 00016）

- オブジェクトパスの**第1階層 = organization_id**（`storage.foldername(name)[1]`）。
- **documents（非公開）**:
  - select: cypress運営 or `app_is_org_member(folder[1])` — **自企業のフォルダのみ閲覧可**。
  - insert: 書込ロール（org_owner〜assistant_manager）かつ自企業フォルダ。
  - delete: 上位経理ロール（org_owner/hq_admin/hq_accounting）のみ。
  - 非公開バケットなので**アクセスは常にRLS越し**。他企業ファイルはパス/URL推測でも取得不可。
- **menu-images（公開）**: 読み取りは公開（QR/POSで表示するため）。書込・削除は自企業の管理ロールのみ。
  公開バケットに機密を置かない運用（商品画像専用）。

## 署名付きURL（signed URL）

- 非公開のdocumentsは署名付きURL（有効期限付き）で配信する。URL自体が漏れても期限切れで無効化。
- 公開バケット（menu-images）は公開URLで可（機密でないため）。

## アップロード検証（サーバー側・多層）

1. バケットの `allowed_mime_types` / `file_size_limit`（Storage側）。
2. アプリのアップロードアクションで MIME・拡張子・サイズ・ファイル名（path traversal: `..`/絶対パス/制御文字）を検証。
3. documents.file_path（メタ）が organization_id プレフィックスで始まることをサーバー検証（クライアント供給を信用しない）。
4. 危険拡張子（実行可能形式）は許可MIMEのホワイトリストで排除。

## 越境防止の確認

- 他企業の organization_id フォルダ配下のオブジェクトを select → RLSで拒否（非公開バケット）。
- documents.file_path をクライアントで別orgに偽装 → アプリ検証 + Storage RLS の二重で拒否。

## 障害・バックアップ

- Storage障害時もコア会計業務は継続可能（画像・書類は補助）。復旧は docs/disaster-recovery.md ケース5。
- Storageバックアップの有無・方式は本番設定で確認（**BLOCKED B**）。

関連: docs/security.md / docs/tenant-security.md / docs/privacy-operations.md
