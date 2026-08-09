-- =============================================================
-- マーケティングサイトの問い合わせ（リード）保存。
-- メール送信APIは未接続のため、送信内容はこのテーブルに保存し、
-- CYPRESS運営が /admin から確認する運用とする（見せかけの送信成功を作らない）。
-- 匿名フォームからの投入はサーバーアクション（service role）経由でのみ行い、
-- 直接の anon insert ポリシーは設けない。
-- =============================================================

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text,
  store_name text,
  contact_name text not null,
  phone text,
  email text not null,
  store_count text,               -- '1' | '2-5' | '6-10' | '11-30' | '31+'
  current_tools text,             -- 現在利用中のシステム（自由記述）
  message text,                   -- 相談内容
  source text not null default 'contact_page',
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create index if not exists idx_contact_requests_created on public.contact_requests(created_at desc);

alter table public.contact_requests enable row level security;
-- 閲覧はCYPRESS運営のみ。書込は service role（サーバーアクション）経由のみ（ポリシーを設けない）。
create policy contact_requests_select on public.contact_requests for select
  using (public.app_is_cypress_admin());
