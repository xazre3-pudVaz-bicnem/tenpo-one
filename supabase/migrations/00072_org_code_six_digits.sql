-- 企業番号を「6桁の数字だけ」に変える（2026-09-23 要望）。
--
-- 00071 では t1+5桁 にしていたが、iPad のテンキーで打てるように数字だけにする
-- （他社のレジも6桁の数字なので、現場が迷わない）。
-- まだ誰もレジのログインを使っていないので、既存の番号も作り直す。

update public.organizations set org_code = null where org_code !~ '^[0-9]{6}$';

do $$
declare
  r record;
  code text;
  placed boolean;
begin
  for r in select id from public.organizations where org_code is null loop
    placed := false;
    while not placed loop
      code := lpad((floor(random() * 1000000))::int::text, 6, '0');
      begin
        update public.organizations set org_code = code where id = r.id;
        placed := true;
      exception
        when unique_violation then placed := false;
      end;
    end loop;
  end loop;
end $$;

alter table public.organizations drop constraint if exists organizations_org_code_check;
alter table public.organizations add constraint organizations_org_code_check
  check (org_code is null or org_code ~ '^[0-9]{6}$');

comment on column public.organizations.org_code is 'レジ（iPad）のログインで使う企業番号（6桁の数字）';
