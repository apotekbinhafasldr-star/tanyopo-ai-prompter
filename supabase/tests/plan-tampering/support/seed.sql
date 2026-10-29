-- LOCAL-ONLY seed (synthetic) applied BEFORE the migration, mirroring existing production rows. See run-local.sh.
\set ON_ERROR_STOP on
-- ids
\set tA 00000000-0000-0000-0000-0000000000a1
\set tB 00000000-0000-0000-0000-0000000000b1
\set tP 00000000-0000-0000-0000-0000000000c1
\set tC 00000000-0000-0000-0000-0000000000d1
\set oA 00000000-0000-0000-0000-0000000000a2
\set mA 00000000-0000-0000-0000-0000000000a3
\set oB 00000000-0000-0000-0000-0000000000b2
\set oP 00000000-0000-0000-0000-0000000000c2
\set oC 00000000-0000-0000-0000-0000000000d2

insert into tenants(id,nama_usaha) values (:'tA','A active'),(:'tB','B trialing'),(:'tP','P past due'),(:'tC','C canceled');
insert into user_profiles values
  (:'oA',:'tA','owner A','owner'),(:'mA',:'tA','mkt A','marketing'),(:'oB',:'tB','owner B','owner'),(:'oP',:'tP','owner P','owner'),(:'oC',:'tC','owner C','owner');
-- baseline subscriptions (inserted as the table owner, like the app's own server paths)
insert into prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end,billing_provider) values
  (:'tA','STARTER','ACTIVE',now()-interval '5 days',now()+interval '25 days','XENDIT'),
  (:'tB','FREE','TRIALING',now()-interval '1 day',now()+interval '13 days',null),
  (:'tP','PRO','PAST_DUE',now()-interval '40 days',now()-interval '10 days','XENDIT'),
  (:'tC','PRO','CANCELED',now()-interval '60 days',now()-interval '30 days','XENDIT');

insert into prompter_payment_transactions(id,tenant_id,user_id,provider,plan,amount,currency,status) values
  ('00000000-0000-0000-0000-0000000e0001',:'tB',:'oB','XENDIT','PRO',299000,'IDR','PENDING'),
  ('00000000-0000-0000-0000-0000000e0002',:'tA',:'oA','XENDIT','BUSINESS',799000,'IDR','PENDING'),
  ('00000000-0000-0000-0000-0000000e0003',:'tP',:'oP','XENDIT','PRO',299000,'IDR','PENDING');
