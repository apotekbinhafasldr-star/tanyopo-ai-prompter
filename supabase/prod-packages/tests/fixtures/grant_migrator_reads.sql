-- SANDBOX: R1 "paling optimis": migrator dapat MEMBACA (select) tetapi tidak memiliki objek apa pun dan tidak anggota role pemilik.
grant usage on schema storage, supabase_migrations to linoe_migrator;
grant select on storage.objects, storage.buckets, public.fx_audit_logs, public.fx_evidence to linoe_migrator;
grant select, insert on supabase_migrations.schema_migrations to linoe_migrator;
