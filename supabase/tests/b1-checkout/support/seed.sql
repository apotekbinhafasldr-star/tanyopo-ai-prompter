-- LOCAL-ONLY synthetic seed, applied BEFORE B1, mirroring existing production shapes.
\set ON_ERROR_STOP on
insert into tenants(id,nama_usaha) values
  ('00000000-0000-0000-0000-0000000000a1','A active'),('00000000-0000-0000-0000-0000000000b1','B trialing'),
  ('00000000-0000-0000-0000-0000000000c1','P past due'),('00000000-0000-0000-0000-0000000000d1','C canceled'),
  ('00000000-0000-0000-0000-0000000000e1','N no subscription');
insert into user_profiles values
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','owner A','owner'),
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','mkt A','marketing'),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b1','owner B','owner'),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1','owner P','owner'),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d1','owner C','owner'),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e1','owner N','owner');
insert into prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end,billing_provider) values
  ('00000000-0000-0000-0000-0000000000a1','STARTER','ACTIVE',now()-interval '5 days',now()+interval '25 days','XENDIT'),
  ('00000000-0000-0000-0000-0000000000b1','FREE','TRIALING',now()-interval '1 day',now()+interval '13 days',null),
  ('00000000-0000-0000-0000-0000000000c1','PRO','PAST_DUE',now()-interval '40 days',now()-interval '10 days','XENDIT'),
  ('00000000-0000-0000-0000-0000000000d1','PRO','CANCELED',now()-interval '60 days',now()-interval '30 days','XENDIT');
-- legacy rows written by the old client path (prices differ from the new catalog on purpose: they must stay untouched)
insert into prompter_payment_transactions(id,tenant_id,user_id,provider,plan,amount,currency,status) values
  ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','XENDIT','PRO',299000,'IDR','PENDING'),
  ('00000000-0000-0000-0000-0000000e0002','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','XENDIT','BUSINESS',799000,'IDR','PENDING'),
  ('00000000-0000-0000-0000-0000000e0003','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','XENDIT','PRO',299000,'IDR','PENDING');
