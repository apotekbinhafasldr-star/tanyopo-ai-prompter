-- LOCAL/CI-ONLY regression test for the trial anti-abuse migration (throwaway database only).
-- Runs after support/prod_snapshot.sql + the three P0 migrations + 20261019110000 (see run-local.sh abuse).
\set ON_ERROR_STOP on
create temp table if not exists results(name text, ok boolean);
grant all on results to public;

create or replace function pg_temp.h(s text) returns text language sql immutable as
  $$ select encode(sha256(convert_to(s,'utf8')),'hex') $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, false); end $$;
create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.grant_count(n int) returns int language plpgsql as $$
declare i int; granted int := 0; ok boolean;
begin
  for i in 1..n loop
    select allowed into ok from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb);
    if ok then granted := granted + 1; end if;
  end loop; return granted;
end $$;
-- gate wrapper: mode, email n, cookie n (0 = none), device n (0 = none), ip n (0 = none)
create or replace function pg_temp.gate(mode text, e int, c int, d int, i int)
returns table(decision text, attempt_id uuid, risk_score int, reasons text[], retry int) language sql as $$
  select * from public.fn_trial_signup_gate(mode, 1, pg_temp.h('e'||e),
    case when c=0 then null else pg_temp.h('c'||c) end,
    case when d=0 then null else pg_temp.h('d'||d) end,
    case when i=0 then null else pg_temp.h('i'||i) end) $$;
grant execute on function pg_temp.h(text), pg_temp.as_user(text), pg_temp.try(text), pg_temp.grant_count(int),
  pg_temp.gate(text,int,int,int,int) to public;

-- fixtures
insert into tenants(id,nama_usaha) values
  ('00000000-0000-0000-0000-0000000000e1','held tenant'),('00000000-0000-0000-0000-0000000000e2','other tenant'),
  ('00000000-0000-0000-0000-0000000000e3','clean tenant'),('00000000-0000-0000-0000-0000000000e4','bystander tenant');
insert into user_profiles values
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1','u1','owner'),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e2','u2','owner'),
  ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000e3','u3','owner'),
  ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000e4','u4','owner');

-- ---------- privileges: nothing reachable from tenants ----------
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.try($q$select * from prompter_trial_signup_attempts$q$) as a1,
       pg_temp.try($q$insert into prompter_trial_rate_buckets values ('x',repeat('a',64),now(),60,1,now())$q$) as a2,
       pg_temp.try($q$truncate prompter_trial_signup_attempts$q$) as a3,
       pg_temp.try($q$select * from fn_trial_signup_gate('enforce',1,repeat('a',64),null,null,null)$q$) as a4,
       pg_temp.try($q$select fn_trial_release_hold('00000000-0000-0000-0000-000000000000','long enough')$q$) as a5,
       pg_temp.try($q$select fn_trial_abuse_purge(10)$q$) as a6,
       pg_temp.try($q$select fn_trial_signup_finalize(null,null,false)$q$) as a7,
       pg_temp.try($q$select * from fn_trial_bucket_hit('x',repeat('a',64),60)$q$) as a8
  into temp table priv_auth;
reset role;
set role anon;
select pg_temp.try($q$select * from prompter_trial_signup_attempts$q$) as b1,
       pg_temp.try($q$select * from fn_trial_signup_gate('enforce',1,repeat('a',64),null,null,null)$q$) as b2,
       pg_temp.try($q$select fn_trial_hold_active('00000000-0000-0000-0000-0000000000e1')$q$) as b3
  into temp table priv_anon;
reset role;
insert into results select 'S1 authenticated cannot read/write/truncate ledger tables or execute any service function',
  (select a1<>'ok' and a2<>'ok' and a3<>'ok' and a4<>'ok' and a5<>'ok' and a6<>'ok' and a7<>'ok' and a8<>'ok' from priv_auth);
insert into results select 'S2 anon cannot read ledger, run the gate, or call the hold check',
  (select b1<>'ok' and b2<>'ok' and b3<>'ok' from priv_anon);

-- ---------- gate decisions (service_role) ----------
set role service_role;
create temp table g as select 'g1' k, (pg_temp.gate('enforce',1,1,1,1)).*;   -- first signup on a fresh device
select fn_trial_signup_finalize((select attempt_id from g where k='g1'),'00000000-0000-0000-0000-0000000000e1',true) as fin1 into temp table f1;
insert into g select 'g2', (pg_temp.gate('enforce',2,1,2,2)).*;               -- NEW email, SAME cookie
select fn_trial_signup_finalize((select attempt_id from g where k='g2'),'00000000-0000-0000-0000-0000000000e2',true) into temp table f2;
insert into g select 'g3', (pg_temp.gate('enforce',3,1,3,3)).*;               -- third email, same cookie
insert into g select 'g4', (pg_temp.gate('shadow',4,5,5,5)).*;               -- unrelated: clean
insert into g select 'g5a', (pg_temp.gate('enforce',600,600,600,600)).*;
insert into g select 'g5', (pg_temp.gate('enforce',600,600,600,600)).*;      -- SAME email retry (not another trial)
reset role;
insert into results select 'G1 first signup is ALLOW with score 0', (select decision='ALLOW' and risk_score=0 from g where k='g1');
insert into results select 'G2 same device cookie + new email => REVIEW (hold set, score 50)',
  (select decision='REVIEW' and risk_score=50 and 'COOKIE_REPEAT_1'=any(reasons) from g where k='g2')
  and (select trial_hold from prompter_trial_signup_attempts where id=(select attempt_id from g where k='g2'));
insert into results select 'G3 third email on the same cookie => DENY (re-registration with different emails)',
  (select decision='DENY' and risk_score>=100 from g where k='g3');
insert into results select 'G4 unrelated visitor => ALLOW', (select decision='ALLOW' from g where k='g4');
insert into results select 'G5 same email retrying is not counted as a repeat trial', (select decision='ALLOW' and risk_score=0 from g where k='g5');
insert into results select 'G6 DENY rows never count as trial starts and carry no hold',
  (select outcome='ABORTED' and not trial_hold from prompter_trial_signup_attempts where id=(select attempt_id from g where k='g3'));

-- shadow mode records but never holds
set role service_role;
create temp table s as select 'sh1' k, (pg_temp.gate('shadow',40,40,40,40)).*;
select fn_trial_signup_finalize((select attempt_id from s where k='sh1'),'00000000-0000-0000-0000-0000000000f1',true) into temp table fs;
insert into s select 'sh2', (pg_temp.gate('shadow',41,40,41,41)).*;
reset role;
insert into results select 'G7 shadow mode computes REVIEW but sets no hold and is marked shadow',
  (select decision='REVIEW' from s where k='sh2')
  and (select not trial_hold and shadow from prompter_trial_signup_attempts where id=(select attempt_id from s where k='sh2'));

-- weak signals alone can never DENY: the maximum reachable without the device cookie is 60 (REVIEW).
-- Seed 9 earlier signups (30-day window) on one device + one IP, none with a cookie, then a 10th email.
insert into prompter_trial_signup_attempts(key_version,email_hmac,device_hmac,ip_hmac,decision,outcome,user_id)
  select 1, pg_temp.h('nat'||n), pg_temp.h('d60'), pg_temp.h('i60'), 'ALLOW', 'SIGNED_UP', gen_random_uuid()
  from generate_series(1,9) n;
set role service_role;
create temp table w as select (pg_temp.gate('enforce',120,0,60,60)).*;
reset role;
insert into results select 'G8 device(9 others)+IP(9 others) with no cookie => REVIEW at most (score 60), never DENY (shared NAT/office)',
  (select decision='REVIEW' and risk_score=60 from w);

-- different legitimate users sharing ONE device or IP once are not penalised beyond ALLOW
set role service_role;
create temp table fp as select (pg_temp.gate('enforce',200,0,70,70)).*;
select fn_trial_signup_finalize((select attempt_id from fp),gen_random_uuid(),true) into temp table fpf;
create temp table fp2 as select (pg_temp.gate('enforce',201,201,70,70)).*;
reset role;
insert into results select 'G9 two different people on the same device/IP (own cookies) => ALLOW (no false positive)',
  (select decision='ALLOW' from fp2);

-- aborted attempts do not count (typo retry, existing account)
set role service_role;
create temp table ab as select (pg_temp.gate('enforce',300,300,300,300)).*;
select fn_trial_signup_finalize((select attempt_id from ab),null,false) into temp table abf;
create temp table ab2 as select (pg_temp.gate('enforce',301,300,301,301)).*;
reset role;
insert into results select 'G10 an aborted signup attempt never makes the next email look like a repeat', (select decision='ALLOW' from ab2);

-- stale PENDING attempts expire from the repeat window after 15 minutes
set role service_role;
create temp table st as select (pg_temp.gate('enforce',400,400,400,400)).*;
reset role;
update prompter_trial_signup_attempts set created_at = now() - interval '20 minutes' where id=(select attempt_id from st);
set role service_role;
create temp table st2 as select (pg_temp.gate('enforce',401,400,401,401)).*;
reset role;
insert into results select 'G11 an abandoned PENDING attempt (>15 min) does not count', (select decision='ALLOW' from st2);

-- persistent atomic rate limit: 5 per IP-hour, 6th denied with retry-after; denied hits write no ledger row
set role service_role;
create temp table rl as
  select i, (pg_temp.gate('enforce', 500+i, 500+i, 500+i, 77)).* from generate_series(1,8) i;
reset role;
insert into results select 'R1 first 5 attempts from one IP-hour pass, attempts 6-8 are RATE_IP_HOUR with retry>0',
  (select count(*)=5 from rl where decision='ALLOW') and (select count(*)=3 from rl where decision='DENY' and 'RATE_IP_HOUR'=any(reasons) and retry>0 and attempt_id is null);
insert into results select 'R2 rate-limited attempts wrote no ledger rows (no write amplification)',
  (select count(*)=5 from prompter_trial_signup_attempts where ip_hmac=pg_temp.h('i77'));

-- input validation: raw values are rejected at the database boundary
select pg_temp.try($q$select * from public.fn_trial_signup_gate('enforce',1,'someone@example.com',null,null,null)$q$) as raw1 into temp table v1;
select pg_temp.try($q$select * from public.fn_trial_signup_gate('off',1,repeat('a',64),null,null,null)$q$) as raw2 into temp table v2;
select pg_temp.try($q$insert into prompter_trial_signup_attempts(key_version,email_hmac,decision) values (1,'203.0.113.9','ALLOW')$q$) as raw3 into temp table v3;
insert into results select 'V1 raw email/IP and unknown mode are rejected (fail closed)',
  (select raw1<>'ok' from v1) and (select raw2<>'ok' from v2) and (select raw3<>'ok' from v3);
insert into results select 'V2 ledger has no raw email/ip/user-agent column',
  not exists (select 1 from information_schema.columns where table_schema='public'
    and table_name in ('prompter_trial_signup_attempts','prompter_trial_rate_buckets')
    and column_name in ('email','ip','ip_address','user_agent','fingerprint','raw'));

-- ---------- hold enforcement at subscription creation + tenant isolation ----------
-- tenant e1's user is linked to a REVIEW hold; give e1 a held attempt directly (finalized signup)
insert into prompter_trial_signup_attempts(key_version,email_hmac,cookie_hmac,decision,outcome,user_id,trial_hold,risk_score,reasons)
  values (1,pg_temp.h('held-e'),pg_temp.h('held-c'),'REVIEW','SIGNED_UP','00000000-0000-0000-0000-0000000000e1',true,50,'{COOKIE_REPEAT_1}')
  returning id as held_id \gset
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end)
  values ('00000000-0000-0000-0000-0000000000e1','TRIALING','FREE',now(),now()+interval '99 days');
select pg_temp.grant_count(5) as held_granted into temp table hg;
select reason as held_reason into temp table hr from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb);
select fn_trial_hold_active('00000000-0000-0000-0000-0000000000e1') as self_view into temp table hv;
reset role;
insert into results select 'H1 held tenant: client-created trial is already expired => 0 AI jobs, TRIAL_EXPIRED (cannot self-extend)',
  (select held_granted from hg)=0 and (select held_reason from hr)='TRIAL_EXPIRED'
  and (select current_period_end < created_at from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000e1');
insert into results select 'H2 hold check answers for own tenant only', (select self_view from hv);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e4');
select fn_trial_hold_active('00000000-0000-0000-0000-0000000000e1') as probe into temp table hp;
insert into prompter_subscriptions(tenant_id,status,plan,current_period_start,current_period_end)
  values ('00000000-0000-0000-0000-0000000000e4','TRIALING','FREE',now(),now());
select pg_temp.grant_count(31) as other_granted into temp table og;
reset role;
insert into results select 'H3 cross-tenant: another tenant cannot probe a hold, and is unaffected (normal 14d trial, quota 30)',
  not (select probe from hp)
  and (select other_granted from og)=30
  and (select current_period_end - created_at between interval '13 days 23 hours' and interval '14 days 1 hour'
         from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000e4');

-- inert when the ledger has nothing for the tenant (feature never used)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
insert into prompter_subscriptions(tenant_id,status,plan) values ('00000000-0000-0000-0000-0000000000e3','TRIALING','FREE');
reset role;
insert into results select 'H4 tenant with no ledger row gets the normal 14-day trial (feature inert)',
  (select current_period_end - created_at between interval '13 days 23 hours' and interval '14 days 1 hour'
     from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000e3');

-- ---------- false-positive recovery ----------
set role service_role;
select pg_temp.try(format($q$select fn_trial_release_hold(%L,'x')$q$, :'held_id')) as shortreason into temp table rr0;
select * into temp table rel from fn_trial_release_hold(:'held_id'::uuid, 'verified by support: shared family device');
select * into temp table rel2 from fn_trial_release_hold(:'held_id'::uuid, 'second attempt should be a no-op');
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.grant_count(31) as rel_granted into temp table rg;
select fn_trial_hold_active('00000000-0000-0000-0000-0000000000e1') as still_held into temp table sh;
reset role;
insert into results select 'F1 release needs a reason; releasing restores a normal 14-day trial (30 jobs usable); second release is a no-op',
  (select shortreason<>'ok' from rr0)
  and (select released and subscriptions_restored=1 from rel) and not (select released from rel2)
  and (select rel_granted from rg)=30 and not (select still_held from sh)
  and (select current_period_end > now() + interval '13 days' from prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000e1');

-- ---------- retention ----------
update prompter_trial_signup_attempts set expires_at = now() - interval '1 day' where cookie_hmac = pg_temp.h('c1');
update prompter_trial_rate_buckets set expires_at = now() - interval '1 day';
set role service_role;
select fn_trial_abuse_purge(1000) as purged into temp table pg_;
reset role;
insert into results select 'T1 expired ledger rows and buckets are purged; unexpired rows kept',
  (select purged from pg_) >= 3
  and not exists (select 1 from prompter_trial_signup_attempts where cookie_hmac = pg_temp.h('c1'))
  and exists (select 1 from prompter_trial_signup_attempts where cookie_hmac = pg_temp.h('c40'));

select name, case when ok then 'PASS' else 'FAIL' end as result from results order by name;
select case when bool_and(coalesce(ok,false)) then 'ALL PASS' else 'FAILURES PRESENT' end as summary from results;
do $$ begin
  if exists (select 1 from results where not coalesce(ok,false)) then raise exception 'trial abuse: FAILURES PRESENT'; end if;
end $$;
