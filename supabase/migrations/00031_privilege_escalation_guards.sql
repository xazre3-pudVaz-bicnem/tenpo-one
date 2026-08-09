-- =============================================================
-- v0.5.0 SECURITY: 権限昇格の封鎖（セキュリティ監査 C1 / C2 / M2）
--
-- 設計の要: アプリの正規フロー（app/app/staff/actions.ts 等）は
-- createAdminClient()=service role で実行され auth.uid() が NULL になる。
-- 一方 PostgREST 直叩き攻撃（anon key + 本人JWT）では auth.uid() = 本人。
-- → 「auth.uid() が non-null（＝ユーザー文脈）かつ cypress adminでない」操作に対してのみ
--    機密変更を拒否する。service role 経由のアプリ操作（権限チェック済み）は通す。
-- =============================================================

-- -------------------------------------------------------------
-- C1: profiles の自己更新で is_cypress_admin / status / pin_code を書き換えられる穴
--     profiles_update_self は WITH CHECK (id = auth.uid()) だけで列制限が無かった。
-- -------------------------------------------------------------
create or replace function public.prevent_profile_privilege_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service role（auth.uid() is null）＝アプリの権限チェック済み操作は許可
  if auth.uid() is null then return new; end if;
  -- cypress運営はプラットフォーム管理者として許可（昇格前は is_cypress_admin=false なので自己昇格は不可）
  if public.app_is_cypress_admin() then return new; end if;

  -- ここに来るのは一般認証ユーザーの文脈。機密列の変更を禁止する。
  if new.is_cypress_admin is distinct from old.is_cypress_admin then
    raise exception 'FORBIDDEN_FIELD: is_cypress_admin は変更できません';
  end if;
  if new.status is distinct from old.status then
    raise exception 'FORBIDDEN_FIELD: status は変更できません';
  end if;
  if new.pin_code is distinct from old.pin_code then
    raise exception 'FORBIDDEN_FIELD: pin_code は直接変更できません';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_priv_guard on public.profiles;
create trigger trg_profiles_priv_guard
  before update on public.profiles
  for each row execute function public.prevent_profile_privilege_escalation();

-- -------------------------------------------------------------
-- C2: memberships / membership_stores の書込ロールが広すぎ、
--     store_manager/area_manager が自分を org_owner へ昇格できた。
--     RLS書込を org_owner / hq_admin のみに絞る（PostgREST直叩き防御）。
--     アプリUIは service role 経由 + role ceiling（app層で実装）で別途制御。
-- -------------------------------------------------------------
drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships for all
  using (public.app_is_cypress_admin()
         or public.app_role_in(organization_id, array['org_owner','hq_admin']))
  with check (public.app_is_cypress_admin()
         or public.app_role_in(organization_id, array['org_owner','hq_admin']));

drop policy if exists membership_stores_write on public.membership_stores;
create policy membership_stores_write on public.membership_stores for all
  using (public.app_is_cypress_admin() or exists (
    select 1 from public.memberships m where m.id = membership_id
      and public.app_role_in(m.organization_id, array['org_owner','hq_admin'])))
  with check (public.app_is_cypress_admin() or exists (
    select 1 from public.memberships m where m.id = membership_id
      and public.app_role_in(m.organization_id, array['org_owner','hq_admin'])));

-- 追加の防波堤: membershipのroleを『自分自身の行』で書き換える操作をDBでも拒否
-- （org_ownerが自分の権限を下げる正規操作もUI経由=service roleで行うため、ユーザー文脈では一律禁止）
create or replace function public.prevent_self_membership_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;              -- service role: 許可
  if public.app_is_cypress_admin() then return new; end if;    -- 運営: 許可
  -- ユーザー文脈で自分自身のmembershipのrole/statusを変更するのを禁止
  if new.profile_id = auth.uid()
     and (new.role is distinct from old.role or new.status is distinct from old.status) then
    raise exception 'FORBIDDEN: 自分自身の権限・状態は変更できません';
  end if;
  return new;
end $$;

drop trigger if exists trg_membership_self_guard on public.memberships;
create trigger trg_membership_self_guard
  before update on public.memberships
  for each row execute function public.prevent_self_membership_escalation();

-- -------------------------------------------------------------
-- M2: log_audit が caller供給の p_org を検証せず、任意orgへ監査行を書けた。
--     ユーザー文脈で p_org のアクティブメンバーでない場合は記録しない。
--     SECURITY DEFINER RPC は正しい p_org を渡すため影響なし。service role も通す。
-- -------------------------------------------------------------
create or replace function public.log_audit(
  p_org uuid, p_store uuid, p_action text,
  p_target_table text, p_target_id text,
  p_before jsonb default null, p_after jsonb default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- ユーザー文脈（auth.uid() non-null）では、所属しないorgへの監査書込を黙って無視する。
  -- SECURITY DEFINER RPC は正しい p_org を渡すため影響なし。service role（auth.uid() null）も通す。
  if auth.uid() is not null
     and not public.app_is_cypress_admin()
     and not exists (
       select 1 from public.memberships m
       where m.profile_id = auth.uid() and m.organization_id = p_org and m.status = 'active') then
    return null;
  end if;
  insert into public.audit_logs
    (organization_id, store_id, actor_id, actor_role, action, target_table, target_id,
     before_data, after_data, note)
  values
    (p_org, p_store, auth.uid(),
     coalesce(public.app_role(p_org), case when public.app_is_cypress_admin() then 'cypress_admin' end),
     p_action, p_target_table, p_target_id, p_before, p_after, p_note)
  returning id into v_id;
  return v_id;
end $$;
