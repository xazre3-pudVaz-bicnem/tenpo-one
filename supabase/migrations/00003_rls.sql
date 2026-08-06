-- =============================================================
-- TENPO ONE — 00003 RLS
-- 全テーブルRLS有効化・企業間完全分離・店舗スコープ・ロール制御
-- SECURITY DEFINER関数（finalize_order等）はRLSをバイパスするため、
-- 関数内で app_* による権限検証を行っている。
-- =============================================================

-- -------------------------------------------------------------
-- 標準ポリシー自動生成
--   select: cypress管理者 or (組織メンバー and 店舗アクセス)
--   write : cypress管理者 or (同上 and ロールがtier内)
-- -------------------------------------------------------------

do $$
declare
  r record;
  v_has_store boolean;
  v_roles text;
  v_sel text;
  v_wr text;
begin
  for r in
    select * from (values
      -- tier: ops=現場操作可 / mgmt=店長以上 / money=経理・店長以上 / hq=本社のみ
      ('floors','mgmt'), ('restaurant_tables','ops'), ('table_combinations','mgmt'),
      ('business_hours','mgmt'), ('holidays','mgmt'),
      ('reservations','ops'), ('waitlist_entries','ops'),
      ('registers','mgmt'), ('register_sessions','money'),
      ('orders','ops'), ('order_items','ops'),
      ('payments','money'), ('refunds','money'),
      ('cash_transactions','money'), ('daily_closings','money'),
      ('expenses','money'), ('documents','money'), ('invoices','money'),
      ('inventory_items','mgmt'), ('stock_movements','ops'), ('stock_counts','mgmt'),
      ('purchase_orders','mgmt'), ('purchase_order_items','mgmt'),
      ('time_entries','mgmt'), ('time_entry_events','mgmt'), ('attendance_requests','ops'),
      ('shifts','mgmt'), ('shift_requirements','mgmt'),
      ('printer_configs','mgmt'), ('print_jobs','ops'),
      ('store_settings','mgmt'),
      ('menu_categories','mgmt'), ('menu_items','mgmt'),
      ('menu_variants','mgmt'), ('menu_modifiers','mgmt'),
      ('customer_notes','ops'), ('customer_tags','mgmt'), ('customer_consents','ops'),
      ('vendors','mgmt'), ('tax_rates','mgmt'), ('expense_accounts','money'),
      ('document_comments','money'),
      ('payroll_rules','hq'), ('commission_rules','hq'), ('payroll_runs','hq')
    ) as t(tbl, tier)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.tbl and column_name = 'store_id'
    ) into v_has_store;

    v_roles := case r.tier
      when 'ops'   then $q$array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff','part_time']$q$
      when 'mgmt'  then $q$array['org_owner','hq_admin','area_manager','store_manager','assistant_manager']$q$
      when 'money' then $q$array['org_owner','hq_admin','hq_accounting','area_manager','store_manager','assistant_manager']$q$
      when 'hq'    then $q$array['org_owner','hq_admin','hq_accounting']$q$
    end;

    if v_has_store then
      v_sel := format(
        'public.app_is_cypress_admin() or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))');
      v_wr := format(
        'public.app_is_cypress_admin() or (public.app_role_in(organization_id, %s) and public.app_has_store_access(organization_id, store_id))',
        v_roles);
    else
      v_sel := 'public.app_is_cypress_admin() or public.app_is_org_member(organization_id)';
      v_wr := format('public.app_is_cypress_admin() or public.app_role_in(organization_id, %s)', v_roles);
    end if;

    execute format('create policy %I_select on public.%I for select using (%s)', r.tbl, r.tbl, v_sel);
    execute format('create policy %I_insert on public.%I for insert with check (%s)', r.tbl, r.tbl, v_wr);
    execute format('create policy %I_update on public.%I for update using (%s) with check (%s)', r.tbl, r.tbl, v_wr, v_wr);
    execute format('create policy %I_delete on public.%I for delete using (%s)', r.tbl, r.tbl, v_wr);
  end loop;
end $$;

-- 決済済み取引の削除禁止（RLSに加えてトリガーで防御）
create or replace function public.prevent_paid_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('paid','refunded') then
      raise exception 'PAID_ORDER_CANNOT_BE_DELETED';
    end if;
    return old;
  end if;
  return new;
end $$;

create trigger trg_orders_no_delete before delete on public.orders
  for each row execute function public.prevent_paid_mutation();

create or replace function public.prevent_payment_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'PAYMENTS_CANNOT_BE_DELETED';
end $$;

create trigger trg_payments_no_delete before delete on public.payments
  for each row execute function public.prevent_payment_delete();
create trigger trg_refunds_no_delete before delete on public.refunds
  for each row execute function public.prevent_payment_delete();

-- -------------------------------------------------------------
-- 特殊テーブル
-- -------------------------------------------------------------

-- organizations: 所属メンバーのみ閲覧、更新はオーナー/本社、作成はcypressのみ
alter table public.organizations enable row level security;
create policy organizations_select on public.organizations for select
  using (public.app_is_cypress_admin() or public.app_is_org_member(id));
create policy organizations_update on public.organizations for update
  using (public.app_is_cypress_admin() or public.app_role_in(id, array['org_owner','hq_admin']))
  with check (public.app_is_cypress_admin() or public.app_role_in(id, array['org_owner','hq_admin']));
create policy organizations_insert on public.organizations for insert
  with check (public.app_is_cypress_admin());
create policy organizations_delete on public.organizations for delete
  using (public.app_is_cypress_admin());

-- stores: メンバー閲覧（店舗スコープ制限はUI用途のため全店舗名は見える。データは各テーブルで制御）
alter table public.stores enable row level security;
create policy stores_select on public.stores for select
  using (public.app_is_cypress_admin() or public.app_is_org_member(organization_id));
create policy stores_write on public.stores for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id, array['org_owner','hq_admin']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id, array['org_owner','hq_admin']));

-- profiles: 本人 + 同組織メンバー + cypress
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select
  using (
    id = auth.uid()
    or public.app_is_cypress_admin()
    or exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m1.organization_id = m2.organization_id
      where m1.profile_id = auth.uid() and m1.status = 'active'
        and m2.profile_id = public.profiles.id and m2.status = 'active'));
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid() or public.app_is_cypress_admin())
  with check (id = auth.uid() or public.app_is_cypress_admin());
create policy profiles_insert_self on public.profiles for insert
  with check (id = auth.uid() or public.app_is_cypress_admin());

-- memberships: 自組織を閲覧、管理は owner/hq/店長系
alter table public.memberships enable row level security;
create policy memberships_select on public.memberships for select
  using (profile_id = auth.uid() or public.app_is_cypress_admin()
         or public.app_is_org_member(organization_id));
create policy memberships_write on public.memberships for all
  using (public.app_is_cypress_admin()
         or public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager']))
  with check (public.app_is_cypress_admin()
         or public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager']));

alter table public.membership_stores enable row level security;
create policy membership_stores_select on public.membership_stores for select
  using (exists (
    select 1 from public.memberships m where m.id = membership_id
      and (m.profile_id = auth.uid() or public.app_is_org_member(m.organization_id)))
    or public.app_is_cypress_admin());
create policy membership_stores_write on public.membership_stores for all
  using (public.app_is_cypress_admin() or exists (
    select 1 from public.memberships m where m.id = membership_id
      and public.app_role_in(m.organization_id, array['org_owner','hq_admin','area_manager','store_manager'])))
  with check (public.app_is_cypress_admin() or exists (
    select 1 from public.memberships m where m.id = membership_id
      and public.app_role_in(m.organization_id, array['org_owner','hq_admin','area_manager','store_manager'])));

-- customers: 個人情報閲覧権限のあるロールのみ
alter table public.customers enable row level security;
create policy customers_select on public.customers for select
  using (public.app_is_cypress_admin() or public.app_can_view_customer_pii(organization_id));
create policy customers_write on public.customers for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']));

-- customer_tag_links / reservation_tables / menu_item_modifiers / stock_count_items:
-- 親テーブル経由で制御
alter table public.customer_tag_links enable row level security;
create policy customer_tag_links_all on public.customer_tag_links for all
  using (exists (select 1 from public.customers c where c.id = customer_id))
  with check (exists (select 1 from public.customers c where c.id = customer_id));

alter table public.reservation_tables enable row level security;
create policy reservation_tables_all on public.reservation_tables for all
  using (exists (select 1 from public.reservations r where r.id = reservation_id))
  with check (exists (select 1 from public.reservations r where r.id = reservation_id));

alter table public.menu_item_modifiers enable row level security;
create policy menu_item_modifiers_all on public.menu_item_modifiers for all
  using (exists (select 1 from public.menu_items m where m.id = menu_item_id))
  with check (exists (select 1 from public.menu_items m where m.id = menu_item_id));

alter table public.stock_count_items enable row level security;
create policy stock_count_items_all on public.stock_count_items for all
  using (exists (select 1 from public.stock_counts s where s.id = stock_count_id))
  with check (exists (select 1 from public.stock_counts s where s.id = stock_count_id));

-- payroll_items: 本人明細 or 給与閲覧権限
alter table public.payroll_items enable row level security;
create policy payroll_items_select on public.payroll_items for select
  using (profile_id = auth.uid()
         or public.app_is_cypress_admin()
         or public.app_can_view_payroll(organization_id));
create policy payroll_items_write on public.payroll_items for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id, array['org_owner','hq_admin','hq_accounting']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id, array['org_owner','hq_admin','hq_accounting']));

-- notifications: 受信者本人のみ
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select
  using (recipient_id = auth.uid());
create policy notifications_update on public.notifications for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy notifications_insert on public.notifications for insert
  with check (organization_id is null or public.app_is_org_member(organization_id) or public.app_is_cypress_admin());

-- audit_logs: 挿入はlog_audit(definer)経由。閲覧は本社系+店長(自店)+cypress
alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs for select
  using (public.app_is_cypress_admin()
    or public.app_role_in(organization_id, array['org_owner','hq_admin','hq_accounting','external_accountant'])
    or (public.app_role_in(organization_id, array['area_manager','store_manager'])
        and public.app_has_store_access(organization_id, store_id)));

-- グローバルマスタ: 認証済みは閲覧可、書込はcypressのみ
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.plans enable row level security;
alter table public.reservation_sources enable row level security;
alter table public.feature_flags enable row level security;

create policy roles_select on public.roles for select using (auth.uid() is not null);
create policy permissions_select on public.permissions for select using (auth.uid() is not null);
create policy role_permissions_select on public.role_permissions for select using (auth.uid() is not null);
create policy plans_select on public.plans for select using (true);
create policy plans_write on public.plans for all
  using (public.app_is_cypress_admin()) with check (public.app_is_cypress_admin());
create policy reservation_sources_select on public.reservation_sources for select
  using (organization_id is null or public.app_is_org_member(organization_id) or public.app_is_cypress_admin());
create policy reservation_sources_write on public.reservation_sources for all
  using (public.app_is_cypress_admin() or (organization_id is not null and public.app_role_in(organization_id, array['org_owner','hq_admin'])))
  with check (public.app_is_cypress_admin() or (organization_id is not null and public.app_role_in(organization_id, array['org_owner','hq_admin'])));
create policy feature_flags_select on public.feature_flags for select
  using (organization_id is null or public.app_is_org_member(organization_id) or public.app_is_cypress_admin());
create policy feature_flags_write on public.feature_flags for all
  using (public.app_is_cypress_admin()) with check (public.app_is_cypress_admin());

-- booking_request_logs: definer関数専用（直接アクセス不可）
alter table public.booking_request_logs enable row level security;
create policy booking_request_logs_cypress on public.booking_request_logs for select
  using (public.app_is_cypress_admin());

-- -------------------------------------------------------------
-- Storage: documents バケット（非公開・パス先頭 = organization_id）
-- -------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520,
        array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy documents_storage_select on storage.objects for select
  using (bucket_id = 'documents'
    and (public.app_is_cypress_admin()
         or public.app_is_org_member(((storage.foldername(name))[1])::uuid)));
create policy documents_storage_insert on storage.objects for insert
  with check (bucket_id = 'documents'
    and public.app_role_in(((storage.foldername(name))[1])::uuid,
      array['org_owner','hq_admin','hq_accounting','area_manager','store_manager','assistant_manager']));
create policy documents_storage_delete on storage.objects for delete
  using (bucket_id = 'documents'
    and public.app_role_in(((storage.foldername(name))[1])::uuid,
      array['org_owner','hq_admin','hq_accounting']));
