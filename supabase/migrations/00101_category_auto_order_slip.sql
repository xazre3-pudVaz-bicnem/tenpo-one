-- Opt-in only: no existing category is enabled by this migration.
alter table public.menu_categories
  add column if not exists print_order_slip boolean not null default false;
comment on column public.menu_categories.print_order_slip is
  '注文確定時、このカテゴリの商品を含む伝票の会計伝票を1回自動印刷する';
