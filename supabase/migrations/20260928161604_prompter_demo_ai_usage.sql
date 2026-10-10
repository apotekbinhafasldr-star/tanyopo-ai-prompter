-- LINOE Demo Account & Safe Trial Environment -- Phase 1 implementation.
-- Founder-approved 2026-09-28 (see engagement checkpoint
-- LINOE_DEMO_DESIGN_READY_FOR_FOUNDER_REVIEW -> Founder Decision).
--
-- PREPARED FOR REVIEW ONLY. NOT APPLIED TO PRODUCTION BY THIS CHANGE.
--
-- Architecture note (why this table has no tenant_id and no RLS
-- tenant policy, unlike every other prompter_* table in this schema):
-- the Founder's approved design is an ISOLATED PER-SESSION demo, not a
-- shared demo tenant ("Jika desain audit menunjukkan isolated per-session
-- state lebih aman, gunakan pendekatan tersebut. Security lebih penting
-- daripada convenience."). A demo visitor never authenticates through
-- Supabase auth and is never given a row in `tenants`/`user_profiles`
-- (those are owned and provisioned by an external system -- see this
-- repo's own foundation-schema migration docstring). There is therefore
-- no `fn_current_tenant_id()` to scope this table by, and nothing here
-- can be reached through, or interfere with, the real tenant/RLS model
-- used by every other prompter_* table.
--
-- This table's only job is enforcing the Founder's hard AI-usage cap
-- ("real AI wajib mempunyai hard usage cap ... Demo tidak boleh
-- menghasilkan API cost tanpa batas") across serverless instances --
-- lib/rate-limit.ts is explicitly documented as process-local and not
-- sufficient alone for that guarantee. It stores nothing about any real
-- tenant, product, campaign, or person: only an opaque, server-generated
-- demo session id and a call counter.
--
-- No cron job is created or scheduled by this migration. A demo session
-- is bounded to 30 minutes by lib/demo/session.ts's own signed-token
-- expiry (verified in application code on every request, never trusted
-- from the client) -- stale rows here are inert (their counter is simply
-- never looked up again once the session token expires) and harmless to
-- leave in place; a periodic cleanup, if ever wanted, is a separate,
-- explicitly-approved change per the Founder's cron STOP condition
-- ("Jangan membuat cron production baru kecuali benar-benar diperlukan.
-- Jika cron diperlukan, STOP dan minta approval Founder terpisah.").

create table if not exists public.prompter_demo_ai_usage (
  session_id text primary key,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint prompter_demo_ai_usage_used_count_nonnegative check (used_count >= 0)
);

comment on table public.prompter_demo_ai_usage is
  'LINOE Demo Environment Phase 1 -- per-demo-session real-AI call counter, enforcing the Founder-required hard usage cap. Not tenant-scoped: demo sessions are never a real tenant. Written to only via fn_consume_demo_ai_usage() through the service-role admin client (lib/supabase/admin.ts) from lib/demo/ai-usage.ts -- never from a client-authenticated request.';

-- RLS enabled with zero policies: deny-by-default for anon/authenticated
-- alike. Only the service-role admin client (which bypasses RLS
-- entirely, same as every other admin-only write path in this codebase,
-- e.g. features/campaigns/launch-actions.ts's oauth-credential lookups)
-- ever touches this table. This mirrors the "no anon/authenticated
-- access, service-role or SECURITY DEFINER only" pattern used for every
-- other sensitive table/function in this schema.
alter table public.prompter_demo_ai_usage enable row level security;

revoke all on public.prompter_demo_ai_usage from anon, authenticated;

create or replace function public.fn_consume_demo_ai_usage(p_session_id text, p_hard_cap integer)
returns table(allowed boolean, used_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used_count integer;
begin
  if p_session_id is null or length(trim(p_session_id)) = 0 then
    return query select false, 0;
    return;
  end if;

  -- Single atomic upsert-and-increment: a demo session's first real-AI
  -- call creates its row at count 1, every call after increments it.
  -- Concurrent requests from the same session id serialize on the
  -- underlying row lock, so this cannot be raced past the hard cap the
  -- way a separate check-then-insert could.
  insert into public.prompter_demo_ai_usage (session_id, used_count, last_used_at)
  values (p_session_id, 1, now())
  on conflict (session_id) do update
    set used_count = public.prompter_demo_ai_usage.used_count + 1,
        last_used_at = now()
  returning public.prompter_demo_ai_usage.used_count into v_used_count;

  if v_used_count > p_hard_cap then
    -- Already over the cap: record the attempt (so a determined abuser's
    -- counter keeps climbing rather than getting "free" retries at the
    -- exact cap boundary) but deny it.
    return query select false, v_used_count;
    return;
  end if;

  return query select true, v_used_count;
end;
$$;

comment on function public.fn_consume_demo_ai_usage(text, integer) is
  'LINOE Demo Environment Phase 1 -- atomically consumes one unit of a demo session''s hard AI-usage cap. Takes no tenant identity (there is none for a demo session) and derives nothing from auth.uid(); the session id itself is the opaque, server-issued identifier from lib/demo/session.ts. Fails closed: any caller error is treated by lib/demo/ai-usage.ts as not-allowed.';

-- Same "service-role/SECURITY DEFINER only" boundary as the table itself.
revoke all on function public.fn_consume_demo_ai_usage(text, integer) from public, anon, authenticated;
