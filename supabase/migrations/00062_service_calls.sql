-- お客様QRからの「スタッフ呼び出し」と「お会計希望」を記録し、ハンディ／レジで受ける。
-- 承認済みレイアウト（2026-09-21）の要件:
--   - 呼び出しは「通常の呼び出し」と「会計希望」を別種類として扱う
--   - 同じ訪問（同じ卓の未対応）で同じ種類を重複させない
--   - 店員側が対応済みにでき、全端末に反映される
--
-- 卓の「いまの訪問」は open な orders（無ければ卓そのもの）で表す。専用の訪問テーブルは作らない。
create table if not exists public.service_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  -- 呼び出し時点の未会計注文。会計後に古いQRから押されたものと区別する
  order_id uuid references public.orders(id) on delete set null,
  kind text not null check (kind in ('staff', 'checkout')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

comment on table public.service_calls is 'QRからの呼び出し（staff=スタッフ、checkout=お会計希望）';

-- 未対応の同種重複を防ぐ（卓ごとに1件ずつ）
create unique index if not exists idx_service_calls_open_unique
  on public.service_calls(table_id, kind)
  where status = 'open';

create index if not exists idx_service_calls_store_open
  on public.service_calls(store_id, status, created_at desc);

alter table public.service_calls enable row level security;

-- 店舗スタッフは自店舗の呼び出しを見る・対応する。作成はQR用RPC（SECURITY DEFINER）経由のみ。
drop policy if exists service_calls_select on public.service_calls;
create policy service_calls_select on public.service_calls for select
  using (
    public.app_is_cypress_admin()
    or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))
  );

drop policy if exists service_calls_update on public.service_calls;
create policy service_calls_update on public.service_calls for update
  using (
    public.app_is_cypress_admin()
    or (
      public.app_role_in(
        organization_id,
        array['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'part_time']
      )
      and public.app_has_store_access(organization_id, store_id)
    )
  )
  with check (
    public.app_is_cypress_admin()
    or (
      public.app_role_in(
        organization_id,
        array['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'part_time']
      )
      and public.app_has_store_access(organization_id, store_id)
    )
  );

-- 店員が卓から直接呼び出しを立てることはないので insert/delete ポリシーは置かない。

-- ハンディ／レジで即座に受け取れるようRealtimeに載せる（RLSは購読にも効く）
do $$
begin
  begin
    alter publication supabase_realtime add table public.service_calls;
  exception when duplicate_object then null;
  end;
end $$;

/**
 * QRからの呼び出し登録。
 * 同じ卓で未対応の同種があれば、新しく作らずその1件を返す（連打しても増えない）。
 * 会計済み・卓が空席のときは呼び出せない（古いQRからの操作を弾く）。
 */
create or replace function public.create_qr_service_call(p_slug text, p_token text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table public.restaurant_tables;
  v_store public.stores;
  v_order public.orders;
  v_call public.service_calls;
  v_recent integer;
begin
  if p_kind not in ('staff', 'checkout') then
    raise exception 'INVALID_KIND';
  end if;

  select t.* into v_table
  from public.restaurant_tables t
  join public.stores s on s.id = t.store_id
  where t.qr_token = p_token and s.slug = p_slug and t.status = 'active';
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;

  select * into v_store from public.stores where id = v_table.store_id;

  select * into v_order from public.orders
  where table_id = v_table.id and status = 'open'
  order by created_at desc limit 1;

  -- 利用中でなければ呼び出しを受け付けない（会計後の古いQR対策）
  if not found and v_table.current_status <> 'seated' then
    raise exception 'NOT_IN_SERVICE';
  end if;

  -- 連打・いたずら対策（1卓あたり1分に5件まで）
  select count(*) into v_recent from public.service_calls
  where table_id = v_table.id and created_at > now() - interval '1 minute';
  if v_recent >= 5 then raise exception 'RATE_LIMITED'; end if;

  select * into v_call from public.service_calls
  where table_id = v_table.id and kind = p_kind and status = 'open'
  limit 1;

  if not found then
    insert into public.service_calls (organization_id, store_id, table_id, order_id, kind)
    values (v_store.organization_id, v_store.id, v_table.id, v_order.id, p_kind)
    returning * into v_call;
  end if;

  return jsonb_build_object(
    'id', v_call.id,
    'kind', v_call.kind,
    'status', v_call.status,
    'created_at', to_char(v_call.created_at at time zone 'Asia/Tokyo', 'HH24:MI')
  );
end $$;

/** QR画面に出す「呼び出し中」の状態。対応済みになったらお客様側の表示も戻る。 */
create or replace function public.get_qr_service_calls(p_slug text, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', c.kind,
    'created_at', to_char(c.created_at at time zone 'Asia/Tokyo', 'HH24:MI')
  )), '[]'::jsonb)
  from public.service_calls c
  join public.restaurant_tables t on t.id = c.table_id
  join public.stores s on s.id = t.store_id
  where t.qr_token = p_token and s.slug = p_slug and c.status = 'open';
$$;

revoke all on function public.create_qr_service_call(text, text, text) from public;
revoke all on function public.get_qr_service_calls(text, text) from public;
grant execute on function
  public.create_qr_service_call(text, text, text),
  public.get_qr_service_calls(text, text)
to anon, authenticated;
