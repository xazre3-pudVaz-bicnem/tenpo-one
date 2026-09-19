-- 注文伝票（会計前の注文履歴・合計金額の確認用）を印刷できるようにする。
-- print_jobs.job_type の CHECK 制約に 'order_slip' を追加する。
alter table public.print_jobs
  drop constraint if exists print_jobs_job_type_check;

alter table public.print_jobs
  add constraint print_jobs_job_type_check
  check (job_type in ('receipt','ryoshusho','kitchen','test','order_slip'));
