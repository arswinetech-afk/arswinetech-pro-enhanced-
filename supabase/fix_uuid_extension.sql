-- ═══════════════════════════════════════════════════════════════════════════
-- ARSwineTech Pro — ONE-TIME SUPABASE FIX  (SQL Editor → Run, then never again)
--
-- Symptom: onboarding ("Create my secure farm workspace") fails with
--          ERROR: function uuid_generate_v4() does not exist
-- Cause:   onboard_my_farm mints farm IDs with uuid_generate_v4(), which
--          needs the uuid-ossp extension; fresh Supabase projects don't
--          enable it, and plpgsql resolves calls at RUNTIME — so the RPC
--          installs fine but fails the first time someone registers.
--
-- This bulletproof edition covers every variant: extension missing,
-- extension installed in another schema, or a restricted RPC search_path.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) The real extension, installed into public so any search_path sees it.
--    (If it says "already exists in schema extensions", that's fine.)
create extension if not exists "uuid-ossp" schema public;

-- 2) pgcrypto — provides gen_random_uuid().
create extension if not exists pgcrypto;

-- 3) Last-resort wrapper: if uuid_generate_v4() is still invisible to the
--    RPC, create a public wrapper on top of gen_random_uuid().
do $do$
begin
  if to_regprocedure('public.uuid_generate_v4()') is null then
    create function public.uuid_generate_v4() returns uuid
    language sql as $fn$ select gen_random_uuid() $fn$;
  end if;
end $do$;

-- 4) Verify — must return one uuid row:
select uuid_generate_v4();
