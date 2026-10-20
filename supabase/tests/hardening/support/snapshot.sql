-- pre-hardening snapshot used by the comparisons after the migration
create table t_pre as
 select 'subs'::text k, md5(string_agg(t::text, '' order by tenant_id)) v from prompter_subscriptions t
 union all
 select 'acl_other', md5(string_agg(c.relname || coalesce(c.relacl::text,''), '|' order by c.relname))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind = 'r' and c.relname !~ '^t_'
    and c.relname not in ('prompter_subscriptions','prompter_payment_transactions','prompter_invoices','prompter_webhook_events','prompter_audit_logs');
