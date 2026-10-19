#!/usr/bin/env bash
# Parallel-session proof (real separate backends) for the trial gate. Local throw-away DB only.
# usage: trial_abuse_concurrency.sh <database>
set -euo pipefail
db="${1:?database}"
case "${PGHOST:-}" in ""|/*|localhost|127.0.0.1|::1) ;; *) echo "refusing non-local PGHOST" >&2; exit 2 ;; esac
p() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" "$@"; }
h() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# Scenario 1: 8 parallel signups, SAME device cookie, 8 different emails, distinct IPs.
# Serialisation by advisory lock => exactly 1 ALLOW, exactly 1 REVIEW, the other 6 DENY.
ck=$(h cookie-par)
for n in 1 2 3 4 5 6 7 8; do
  ( p -c "select decision from fn_trial_signup_gate('enforce',1,'$(h par-mail-$n)','$ck',null,'$(h par-ip-$n)')" > "/tmp/par_$$_$n.out" ) &
done
wait
a=$(cat /tmp/par_$$_*.out | grep -c '^ALLOW$' || true); r=$(cat /tmp/par_$$_*.out | grep -c '^REVIEW$' || true); d=$(cat /tmp/par_$$_*.out | grep -c '^DENY$' || true)
rm -f /tmp/par_$$_*.out
echo "scenario1: allow=$a review=$r deny=$d"
[ "$a" = "1" ] && [ "$r" = "1" ] && [ "$d" = "6" ] || { echo "FAIL scenario1: expected 1 ALLOW, 1 REVIEW, 6 DENY"; exit 1; }
rows=$(p -c "select count(*) from prompter_trial_signup_attempts where cookie_hmac='$ck' and outcome='PENDING' and decision<>'DENY'")
[ "$rows" = "2" ] || { echo "FAIL scenario1: expected 2 pending rows, got $rows"; exit 1; }

# Scenario 2: 20 parallel attempts from ONE IP, every other identifier distinct.
# The atomic counter lets exactly 5 through (ip_hour limit), the other 15 are rate limited.
ip=$(h par-ip-shared)
for n in $(seq 1 20); do
  ( p -c "select decision||':'||coalesce(array_to_string(reasons,','),'') from fn_trial_signup_gate('enforce',1,'$(h q-mail-$n)','$(h q-ck-$n)','$(h q-dev-$n)','$ip')" > "/tmp/rl_$$_$n.out" ) &
done
wait
allow=$(cat /tmp/rl_$$_*.out | grep -c '^ALLOW:' || true)
lim=$(cat /tmp/rl_$$_*.out | grep -c '^DENY:RATE_IP_HOUR' || true)
rm -f /tmp/rl_$$_*.out
echo "scenario2: allow=$allow rate_limited=$lim"
[ "$allow" = "5" ] && [ "$lim" = "15" ] || { echo "FAIL scenario2: expected 5 allowed / 15 rate-limited"; exit 1; }
hits=$(p -c "select hits from prompter_trial_rate_buckets where scope='ip_hour' and key_hmac='$ip'")
[ "$hits" = "20" ] || { echo "FAIL scenario2: bucket should hold exactly 20 hits, got $hits"; exit 1; }

# Scenario 3: 10 parallel finalize calls on one PENDING attempt => exactly one transition.
id=$(p -c "select attempt_id from fn_trial_signup_gate('enforce',1,'$(h fin-mail)',null,null,null)")
for n in $(seq 1 10); do
  ( p -c "select fn_trial_signup_finalize('$id','00000000-0000-0000-0000-00000000aaaa',true)" > "/tmp/fin_$$_$n.out" ) &
done
wait
t=$(cat /tmp/fin_$$_*.out | grep -c '^t$' || true); rm -f /tmp/fin_$$_*.out
echo "scenario3: transitions=$t"
[ "$t" = "1" ] || { echo "FAIL scenario3: expected exactly one successful finalize"; exit 1; }
echo "CONCURRENCY PASS"
