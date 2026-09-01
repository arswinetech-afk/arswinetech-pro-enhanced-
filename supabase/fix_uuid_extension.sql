-- ═══════════════════════════════════════════════════════════════════════════
-- ARSwineTech Pro — ONE-TIME SUPABASE FIX  (run in SQL Editor, then never again)
--
-- Symptom: onboarding ("Create my secure farm workspace") fails with
--          ERROR: function uuid_generate_v4() does not exist
-- Cause:   the onboard_my_farm RPC mints farm IDs with uuid_generate_v4(),
--          which requires the uuid-ossp extension; fresh Supabase projects
--          do not enable it by default, and plpgsql resolves the call at
--          RUNTIME, so the RPC only fails when first used.
-- Fix:     enable the extensions below, then retry onboarding.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- verify: should return one uuid row
select uuid_generate_v4();
