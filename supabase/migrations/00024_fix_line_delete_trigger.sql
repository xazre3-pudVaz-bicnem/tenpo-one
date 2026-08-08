-- =============================================================
-- 00023の修正: journal_entry_lines の親参照列は entry_id（journal_entry_id ではない）。
-- 誤った列参照により draft仕訳のcascade削除まで失敗していた。
-- =============================================================

create or replace function public.prevent_posted_journal_line_delete()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.journal_entries where id = old.entry_id;
  if v_status in ('posted','voided') then
    raise exception 'JOURNAL_IMMUTABLE: 確定済み仕訳の明細行は削除できません';
  end if;
  return old;
end $$;
