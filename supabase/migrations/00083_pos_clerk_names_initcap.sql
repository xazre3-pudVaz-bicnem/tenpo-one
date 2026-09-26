-- 担当者名の英字は先頭だけ大文字に（2026-09-27 Ronnie「Ronnie のように。大文字で入れても」）。
-- 既存分の一括修正（XITRI → Xitri・MIYAZAKI → Miyazaki）。以後はアプリ側（lib/clerk-name.ts）で揃える。
-- 同じ店舗に修正後の名前が既にある行は触らない（unique 制約を壊さない）。本番には 2026-09-27 に適用済み。
update public.pos_clerks c
set name = initcap(lower(c.name))
where c.name ~ '^[A-Za-z ]+$'
  and c.name <> initcap(lower(c.name))
  and not exists (
    select 1 from public.pos_clerks d
    where d.store_id = c.store_id and d.id <> c.id and d.name = initcap(lower(c.name))
  );
