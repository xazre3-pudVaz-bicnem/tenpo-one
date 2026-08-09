-- =============================================================
-- v0.5.0 PRODUCTION READINESS
-- 1) システムエラーログ（監査ログと分離・エラーID追跡・CYPRESS運営のみ閲覧）
-- 2) テナントオフボーディング: organizations.status に pending_deletion を追加
-- 3) 顧客匿名化の受け皿（customers.anonymized_at）
-- =============================================================

-- -------------------------------------------------------------
-- 1) system_errors（構造化エラーログ。個人情報・秘密値は書かない運用）
-- -------------------------------------------------------------
create table if not exists public.system_errors (
  id uuid primary key default gen_random_uuid(),
  error_id text not null,             -- ユーザーへ表示する短ID（例: ERR-A1B2C3）
  request_id text,
  organization_id uuid,
  store_id uuid,
  user_id uuid,
  route text,
  severity text not null default 'error' check (severity in ('warning','error','critical')),
  message text not null,              -- 例外メッセージ（PII/秘密値を含めない）
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_system_errors_created on public.system_errors(created_at desc);
create index if not exists idx_system_errors_error_id on public.system_errors(error_id);

alter table public.system_errors enable row level security;
-- 閲覧はCYPRESS運営のみ。書込はSECURITY DEFINER RPC経由のみ（直接insertポリシーなし）
create policy system_errors_select on public.system_errors for select
  using (public.app_is_cypress_admin());

create or replace function public.log_system_error(
  p_error_id text, p_request_id text, p_org uuid, p_store uuid,
  p_route text, p_severity text, p_message text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  -- 認証済みユーザーからのみ受け付ける（匿名経路はサーバー側からservice roleで記録）
  if auth.uid() is null then return; end if;
  insert into public.system_errors
    (error_id, request_id, organization_id, store_id, user_id, route, severity, message, detail)
  values
    (p_error_id, p_request_id, p_org, p_store, auth.uid(), p_route,
     case when p_severity in ('warning','error','critical') then p_severity else 'error' end,
     left(p_message, 500), p_detail);
end $$;

-- -------------------------------------------------------------
-- 2) organizations.status に pending_deletion を追加
--    契約終了 → cancelled（データ保持・ログイン不可） → pending_deletion（保持期限後の削除待ち）
--    物理削除は行わず、削除実行は将来の運用手順（docs/privacy-operations.md）に従う
-- -------------------------------------------------------------
alter table public.organizations drop constraint if exists organizations_status_check;
alter table public.organizations add constraint organizations_status_check
  check (status in ('trial','active','suspended','cancelled','pending_deletion'));

-- -------------------------------------------------------------
-- 3) 顧客匿名化の受け皿
--    取引履歴（orders/payments等）は会計上保持し、個人特定情報のみ匿名化する設計。
--    実行はアプリの匿名化アクション（権限+監査ログ付き）から。
-- -------------------------------------------------------------
alter table public.customers
  add column if not exists anonymized_at timestamptz;
comment on column public.customers.anonymized_at is
  '匿名化実行日時。非nullの顧客は氏名・連絡先等のPIIが除去済み（取引集計は保持）';
