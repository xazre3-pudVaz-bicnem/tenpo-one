-- =============================================================
-- v0.4.3: 確定済み棚卸の不変性をDB層で強制
-- アプリ層（saveCounts/finalizeCount）はdraft以外を拒否しているが、
-- RLS書込ロールがAPI直叩きで completed の棚卸を改変できた（C4監査で検出）。
-- journal_entries の prevent_posted_entry_mutation と同じ防波堤を追加する。
-- 修正が必要な場合は新しい棚卸を作成して上書きする（履歴保持）。
-- =============================================================

-- 明細: 親がcompletedならUPDATE/DELETE禁止
create or replace function public.prevent_completed_count_item_mutation()
returns trigger language plpgsql as $$
declare
  v_count uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then v_count := old.stock_count_id; else v_count := new.stock_count_id; end if;
  select status into v_status from public.stock_counts where id = v_count;
  if v_status = 'completed' then
    raise exception 'STOCK_COUNT_LOCKED: 確定済みの棚卸は変更できません。修正は新しい棚卸で行ってください';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_stock_count_items_lock on public.stock_count_items;
create trigger trg_stock_count_items_lock
  before update or delete on public.stock_count_items
  for each row execute function public.prevent_completed_count_item_mutation();

-- 親: completed後は日付・状態の巻き戻しを禁止（noteの追記のみ許可）。DELETEも禁止
create or replace function public.prevent_completed_count_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'completed' then
      raise exception 'STOCK_COUNT_LOCKED: 確定済みの棚卸は削除できません';
    end if;
    return old;
  end if;
  if old.status = 'completed' and (
    new.status is distinct from old.status
    or new.count_date is distinct from old.count_date
    or new.store_id is distinct from old.store_id
  ) then
    raise exception 'STOCK_COUNT_LOCKED: 確定済みの棚卸の状態・日付は変更できません';
  end if;
  return new;
end $$;

drop trigger if exists trg_stock_counts_lock on public.stock_counts;
create trigger trg_stock_counts_lock
  before update or delete on public.stock_counts
  for each row execute function public.prevent_completed_count_mutation();
