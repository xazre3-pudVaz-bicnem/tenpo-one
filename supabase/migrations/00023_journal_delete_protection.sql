-- =============================================================
-- v0.4.1: 確定済み仕訳の物理削除防止
-- 00020は posted/voided のUPDATEをトリガーで禁止していたが、DELETEは
-- RLS上の書込ロール（org_owner/hq_admin/hq_accounting）が直接実行できた。
-- 確定会計履歴の改変は void_journal_entry（監査ログ付き取消）のみを唯一の経路とする。
-- draft仕訳の削除は従来どおり許可。
-- =============================================================

create or replace function public.prevent_posted_journal_delete()
returns trigger language plpgsql as $$
begin
  if old.status in ('posted','voided') then
    raise exception 'JOURNAL_IMMUTABLE: 確定済み・取消済みの仕訳は削除できません。修正は修正仕訳または取消（void）で行ってください';
  end if;
  return old;
end $$;

drop trigger if exists trg_journal_entries_no_delete on public.journal_entries;
create trigger trg_journal_entries_no_delete
  before delete on public.journal_entries
  for each row execute function public.prevent_posted_journal_delete();

-- 明細行の直接削除も親仕訳が確定済みなら拒否。
-- draft親のcascade削除時は親行が先に消えるため v_status は null となり通過する。
create or replace function public.prevent_posted_journal_line_delete()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.journal_entries where id = old.journal_entry_id;
  if v_status in ('posted','voided') then
    raise exception 'JOURNAL_IMMUTABLE: 確定済み仕訳の明細行は削除できません';
  end if;
  return old;
end $$;

drop trigger if exists trg_journal_lines_no_delete on public.journal_entry_lines;
create trigger trg_journal_lines_no_delete
  before delete on public.journal_entry_lines
  for each row execute function public.prevent_posted_journal_line_delete();
