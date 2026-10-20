-- ROLLBACK for 20261020190000_prompter_privilege_hardening_phase1.sql
-- Restores EXACTLY the pre-Phase-1 grants that the audited production catalog showed
-- (Supabase default privileges on the 35 pre-existing prompter_* tables).
-- WARNING: this RE-OPENS TRUNCATE and anon access. Use only if Phase 1 breaks a verified flow.
-- NOT placed in supabase/migrations on purpose (never auto-applied).
-- prompter_demo_ai_usage (own migration revoked everything) and prompter_manual_ad_metrics
-- (own migration grants S/I/U/D to authenticated only) are intentionally NOT restored.
-- CAVEAT: this restores the DEFAULT-privilege state. If PR #31 / #44 / #45 were applied on top of Phase 1,
-- this script re-opens what they closed on the same tables. RE-RUN their migrations right afterwards
-- (they are idempotent REVOKEs); the local test suite proves rollback + re-run == exact pre-Phase-1 state.

do $down$
declare
  t text;
  c_legacy text[] := array[
    'prompter_ai_jobs','prompter_analytics_insights','prompter_approvals','prompter_attributions',
    'prompter_audit_logs','prompter_automation_settings','prompter_autopilot_policies',
    'prompter_brand_profiles','prompter_budget_policies','prompter_channel_campaigns',
    'prompter_compliance_flags','prompter_connected_accounts','prompter_content_items',
    'prompter_conversions','prompter_feature_flags','prompter_follower_snapshots',
    'prompter_growth_goals','prompter_invoices','prompter_jobs','prompter_marketing_blueprints',
    'prompter_marketing_metrics','prompter_master_campaigns','prompter_oauth_credentials',
    'prompter_optimization_recommendations','prompter_payment_transactions',
    'prompter_plan_entitlements','prompter_platform_capabilities','prompter_product_media',
    'prompter_product_snapshots','prompter_products','prompter_promotion_handoffs',
    'prompter_seo_projects','prompter_seo_recommendations','prompter_subscriptions',
    'prompter_webhook_events'
  ];
begin
  perform set_config('lock_timeout', '5s', true);
  foreach t in array c_legacy loop
    continue when to_regclass('public.' || t) is null;
    if t = 'prompter_subscriptions' then
      -- production state: no table-level UPDATE (column-level UPDATE(plan) is separate and untouched)
      execute 'grant select, insert, delete, truncate on public.prompter_subscriptions to anon, authenticated';
    else
      execute format('grant select, insert, update, delete, truncate on public.%I to anon, authenticated', t);
    end if;
  end loop;
end
$down$;
