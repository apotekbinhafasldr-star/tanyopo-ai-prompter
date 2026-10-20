#!/usr/bin/env python3
"""Print the REAL pre-existing function bodies from the repository migrations (no re-typing)."""
import sys
root = sys.argv[1]
b10 = open(f"{root}/supabase/migrations/20260915051359_prompter_b10_payment_billing_core.sql").read()
a = b10.index("create or replace function public.fn_apply_verified_payment")
b = b10.index("comment on function public.fn_apply_verified_payment")
lc = open(f"{root}/supabase/migrations/20260926113000_prompter_payment_lifecycle_remediation.sql").read()
c = lc.index("create or replace function public.fn_expire_stale_payment_transactions")
d = lc.index("comment on function public.fn_expire_stale_payment_transactions")
print(b10[a:b])
print(lc[c:d])
