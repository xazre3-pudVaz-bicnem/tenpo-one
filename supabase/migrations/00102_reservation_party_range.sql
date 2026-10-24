-- =============================================================
-- 予約の人数を範囲で持つ（2026-10-24 Ronnie「4〜6 人のように、来店人数が決まっていないお客様」）
--
-- reservations.party_size_min：範囲で受けたときの最小人数（例 4〜6 名の 4）。範囲でないときは null。
-- 最大人数はこれまでどおり party_size（席の割り当て・人数の集計に使う）。
-- 列の追加だけ。既存の予約・データは変えない・消さない。
-- 列が無いあいだもアプリは動く（範囲はメモに「人数：4〜6名」と残す）。
-- =============================================================

alter table public.reservations
  add column if not exists party_size_min integer;

alter table public.reservations
  drop constraint if exists reservations_party_size_min_check;

alter table public.reservations
  add constraint reservations_party_size_min_check
  check (party_size_min is null or (party_size_min >= 1 and party_size_min <= party_size));

comment on column public.reservations.party_size_min is '人数を範囲で受けたときの最小人数（最大は party_size）。2026-10-24';
