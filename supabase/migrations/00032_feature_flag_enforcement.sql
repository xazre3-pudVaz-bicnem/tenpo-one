-- =============================================================
-- v0.5.0 SECURITY: feature flag のサーバー側強制（セキュリティ検証 TEST の所見）
-- feature_flags は UI/page 層（requireFeature）でのみ強制されており、
-- 公開QR RPC（create_qr_order）は機能OFFの企業でも直接呼べて注文を作れた。
--
-- 巨大な create_qr_order/get_qr_menu を再定義するとリグレッション risk が高いため、
-- orders への BEFORE INSERT トリガーで「qr_order機能がOFFの企業のQR注文作成」を
-- データ層で拒否する（どの経路から作られても効く）。
-- =============================================================

-- feature flag 判定ヘルパー: enabled=false 行があれば無効。行が無ければ既定ON。
create or replace function public.app_feature_enabled(p_org uuid, p_flag text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.feature_flags
    where organization_id = p_org and flag_key = p_flag and enabled = false);
$$;

-- QRオーダー機能がOFFの企業では order_source='qr' の注文を作成させない
create or replace function public.enforce_qr_order_feature()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.order_source = 'qr'
     and not public.app_feature_enabled(new.organization_id, 'qr_order') then
    raise exception 'QR_DISABLED: この店舗ではQRオーダーが無効です';
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_qr_feature on public.orders;
create trigger trg_orders_qr_feature
  before insert on public.orders
  for each row execute function public.enforce_qr_order_feature();
