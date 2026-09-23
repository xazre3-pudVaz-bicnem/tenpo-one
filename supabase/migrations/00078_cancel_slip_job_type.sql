-- =============================================================
-- print_jobs.job_type の CHECK 制約に 'cancel_slip' を追加する。
--
-- 一度キッチンへ出した品を取り消したとき、厨房だけでなくレジのレシート機にも
-- 「取消」の紙を出す（2026-09-24 店舗要望）。厨房ぶんは claim_kitchen_items の
-- マイナス差分で今までどおり出るので、ここはレジ側の伝票の種類だけ足す。
-- =============================================================
alter table public.print_jobs
  drop constraint if exists print_jobs_job_type_check;

alter table public.print_jobs
  add constraint print_jobs_job_type_check
  check (job_type in ('receipt','ryoshusho','kitchen','test','order_slip','register_report','cancel_slip'));
