-- 00062 の呼び出し（service_calls）の後片付けと、同時押しの競合対策。
--
-- 1) 会計が終わって卓が空いても、対応済みにし忘れた呼び出しが残ると次のお客様に引き継がれてしまう
--    （QR側に前のお客様の「会計希望」が出続け、新しい呼び出しも上げられない）。
--    → 注文が open でなくなったとき、卓が空席/清掃中に戻ったときに、未対応の呼び出しを自動で取り下げる。
-- 2) 同じ卓で2人が同時に呼び出すと、select→insert の隙間で一意制約違反になり、
--    実際には登録できているのにエラー表示になる。→ on conflict で吸収する。

/** 注文が会計・取消などで open でなくなったら、その卓の未対応呼び出しを取り下げる */
create or replace function public.trg_service_calls_on_order_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'open' and new.status <> 'open' and new.table_id is not null then
    update public.service_calls
       set status = 'cancelled', resolved_at = now()
     where table_id = new.table_id and status = 'open';
  end if;
  return new;
end $$;

drop trigger if exists trg_service_calls_on_order_close on public.orders;
create trigger trg_service_calls_on_order_close
  after update of status on public.orders
  for each row execute function public.trg_service_calls_on_order_close();

/** 卓が空席・清掃中・使用不可に戻ったら、その卓の未対応呼び出しを取り下げる */
create or replace function public.trg_service_calls_on_table_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_status in ('available', 'cleaning', 'unavailable')
     and old.current_status is distinct from new.current_status then
    update public.service_calls
       set status = 'cancelled', resolved_at = now()
     where table_id = new.id and status = 'open';
  end if;
  return new;
end $$;

drop trigger if exists trg_service_calls_on_table_release on public.restaurant_tables;
create trigger trg_service_calls_on_table_release
  after update of current_status on public.restaurant_tables
  for each row execute function public.trg_service_calls_on_table_release();

/** 同時押しでも二重登録・エラーにならないよう、on conflict で既存の1件を返す */
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

  -- 未対応の同種が既にあれば作らない（部分一意インデックス idx_service_calls_open_unique に委ねる）
  insert into public.service_calls (organization_id, store_id, table_id, order_id, kind)
  values (v_store.organization_id, v_store.id, v_table.id, v_order.id, p_kind)
  on conflict (table_id, kind) where (status = 'open') do nothing;

  select * into v_call from public.service_calls
  where table_id = v_table.id and kind = p_kind and status = 'open'
  limit 1;

  return jsonb_build_object(
    'id', v_call.id,
    'kind', v_call.kind,
    'status', v_call.status,
    'created_at', to_char(v_call.created_at at time zone 'Asia/Tokyo', 'HH24:MI')
  );
end $$;

revoke all on function public.create_qr_service_call(text, text, text) from public;
grant execute on function public.create_qr_service_call(text, text, text) to anon, authenticated;
