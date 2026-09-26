-- 予約台帳設定 > SNS連携（2026-09-28 Ronnie）: SNS からの予約リンク（?src=）を経路として記録するための共通マスタ
insert into public.reservation_sources (organization_id, code, name, sort_order)
select v.organization_id, v.code, v.name, v.sort_order
from (values
  (null::uuid, 'facebook', 'Facebook', 20),
  (null::uuid, 'x',        'X（Twitter）', 21)
) as v(organization_id, code, name, sort_order)
where not exists (
  select 1 from public.reservation_sources rs
  where rs.code = v.code and rs.organization_id is null
);
