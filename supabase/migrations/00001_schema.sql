-- =============================================================
-- TENPO ONE — 00001 schema
-- マルチテナント型 飲食店統合SaaS スキーマ定義
-- 金額: 円単位 integer / 日時: timestamptz(UTC) / 営業日: business_date
-- =============================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- テナント・権限
-- -------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_kana text,
  plan_code text not null default 'standard',
  status text not null default 'active' check (status in ('trial','active','suspended','cancelled')),
  contact_email text,
  contact_phone text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  slug text not null unique,
  name text not null,
  name_kana text,
  postal_code text,
  address text,
  phone text,
  email text,
  description text,
  seat_count integer,
  booking_enabled boolean not null default true,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_stores_org on public.stores(organization_id);

-- 店舗別設定（予約枠間隔・滞在時間・端数処理・サービス料など）
create table public.store_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null unique references public.stores(id),
  slot_minutes integer not null default 30,
  default_stay_minutes integer not null default 120,
  booking_cutoff_minutes integer not null default 120,
  booking_window_days integer not null default 90,
  max_party_size integer not null default 12,
  cancel_deadline_hours integer not null default 24,
  service_charge_rate numeric(5,2) not null default 0,
  rounding text not null default 'floor' check (rounding in ('floor','ceil','round')),
  receipt_header text,
  receipt_footer text,
  invoice_registration_number text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- auth.users 1:1
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  display_name_kana text,
  phone text,
  is_cypress_admin boolean not null default false,
  pin_code text, -- 店舗共用端末打刻用（4-6桁・org内で使用）
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  role text not null check (role in (
    'org_owner','hq_admin','hq_accounting','area_manager',
    'store_manager','assistant_manager','staff','part_time','external_accountant')),
  hourly_note text,
  status text not null default 'active' check (status in ('active','invited','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (organization_id, profile_id)
);
create index idx_memberships_profile on public.memberships(profile_id);
create index idx_memberships_org on public.memberships(organization_id);

create table public.membership_stores (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (membership_id, store_id)
);
create index idx_membership_stores_store on public.membership_stores(store_id);

-- 権限マスタ（lib/permissions.ts と同期）
create table public.roles (
  code text primary key,
  name text not null,
  scope text not null check (scope in ('platform','organization','store')),
  sort_order integer not null default 0
);

create table public.permissions (
  code text primary key,
  name text not null,
  category text
);

create table public.role_permissions (
  role_code text not null references public.roles(code),
  permission_code text not null references public.permissions(code),
  primary key (role_code, permission_code)
);

-- -------------------------------------------------------------
-- 店舗物理構成・営業時間
-- -------------------------------------------------------------

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  name text not null,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_floors_store on public.floors(store_id);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  floor_id uuid references public.floors(id),
  name text not null,
  capacity_min integer not null default 1,
  capacity_max integer not null default 4,
  is_private_room boolean not null default false,
  is_counter boolean not null default false,
  smoking_allowed boolean not null default false,
  sort_order integer not null default 0,
  current_status text not null default 'available' check (current_status in
    ('available','reserved','waiting','seated','ordering','billing','cleaning','unavailable')),
  status text not null default 'active' check (status in ('active','inactive','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_tables_store on public.restaurant_tables(store_id);

create table public.table_combinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  name text not null,
  table_ids uuid[] not null,
  combined_capacity integer not null,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  day_of_week integer not null check (day_of_week between 0 and 6),
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  last_entry_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (store_id, day_of_week)
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  holiday_date date not null,
  name text,
  is_temporary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (store_id, holiday_date)
);

-- -------------------------------------------------------------
-- 顧客（CRM）: 企業単位で共有
-- -------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  primary_store_id uuid references public.stores(id),
  name text not null,
  name_kana text,
  phone text,
  email text,
  birthday date,
  gender text check (gender in ('male','female','other') or gender is null),
  postal_code text,
  address text,
  allergy_note text,
  dislike_note text,
  preference_note text,
  seat_preference text,
  service_note text,
  anniversary_note text,
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  visit_count integer not null default 0,
  total_spent bigint not null default 0,
  cancel_count integer not null default 0,
  no_show_count integer not null default 0,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_customers_org on public.customers(organization_id);
create index idx_customers_phone on public.customers(organization_id, phone);
create index idx_customers_kana on public.customers(organization_id, name_kana);

create table public.customer_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  color text not null default '#7B3FF2',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.customer_tag_links (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag_id uuid not null references public.customer_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (customer_id, tag_id)
);

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  customer_id uuid not null references public.customers(id) on delete cascade,
  store_id uuid references public.stores(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  customer_id uuid not null references public.customers(id) on delete cascade,
  consent_type text not null check (consent_type in ('privacy','marketing_email','marketing_line')),
  granted boolean not null default false,
  granted_at timestamptz,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, consent_type)
);

-- -------------------------------------------------------------
-- 税率・メニュー
-- -------------------------------------------------------------

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  rate numeric(5,2) not null,
  is_reduced boolean not null default false,
  is_inclusive boolean not null default true,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id), -- null = 全店共通
  name text not null,
  color text,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_menu_categories_org on public.menu_categories(organization_id);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id), -- null = 全店共通
  category_id uuid references public.menu_categories(id),
  name text not null,
  name_kana text,
  description text,
  image_path text,
  item_type text not null default 'food' check (item_type in ('food','drink','course','option')),
  price integer not null default 0,
  takeout_price integer,
  cost integer,
  tax_rate_id uuid references public.tax_rates(id),
  duration_minutes integer, -- コース所要時間
  sell_start_time time,
  sell_end_time time,
  sort_order integer not null default 0,
  is_sold_out boolean not null default false,
  status text not null default 'active' check (status in ('active','hidden','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_menu_items_org on public.menu_items(organization_id);
create index idx_menu_items_category on public.menu_items(category_id);

create table public.menu_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null,
  price_diff integer not null default 0,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.menu_modifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  price integer not null default 0,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.menu_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  modifier_id uuid not null references public.menu_modifiers(id) on delete cascade,
  unique (menu_item_id, modifier_id)
);

-- -------------------------------------------------------------
-- 予約
-- -------------------------------------------------------------

create table public.reservation_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id), -- null = 共通マスタ
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  customer_id uuid references public.customers(id),
  code text not null unique, -- 公開照会用予約コード
  reserved_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  party_size integer not null,
  adults integer not null default 0,
  children integer not null default 0,
  course_id uuid references public.menu_items(id),
  seat_type text, -- テーブル/カウンター/個室 等の希望
  purpose text,
  guest_name text not null,
  guest_name_kana text,
  guest_phone text not null,
  guest_email text,
  allergy_note text,
  request_note text,
  memo text, -- 店舗内部メモ
  status text not null default 'confirmed' check (status in
    ('pending','confirmed','seated','completed','cancelled','no_show','waitlisted')),
  source_id uuid references public.reservation_sources(id),
  created_via text not null default 'web' check (created_via in ('web','phone','walk_in','manual')),
  cancel_reason text,
  cancelled_at timestamptz,
  consent_accepted boolean not null default false,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_reservations_store_date on public.reservations(store_id, reserved_date);
create index idx_reservations_org_date on public.reservations(organization_id, reserved_date);
create index idx_reservations_customer on public.reservations(customer_id);
create index idx_reservations_span on public.reservations(store_id, start_at, end_at);

create table public.reservation_tables (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id),
  created_at timestamptz not null default now(),
  unique (reservation_id, table_id)
);
create index idx_reservation_tables_table on public.reservation_tables(table_id);

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  guest_name text not null,
  guest_phone text not null,
  party_size integer not null,
  desired_date date not null,
  desired_time_from time,
  desired_time_to time,
  note text,
  status text not null default 'waiting' check (status in ('waiting','contacted','converted','expired','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- 公開予約の簡易レート制限
create table public.booking_request_logs (
  id uuid primary key default gen_random_uuid(),
  ip text,
  phone text,
  store_id uuid,
  created_at timestamptz not null default now()
);
create index idx_booking_request_logs_created on public.booking_request_logs(created_at);

-- -------------------------------------------------------------
-- 注文・会計
-- -------------------------------------------------------------

create table public.registers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  name text not null,
  status text not null default 'active' check (status in ('active','inactive','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.register_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  register_id uuid not null references public.registers(id),
  business_date date not null,
  opened_by uuid references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_float integer not null default 0,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  expected_cash integer,
  counted_cash integer,
  difference integer,
  difference_reason text,
  status text not null default 'open' check (status in ('open','closed','approved')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_register_sessions_store_date on public.register_sessions(store_id, business_date);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated by default as identity,
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  reservation_id uuid references public.reservations(id),
  customer_id uuid references public.customers(id),
  table_id uuid references public.restaurant_tables(id),
  register_session_id uuid references public.register_sessions(id),
  order_type text not null default 'dine_in' check (order_type in ('dine_in','takeout','delivery','course','pre_order')),
  status text not null default 'open' check (status in ('open','paid','cancelled','refunded','void')),
  guest_count integer not null default 1,
  staff_id uuid references public.profiles(id), -- 担当スタッフ
  subtotal integer not null default 0,          -- 税抜合計
  discount_total integer not null default 0,
  discount_reason text,
  service_charge integer not null default 0,
  tax_total integer not null default 0,
  rounding_adjustment integer not null default 0,
  total integer not null default 0,             -- 支払総額
  business_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  void_reason text,
  source_order_id uuid references public.orders(id), -- 伝票分割・統合の元
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_orders_store_date on public.orders(store_id, business_date);
create index idx_orders_org_date on public.orders(organization_id, business_date);
create index idx_orders_customer on public.orders(customer_id);
create index idx_orders_reservation on public.orders(reservation_id);
create index idx_orders_status on public.orders(store_id, status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  order_id uuid not null references public.orders(id) on delete restrict,
  menu_item_id uuid references public.menu_items(id),
  name text not null,               -- 商品名スナップショット
  unit_price integer not null,      -- 適用価格スナップショット
  quantity integer not null default 1,
  tax_rate numeric(5,2) not null default 10.00,
  tax_included boolean not null default true,
  modifiers jsonb not null default '[]'::jsonb,
  memo text,
  line_total integer not null default 0,
  staff_id uuid references public.profiles(id),
  status text not null default 'active' check (status in ('active','cancelled')),
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_order_items_order on public.order_items(order_id);
create index idx_order_items_org_menu on public.order_items(organization_id, menu_item_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  order_id uuid not null references public.orders(id) on delete restrict,
  register_session_id uuid references public.register_sessions(id),
  method text not null check (method in ('cash','credit','qr','emoney','voucher','on_account')),
  amount integer not null,
  tendered integer,
  change_amount integer,
  status text not null default 'completed' check (status in ('completed','refunded')),
  paid_at timestamptz not null default now(),
  business_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_payments_order on public.payments(order_id);
create index idx_payments_store_date on public.payments(store_id, business_date);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  order_id uuid not null references public.orders(id),
  payment_id uuid references public.payments(id),
  register_session_id uuid references public.register_sessions(id),
  amount integer not null,
  method text not null check (method in ('cash','credit','qr','emoney','voucher','on_account')),
  reason text not null,
  approved_by uuid references public.profiles(id),
  refunded_at timestamptz not null default now(),
  business_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_refunds_order on public.refunds(order_id);

-- -------------------------------------------------------------
-- 現金・レジ締め
-- -------------------------------------------------------------

create table public.expense_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (organization_id, code)
);

create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  register_session_id uuid references public.register_sessions(id),
  kind text not null check (kind in
    ('sale','refund','deposit','withdrawal','petty_in','petty_out','adjustment')),
  amount integer not null check (amount >= 0), -- 正の金額。方向はkindで判定
  purpose text,
  expense_account_id uuid references public.expense_accounts(id),
  receipt_document_id uuid,
  order_id uuid references public.orders(id),
  refund_id uuid references public.refunds(id),
  approval_status text not null default 'approved' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  occurred_at timestamptz not null default now(),
  business_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  status text not null default 'active' check (status in ('active','voided')),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_cash_tx_store_date on public.cash_transactions(store_id, business_date);
create index idx_cash_tx_session on public.cash_transactions(register_session_id);
create index idx_cash_tx_kind on public.cash_transactions(store_id, kind, business_date);

create table public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  business_date date not null,
  register_session_id uuid references public.register_sessions(id),
  sales_total integer not null default 0,
  orders_count integer not null default 0,
  guests_count integer not null default 0,
  discount_total integer not null default 0,
  refund_total integer not null default 0,
  payment_breakdown jsonb not null default '{}'::jsonb,
  cash_difference integer not null default 0,
  status text not null default 'closed' check (status in ('closed','approved','reopened')),
  closed_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (store_id, business_date)
);

-- -------------------------------------------------------------
-- 経費・仕入先・請求書・書類
-- -------------------------------------------------------------

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  name_kana text,
  contact_name text,
  phone text,
  email text,
  address text,
  closing_day integer, -- 締め日（31=月末）
  payment_day integer, -- 支払日
  bank_info text,
  note text,
  status text not null default 'active' check (status in ('active','inactive','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_vendors_org on public.vendors(organization_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id),
  doc_type text not null default 'other' check (doc_type in
    ('invoice','receipt','register_receipt','delivery_note','purchase_order','quotation','contract','other')),
  title text,
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  doc_date date,
  year_month text, -- 'YYYY-MM' 検索用
  vendor_id uuid references public.vendors(id),
  amount integer,
  tax_amount integer,
  memo text,
  ocr_status text not null default 'none' check (ocr_status in ('none','pending','done','failed')),
  ocr_payload jsonb,
  status text not null default 'inbox' check (status in ('inbox','filed','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_documents_org_ym on public.documents(organization_id, year_month);
create index idx_documents_store on public.documents(store_id);

alter table public.cash_transactions
  add constraint fk_cash_tx_receipt_document
  foreign key (receipt_document_id) references public.documents(id);

create table public.document_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  document_id uuid not null references public.documents(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id),
  vendor_id uuid references public.vendors(id),
  vendor_name text not null,
  invoice_no text,
  issue_date date,
  due_date date,
  amount integer not null default 0,
  tax_amount integer not null default 0,
  registration_number text, -- インボイス登録番号
  payment_method text check (payment_method in ('bank_transfer','cash','credit','direct_debit','other') or payment_method is null),
  status text not null default 'open' check (status in
    ('open','review','approved','scheduled','paid','rejected')),
  paid_at date,
  document_id uuid references public.documents(id),
  assignee_id uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_invoices_org_due on public.invoices(organization_id, due_date);
create index idx_invoices_status on public.invoices(organization_id, status);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  expense_account_id uuid references public.expense_accounts(id),
  amount integer not null,
  tax_amount integer not null default 0,
  paid_via text not null default 'petty_cash' check (paid_via in ('petty_cash','register','bank','personal')),
  vendor_name text,
  memo text,
  receipt_document_id uuid references public.documents(id),
  cash_transaction_id uuid references public.cash_transactions(id),
  business_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  status text not null default 'active' check (status in ('active','voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_expenses_store_date on public.expenses(store_id, business_date);

-- -------------------------------------------------------------
-- 仕入・在庫
-- -------------------------------------------------------------

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  name text not null,
  item_kind text not null default 'ingredient' check (item_kind in ('ingredient','supply','product')),
  category text,
  unit text not null default '個',
  current_quantity numeric(12,2) not null default 0,
  reorder_point numeric(12,2),
  avg_cost integer,
  menu_item_id uuid references public.menu_items(id), -- 販売連動（商品在庫）
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_inventory_items_store on public.inventory_items(store_id);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_no bigint generated by default as identity,
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  vendor_id uuid not null references public.vendors(id),
  status text not null default 'draft' check (status in
    ('draft','requested','approved','ordered','partially_received','received','cancelled')),
  ordered_at timestamptz,
  expected_at date,
  total integer not null default 0,
  note text,
  requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_po_store on public.purchase_orders(store_id, status);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id),
  name text not null,
  quantity numeric(12,2) not null,
  unit text not null default '個',
  unit_cost integer not null default 0,
  received_quantity numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  movement_type text not null check (movement_type in
    ('in','out','waste','return','transfer_in','transfer_out','count_adjust','sale')),
  quantity numeric(12,2) not null, -- 符号付き（入庫+/出庫-）
  unit_cost integer,
  reason text,
  ref_order_id uuid references public.orders(id),
  ref_purchase_order_id uuid references public.purchase_orders(id),
  ref_stock_count_id uuid,
  occurred_at timestamptz not null default now(),
  business_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index idx_stock_movements_item on public.stock_movements(inventory_item_id, business_date);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  count_date date not null,
  status text not null default 'draft' check (status in ('draft','completed')),
  note text,
  counted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references public.stock_counts(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  expected_quantity numeric(12,2) not null default 0,
  counted_quantity numeric(12,2),
  difference numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stock_movements
  add constraint fk_stock_movements_count
  foreign key (ref_stock_count_id) references public.stock_counts(id);

-- -------------------------------------------------------------
-- 勤怠・シフト
-- -------------------------------------------------------------

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  profile_id uuid not null references public.profiles(id),
  work_date date not null,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  break_minutes integer not null default 0,
  entry_type text not null default 'normal' check (entry_type in
    ('normal','late','early_leave','absent','paid_leave','holiday_work')),
  status text not null default 'open' check (status in ('open','closed','approved')),
  source text not null default 'personal' check (source in ('shared_terminal','personal','manual')),
  note text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_time_entries_profile_date on public.time_entries(profile_id, work_date);
create index idx_time_entries_store_date on public.time_entries(store_id, work_date);

create table public.time_entry_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  profile_id uuid not null references public.profiles(id),
  time_entry_id uuid references public.time_entries(id),
  event_type text not null check (event_type in ('clock_in','clock_out','break_start','break_end')),
  occurred_at timestamptz not null default now(),
  source text not null default 'personal' check (source in ('shared_terminal','personal','manual')),
  via_pin boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_time_entry_events_profile on public.time_entry_events(profile_id, occurred_at);

create table public.attendance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  profile_id uuid not null references public.profiles(id),
  time_entry_id uuid references public.time_entries(id),
  request_type text not null default 'correction' check (request_type in ('correction','paid_leave','absence')),
  requested_changes jsonb not null default '{}'::jsonb,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_attendance_requests_store on public.attendance_requests(store_id, status);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  profile_id uuid not null references public.profiles(id),
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  kind text not null default 'planned' check (kind in ('planned','requested','confirmed')),
  status text not null default 'draft' check (status in ('draft','published','change_requested','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_shifts_store_date on public.shifts(store_id, shift_date);
create index idx_shifts_profile_date on public.shifts(profile_id, shift_date);

create table public.shift_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  day_of_week integer not null check (day_of_week between 0 and 6),
  time_from time not null,
  time_to time not null,
  required_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- -------------------------------------------------------------
-- 給与・歩合
-- -------------------------------------------------------------

create table public.payroll_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  store_id uuid references public.stores(id),
  pay_type text not null default 'hourly' check (pay_type in ('monthly','hourly','daily')),
  base_amount integer not null default 0, -- 月給/時給/日給
  overtime_rate numeric(4,2) not null default 1.25,
  night_rate numeric(4,2) not null default 0.25, -- 深夜割増（加算分）
  holiday_rate numeric(4,2) not null default 1.35,
  commute_allowance integer not null default 0, -- 交通費/日
  allowances jsonb not null default '[]'::jsonb, -- [{name, amount, per:'month'|'day'}]
  deductions jsonb not null default '[]'::jsonb,
  closing_day integer not null default 31,
  payment_day integer not null default 25,
  effective_from date not null default '2020-01-01',
  effective_to date,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_payroll_rules_profile on public.payroll_rules(profile_id);

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id),   -- null = 全店
  profile_id uuid references public.profiles(id), -- null = 全スタッフ
  name text not null,
  target_type text not null check (target_type in
    ('personal_sales','menu_item','category','store_target','nomination')),
  target_id uuid, -- menu_item / category の対象ID
  method text not null default 'rate' check (method in ('fixed','rate','tiered')),
  rate numeric(6,3),          -- % (rate方式)
  fixed_amount integer,       -- 円 (fixed方式)
  tiers jsonb,                -- [{from, to, rate}] (tiered方式)
  basis text not null default 'tax_excluded' check (basis in ('tax_included','tax_excluded')),
  min_amount integer,
  max_amount integer,
  effective_from date not null default '2020-01-01',
  effective_to date,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id), -- null = 全社
  title text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','confirmed','approved')),
  note text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_payroll_runs_org on public.payroll_runs(organization_id, period_start);

create table public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  store_id uuid references public.stores(id),
  work_days integer not null default 0,
  work_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  night_minutes integer not null default 0,
  holiday_minutes integer not null default 0,
  base_pay integer not null default 0,
  overtime_pay integer not null default 0,
  night_pay integer not null default 0,
  holiday_pay integer not null default 0,
  commute_pay integer not null default 0,
  allowance_total integer not null default 0,
  commission_total integer not null default 0,
  deduction_total integer not null default 0,
  gross_total integer not null default 0,
  breakdown jsonb not null default '{}'::jsonb, -- 計算根拠
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (payroll_run_id, profile_id)
);

-- -------------------------------------------------------------
-- 基盤（通知・監査・フラグ・プラン・印刷）
-- -------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  store_id uuid references public.stores(id),
  recipient_id uuid not null references public.profiles(id),
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_recipient on public.notifications(recipient_id, read_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  store_id uuid references public.stores(id),
  actor_id uuid,
  actor_role text,
  action text not null,
  target_table text,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  note text,
  ip text,
  created_at timestamptz not null default now()
);
create index idx_audit_logs_org on public.audit_logs(organization_id, created_at);
create index idx_audit_logs_target on public.audit_logs(target_table, target_id);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price integer not null default 0,
  description text,
  features jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id), -- null = グローバル既定値
  flag_key text not null,
  enabled boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create unique index idx_feature_flags_unique
  on public.feature_flags (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), flag_key);

-- プリンター設定（フェーズ2でSDK連携。初期はブラウザ印刷）
create table public.printer_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  name text not null,
  maker text,          -- Epson / Star など
  model text,
  connection_type text check (connection_type in ('browser','wifi','lan','bluetooth','usb') or connection_type is null),
  ip_address text,
  usage text not null default 'receipt' check (usage in ('receipt','kitchen','label')),
  paper_width_mm integer not null default 80,
  auto_print boolean not null default false,
  drawer_kick boolean not null default false,
  is_verified boolean not null default false, -- 実機検証済みのみtrue
  last_connected_at timestamptz,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  printer_config_id uuid references public.printer_configs(id),
  job_type text not null default 'receipt' check (job_type in ('receipt','ryoshusho','kitchen','test')),
  order_id uuid references public.orders(id),
  payload jsonb not null default '{}'::jsonb,
  target text not null default 'browser' check (target in ('browser','sdk')),
  status text not null default 'queued' check (status in ('queued','printed','failed')),
  error text,
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index idx_print_jobs_store on public.print_jobs(store_id, status);

-- -------------------------------------------------------------
-- updated_at 自動更新トリガー
-- -------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t record;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
    group by table_name
  loop
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()',
      t.table_name, t.table_name);
  end loop;
end $$;

-- -------------------------------------------------------------
-- 権限マスタ初期データ（グローバル・全テナント共通）
-- -------------------------------------------------------------

insert into public.roles (code, name, scope, sort_order) values
  ('cypress_admin','CYPRESSスーパー管理者','platform',1),
  ('org_owner','契約企業オーナー','organization',2),
  ('hq_admin','本社管理者','organization',3),
  ('hq_accounting','本社経理担当','organization',4),
  ('area_manager','エリアマネージャー','store',5),
  ('store_manager','店長','store',6),
  ('assistant_manager','副店長','store',7),
  ('staff','一般スタッフ','store',8),
  ('part_time','アルバイト','store',9),
  ('external_accountant','外部税理士・会計担当','organization',10);

insert into public.plans (code, name, monthly_price, description, sort_order) values
  ('starter','スターター', 9800, '1店舗・基本機能', 1),
  ('standard','スタンダード', 29800, '5店舗まで・全機能', 2),
  ('enterprise','エンタープライズ', 0, '無制限・個別見積', 3);

insert into public.reservation_sources (organization_id, code, name, sort_order) values
  (null,'web','公式Web予約',1),
  (null,'phone','電話',2),
  (null,'walk_in','ウォークイン',3),
  (null,'google','Google',4),
  (null,'line','LINE',5),
  (null,'gourmet_site','グルメサイト',6),
  (null,'other','その他',7);
