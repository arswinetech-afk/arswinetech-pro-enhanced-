-- ═══════════════════════════════════════════════════════════════════════════
-- ARSwineTech Pro — [FIX 149] AUTOMATIC 15-DAY TRIAL LABEL (run once)
--
-- Purpose: when a brand-new user registers and creates THEIR OWN farm, the
-- onboard_my_farm RPC inserts the farm row AND the owner membership in the
-- same call. This trigger labels that membership plan = 'trial' so the
-- platform owner sees "15-DAY TRIAL" in User Access and can convert it to
-- Starter / Full Access after purchase.
--
-- Invited users are NEVER touched: their membership joins a farm that was
-- created long ago, so the 2-minute freshness check fails and the plan is
-- left exactly as-is.
--
-- Note: if your farms/memberships columns differ slightly (e.g. plan has a
-- CHECK constraint), allow the value 'trial' first:
--   alter table public.farm_memberships drop constraint if exists farm_memberships_plan_check;
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_trial_on_new_farm_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f_created timestamptz;
begin
  select created_at into f_created
    from public.farms
   where id = NEW.farm_id;

  -- farm created within the last 2 minutes ⇒ this is a self-signup, not an invite
  if f_created is not null and f_created > now() - interval '2 minutes' then
    NEW.plan := 'trial';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_trial_new_farm_owner on public.farm_memberships;
create trigger trg_trial_new_farm_owner
  before insert on public.farm_memberships
  for each row
  execute function public.set_trial_on_new_farm_owner();
