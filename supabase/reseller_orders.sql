-- ═══════════════════════════════════════════════════════════════════════════
-- ARSwineTech Pro — [FIX 188] RESELLER ORDER LINKS (run once, ~15 s)
--
-- Gives each reseller a private link (…/order.html?k=<token>) where they tap the
-- bottles they want, see the price and what is left, and hit Place order. The
-- order lands in the Reseller Center as a PENDING request with a badge; nothing
-- about stock, balances or invoices changes until you press Accept in the app.
--
-- WHY IT LOOKS LIKE THIS
--   Your cloud is one table — public.app_records (farm_id, entity_type, local_id,
--   payload, updated_at) — protected by RLS that requires a farm membership. A
--   public page has no such login, so it must not touch that table directly.
--   These three SECURITY DEFINER functions are the ONLY public door, and each one
--   takes nothing but a token:
--     * ars_order_catalog(text)  → what the farm is offering right now
--     * ars_place_order(text,jsonb,text,text) → validates + inserts the request
--     * ars_order_status(text)   → that link's own last orders (status for the page)
--   No service-role key exists anywhere in the app, the zip or Cloudflare: the
--   publishable anon key stays exactly as public as it is today, and it gains no
--   new rights — it can only ever place an order against a token that exists.
--
-- NO NEW TABLE. A link and an order are ordinary farm records, so they sync to
-- every device through the existing pipeline, ride the farm backup, and disappear
-- with a farm delete like everything else:
--     entity_type = 'semen_reseller_order_link'   (payload holds the token)
--     entity_type = 'semen_reseller_order'        (payload holds the request)
--
-- IDEMPOTENT: safe to re-run any number of times. No existing data is modified.
-- Run as the project's postgres role (the SQL editor default) so the definer
-- functions own their write path.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Indexes — the token is inside a jsonb payload, so give the public lookups a
--    small partial index instead of a scan of the farm's rows.
-- NOTE ON BIG TABLES: `create index` takes a brief write lock. If app_records
-- already holds many thousands of rows, run each statement separately (without this
-- file's editor transaction) using the CONCURRENTLY variant:
--   create index concurrently if not exists app_records_order_link_idx on public.app_records ((payload->>'token')) where entity_type = 'semen_reseller_order_link';
create index if not exists app_records_order_link_idx
  on public.app_records ((payload->>'token'))
  where entity_type = 'semen_reseller_order_link';

create index if not exists app_records_order_linkid_idx
  on public.app_records ((payload->>'link_id'))
  where entity_type = 'semen_reseller_order';

-- 2) What the farm is offering — only the six fields a reseller may ever see.
--    Price comes from the batch record itself (the same number your pick-up form
--    prefills), and so does the count, so the page can never invent either.
create or replace function public.ars_order_catalog(p_token text)
returns table(item_key text, semen_batch_no text, boar text, breed text,
              price numeric, on_hand integer)
language sql
stable
set search_path = public
  security definer
as $$
  select a.local_id::text,
         coalesce(nullif(a.payload->>'semen_batch_no',''), a.local_id::text),
         coalesce(nullif(a.payload->>'boar_name',''), nullif(a.payload->>'boar',''), 'Semen'),
         coalesce(nullif(a.payload->>'breed',''), '—'),
         coalesce((a.payload->>'price_per_dose')::numeric, (a.payload->>'price')::numeric, 0),
         greatest(0, coalesce((a.payload->>'available_bottles')::int, (a.payload->>'bottles')::int, 0))
    from public.app_records a
   where a.entity_type = 'semen_inventory'
     and a.farm_id = (select l.farm_id from public.app_records l
                       where l.entity_type = 'semen_reseller_order_link'
                         and l.payload->>'token' = p_token
                         and coalesce(l.payload->>'active','true') = 'true'
                       limit 1)
     and coalesce(a.payload->>'status','active') not in ('voided','deleted','archived')
     and greatest(0, coalesce((a.payload->>'available_bottles')::int, (a.payload->>'bottles')::int, 0)) > 0
   order by 3, 2;
$$;

-- 2b) Whose link is this? The page shows the reseller's own name and the farm's,
--     both copied onto the link row by the app when the link was made — so this
--     never touches the farms table, and an unknown or revoked token says so plainly.
create or replace function public.ars_order_shop(p_token text)
returns jsonb
language plpgsql
stable
set search_path = public
  security definer
as $$
declare v jsonb;
begin
  select jsonb_build_object(
           'ok', true,
           'farm_name', coalesce(nullif(a.payload->>'farm_name',''), 'ARSwineTech farm'),
           'reseller_name', coalesce(nullif(a.payload->>'reseller_name',''), 'Reseller'),
           'active', coalesce(a.payload->>'active','true') = 'true'
         ) into v
    from public.app_records a
   where a.entity_type = 'semen_reseller_order_link'
     and a.payload->>'token' = p_token
   limit 1;
  if v is null then
    return jsonb_build_object('ok', false, 'error',
      'This order link was cancelled by the farm or never existed. Ask for a new link.');
  end if;
  if v->>'active' <> 'true' then
    return jsonb_build_object('ok', false, 'error',
      'This order link is paused. Message the farm and they will switch it back on.');
  end if;
  return v;
end;
$$;

-- 3) Place an order.
--    Every number that reaches the ledger is recomputed here: the client sends
--    item keys and quantities only, prices and availability come from your stock,
--    and an over-request is clamped to what the batch actually holds (the response
--    reports the clamping so the page can say so out loud).
create or replace function public.ars_place_order(
  p_token text,
  p_lines jsonb,
  p_note text default null,
  p_need_by text default null
) returns jsonb
language plpgsql
set search_path = public
  security definer
as $$
declare
  v_link      record;
  v_line      record;
  v_item      record;
  v_lines     jsonb := '[]'::jsonb;
  v_total     numeric := 0;
  v_qty       integer;
  v_clamped   jsonb := '[]'::jsonb;
  v_pending   integer;
  v_order_id  text := 'rsord_' || replace(gen_random_uuid()::text, '-', '');
  v_payload   jsonb;
begin
  select a.* into v_link
    from public.app_records a
   where a.entity_type = 'semen_reseller_order_link'
     and a.payload->>'token' = p_token
     and coalesce(a.payload->>'active','true') = 'true'
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error',
      'This order link is no longer active. Ask the farm for a new one.');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Pick at least one bottle first.');
  end if;

  /* spam guard: one order per link per 20 s, and never a queue longer than 25 */
  if coalesce(v_link.payload->>'last_order_at','') <> ''
     and (now() - (v_link.payload->>'last_order_at')::timestamptz) < interval '20 seconds' then
    return jsonb_build_object('ok', false, 'error',
      'That was quick — please wait a few seconds before sending another order.');
  end if;

  select count(*) into v_pending
    from public.app_records o
   where o.entity_type = 'semen_reseller_order'
     and o.farm_id = v_link.farm_id
     and o.payload->>'link_id' = v_link.local_id::text
     and coalesce(o.payload->>'status','pending') = 'pending';
  if v_pending >= 25 then
    return jsonb_build_object('ok', false, 'error',
      'This link already has 25 unread orders. Send your next order after the farm clears the list.');
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := least(999, greatest(1, coalesce(nullif(v_line->>'qty','')::int, 0)));

    select a.local_id::text as key,
           coalesce(nullif(a.payload->>'semen_batch_no',''), a.local_id::text) as batch,
           coalesce(nullif(a.payload->>'boar_name',''), nullif(a.payload->>'boar',''), 'Semen') as boar,
           coalesce(nullif(a.payload->>'breed',''), '—') as breed,
           coalesce((a.payload->>'price_per_dose')::numeric, (a.payload->>'price')::numeric, 0) as price,
           greatest(0, coalesce((a.payload->>'available_bottles')::int, (a.payload->>'bottles')::int, 0)) as on_hand
      into v_item
      from public.app_records a
     where a.entity_type = 'semen_inventory'
       and a.farm_id = v_link.farm_id
       and (a.local_id::text = (v_line->>'k')::text
            or coalesce(nullif(a.payload->>'semen_batch_no',''),'') = coalesce(v_line->>'k',''))
     limit 1;

    if not found or v_item.on_hand <= 0 then
      v_clamped := v_clamped || jsonb_build_array(jsonb_build_object(
        'requested', v_qty, 'granted', 0, 'boar', coalesce(v_line->>'boar','?'),
        'why', 'no longer in stock'));
      continue;
    end if;

    if v_qty > v_item.on_hand then
      v_clamped := v_clamped || jsonb_build_array(jsonb_build_object(
        'requested', v_qty, 'granted', v_item.on_hand, 'boar', v_item.boar,
        'batch', v_item.batch, 'why', 'only what is left was reserved'));
      v_qty := v_item.on_hand;
    end if;

    v_total := v_total + (v_qty * v_item.price);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'semen_id', v_item.key, 'semen_batch_no', v_item.batch, 'boar', v_item.boar,
      'breed', v_item.breed, 'qty', v_qty, 'rate', v_item.price,
      'amount', +(v_qty * v_item.price)::numeric(12,2)));
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', false, 'error',
      'Nothing in that order is in stock any more — ask the farm what is available.',
      'clamped', v_clamped);
  end if;

  v_payload := jsonb_build_object(
    'id', v_order_id,
    'farm_id', v_link.farm_id,
    'link_id', v_link.local_id,
    'reseller_id', v_link.payload->>'reseller_id',
    'reseller_name', v_link.payload->>'reseller_name',
    'status', 'pending',
    'source', 'reseller_link',
    'placed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'need_by', nullif(coalesce(p_need_by,''),''),
    'note', left(regexp_replace(coalesce(p_note,''), '\s+', ' ', 'g'), 240),
    'lines', v_lines,
    'bottles', (select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l),
    'total', +v_total::numeric(12,2),
    'clamped', v_clamped,
    'updated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  execute format(
    'insert into public.app_records (farm_id, entity_type, local_id, payload, updated_at)
     values (%L, %L, %L, %L::jsonb, now())',
    v_link.farm_id, 'semen_reseller_order', v_order_id, v_payload::text);

  /* stamp the link so the next device pull shows the arrival, and the guard above works */
  update public.app_records
     set payload = jsonb_set(
           jsonb_set(payload::jsonb, '{last_order_at}',
             to_jsonb(to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
           '{order_count}', to_jsonb(coalesce((payload->>'order_count')::int, 0) + 1), true),
         updated_at = now()
   where entity_type = 'semen_reseller_order_link'
     and local_id = v_link.local_id
     and farm_id = v_link.farm_id;

  return jsonb_build_object('ok', true, 'order_id', v_order_id,
                            'total', +v_total::numeric(12,2),
                            'bottles', (select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l),
                            'lines', v_lines, 'clamped', v_clamped,
                            'reseller_name', v_link.payload->>'reseller_name');
end;
$$;

-- 4) The reseller's own order history on that page — status only, newest first.
--    A link can only ever read orders that were placed through it.
create or replace function public.ars_order_status(p_token text)
returns table(order_id text, status text, placed_at text, bottles integer,
              total numeric, note text, decision_note text)
language sql
stable
set search_path = public
  security definer
as $$
  with link as (
    select l.local_id::text as lid, l.farm_id
      from public.app_records l
     where l.entity_type = 'semen_reseller_order_link'
       and l.payload->>'token' = p_token
     limit 1
  )
  select o.local_id::text,
         coalesce(o.payload->>'status','pending'),
         coalesce(o.payload->>'placed_at',''),
         coalesce((o.payload->>'bottles')::int, 0),
         coalesce((o.payload->>'total')::numeric, 0),
         coalesce(o.payload->>'note',''),
         coalesce(o.payload->>'decision_note','')
    from public.app_records o
    join link on link.lid = o.payload->>'link_id' and link.farm_id = o.farm_id
   where o.entity_type = 'semen_reseller_order'
   order by o.updated_at desc
   limit 10;
$$;

-- 5) The public may call these three, and nothing else. RLS on app_records stays
--    untouched — these functions are the only way in, and each one is checked
--    against the token before it reads or writes a single row.
/* Every one of these reads public.app_records directly, and RLS on that table says an
   anonymous visitor may read nothing — which is exactly right. SECURITY DEFINER is what
   lets the four functions above do their one job while the policy stays closed: they run
   as the role that owns them (the one you are pasting this with), so keep that session as
   the farm's admin role. The verify query at the bottom prints prosecdef and owner for a
   reason: both must be right before you hand anyone a link. */
revoke all on function public.ars_order_shop(text)                           from public;
revoke all on function public.ars_order_catalog(text)                       from public;
revoke all on function public.ars_place_order(text, jsonb, text, text)      from public;
revoke all on function public.ars_order_status(text)                        from public;

grant execute on function public.ars_order_catalog(text)                  to anon, authenticated, service_role;
grant execute on function public.ars_order_shop(text)                     to anon, authenticated, service_role;
grant execute on function public.ars_place_order(text, jsonb, text, text) to anon, authenticated, service_role;
grant execute on function public.ars_order_status(text)                   to anon, authenticated, service_role;

-- 6) Verify ──────────────────────────────────────────────────────────────────
select p.proname as function, p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as owner,
       (select count(*) from pg_index i where i.indrelid = 'public.app_records'::regclass
          and pg_get_indexdef(i.indexrelid) like '%token%') as token_index_present
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('ars_order_shop','ars_order_catalog','ars_place_order','ars_order_status')
 order by 1;

-- Expected: 4 rows, security_definer = true, owner = postgres, token_index_present >= 1.
--
-- Then open the app → Reseller Center → a reseller → 🛒 Order link → Copy link.
-- Nothing else to install: the app creates the link row and reads orders back
-- through the same sync it already uses.
