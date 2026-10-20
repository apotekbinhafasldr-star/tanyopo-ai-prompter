-- LINOE — Database privilege hardening, PHASE 1 (additive, per table, REVOKE-only).
--
-- WHY: Supabase default privileges grant ALL (incl. TRUNCATE) on every new public table to
-- anon / authenticated / service_role. Production catalog audit (read-only, 2026-10-20) showed that
-- all 36 prompter_* tables then in production still carry those defaults (only demo_ai_usage was
-- already locked down). Row Level Security governs only SELECT/INSERT/UPDATE/DELETE; TRUNCATE ignores RLS entirely, and anon has no legitimate use of any
-- prompter_* table (every LINOE data path is either a logged-in session or the service-role client).
--
-- WHAT (nothing else):
--   B  REVOKE TRUNCATE from PUBLIC, anon, authenticated on every prompter_* table.
--   C  REVOKE ALL from anon on every prompter_* table (no public/anonymous flow depends on them:
--      all reads go through requireSessionContext() or the admin client; webhooks/cron/jobs/OAuth
--      callbacks/demo use service_role or SECURITY DEFINER functions).
--   D  Tables whose policies only ever allow SELECT: REVOKE INSERT/UPDATE/DELETE from authenticated
--      (invoices, jobs, plan_entitlements, platform_capabilities, product_snapshots, webhook_events).
--   E  Evidence tables: audit_logs, payment_transactions -> REVOKE UPDATE, DELETE from authenticated;
--      subscriptions -> REVOKE DELETE from authenticated.
--   H  prompter_oauth_credentials: RLS-with-zero-policies today; REVOKE ALL from authenticated
--      (only the service-role OAuth callback touches it).
--
-- WHAT IS DELIBERATELY NOT TOUCHED (Phase 1 scope):
--   * prompter_ai_jobs UPDATE/DELETE/INSERT (services/ai-jobs.ts still completes/deletes job rows
--     with the user client)                                      -> only TRUNCATE is revoked.
--   * prompter_payment_transactions INSERT (services/checkout.ts)  -> depends on PR #44 / #45.
--   * prompter_subscriptions INSERT and column-level UPDATE(plan)  -> depends on PR #45.
--   * prompter_audit_logs INSERT (user-client audit writes in features/*).
--   * ALTER DEFAULT PRIVILEGES (schema-wide, would affect sibling products on this shared database).
--   * Any table that is not prompter_* ; any data; any policy; any function.
--
-- SAFETY:
--   * Pure REVOKE: idempotent, no data/RLS/policy/function/ownership change, no rewrite.
--   * Tables that do not exist yet (e.g. prompter_manual_ad_metrics before Phase 2B) are skipped.
--   * Fail-closed post-checks inside the same transaction: (1) TRUNCATE/anon are gone everywhere,
--     (2) any privilege that authenticated held before and is NOT in the explicit removal list is
--     still held after (so this migration cannot silently break an existing flow, nor undo anything
--     done by PR #31 / #44 / #45 regardless of apply order). Any violation aborts the migration.
--   * Foreign-key cascades (tenant deletion) run as the table owner and are unaffected.
--   * Rollback: supabase/rollback/20261020190000_prompter_privilege_hardening_phase1.down.sql
--
-- Compatible with, and independent of, PR #31, #44, #45: every statement here is a subset of, or
-- disjoint from, what those PRs revoke, and REVOKE is order-independent.

do $phase1$
declare
  c_all text[] := array[
    'prompter_ai_jobs','prompter_analytics_insights','prompter_approvals','prompter_attributions',
    'prompter_audit_logs','prompter_automation_settings','prompter_autopilot_policies',
    'prompter_brand_profiles','prompter_budget_policies','prompter_channel_campaigns',
    'prompter_compliance_flags','prompter_connected_accounts','prompter_content_items',
    'prompter_conversions','prompter_demo_ai_usage','prompter_feature_flags',
    'prompter_follower_snapshots','prompter_growth_goals','prompter_invoices','prompter_jobs',
    'prompter_manual_ad_metrics','prompter_marketing_blueprints','prompter_marketing_metrics',
    'prompter_master_campaigns','prompter_oauth_credentials','prompter_optimization_recommendations',
    'prompter_payment_transactions','prompter_plan_entitlements','prompter_platform_capabilities',
    'prompter_product_media','prompter_product_snapshots','prompter_products',
    'prompter_promotion_handoffs','prompter_seo_projects','prompter_seo_recommendations',
    'prompter_subscriptions','prompter_webhook_events'
  ];
  -- (table, privilege) pairs that THIS migration is allowed to remove from authenticated.
  c_select_only text[] := array[
    'prompter_invoices','prompter_jobs','prompter_plan_entitlements',
    'prompter_platform_capabilities','prompter_product_snapshots','prompter_webhook_events'
  ];
  c_privs text[] := array['SELECT','INSERT','UPDATE','DELETE'];
  t text;
  p text;
  before_state jsonb := '{}'::jsonb;
  allowed_removal boolean;
  had boolean;
  has_now boolean;
  v_plan_col_before boolean;
begin
  perform set_config('lock_timeout', '5s', true);   -- transaction-local; fail fast instead of queueing behind traffic

  -- ---- snapshot of what authenticated can do today (existing tables only) -----------------
  foreach t in array c_all loop
    continue when to_regclass('public.' || t) is null;
    foreach p in array c_privs loop
      before_state := before_state || jsonb_build_object(
        t || ':' || p, has_table_privilege('authenticated', 'public.' || t, p));
    end loop;
  end loop;
  if to_regclass('public.prompter_subscriptions') is not null then
    v_plan_col_before := has_column_privilege('authenticated', 'public.prompter_subscriptions', 'plan', 'UPDATE');
  end if;

  -- ---- B + C : TRUNCATE for everyone but the owner / service_role; anon gets nothing ---------
  foreach t in array c_all loop
    continue when to_regclass('public.' || t) is null;
    execute format('revoke truncate on public.%I from public, anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;

  -- ---- D : tables whose policies only allow SELECT -------------------------------------------
  foreach t in array c_select_only loop
    continue when to_regclass('public.' || t) is null;
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;

  -- ---- E : audit + financial evidence ---------------------------------------------------------
  if to_regclass('public.prompter_audit_logs') is not null then
    revoke update, delete on public.prompter_audit_logs from authenticated;
  end if;
  if to_regclass('public.prompter_payment_transactions') is not null then
    revoke update, delete on public.prompter_payment_transactions from authenticated;
  end if;
  if to_regclass('public.prompter_subscriptions') is not null then
    -- DELETE only. Never "revoke update" at table level here: that would also drop the
    -- column-level UPDATE(plan) grant that the existing changePlan() flow depends on.
    revoke delete on public.prompter_subscriptions from authenticated;
  end if;

  -- ---- H : OAuth credential vault is service-role only ---------------------------------------
  if to_regclass('public.prompter_oauth_credentials') is not null then
    revoke all on public.prompter_oauth_credentials from authenticated;
  end if;

  -- ---- fail-closed post-checks -----------------------------------------------------------------
  foreach t in array c_all loop
    continue when to_regclass('public.' || t) is null;

    if has_table_privilege('anon', 'public.' || t, 'TRUNCATE')
       or has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') then
      raise exception 'phase1 post-check failed: TRUNCATE still granted on %', t;
    end if;
    foreach p in array c_privs loop
      if has_table_privilege('anon', 'public.' || t, p) then
        raise exception 'phase1 post-check failed: anon still has % on %', p, t;
      end if;
    end loop;

    foreach p in array c_privs loop
      had := coalesce((before_state ->> (t || ':' || p))::boolean, false);
      has_now := has_table_privilege('authenticated', 'public.' || t, p);
      allowed_removal :=
           (t = any (c_select_only) and p in ('INSERT','UPDATE','DELETE'))
        or (t in ('prompter_audit_logs','prompter_payment_transactions') and p in ('UPDATE','DELETE'))
        or (t = 'prompter_subscriptions' and p = 'DELETE')
        or (t = 'prompter_oauth_credentials');
      if had and not has_now and not allowed_removal then
        raise exception 'phase1 post-check failed: unexpected loss of % on % for authenticated', p, t;
      end if;
      if has_now and not had then
        raise exception 'phase1 post-check failed: % gained % on %', 'authenticated', p, t;
      end if;
    end loop;
  end loop;

  if to_regclass('public.prompter_subscriptions') is not null
     and v_plan_col_before is distinct from has_column_privilege('authenticated', 'public.prompter_subscriptions', 'plan', 'UPDATE') then
    raise exception 'phase1 post-check failed: column-level UPDATE(plan) on prompter_subscriptions changed';
  end if;
end
$phase1$;
