import sys,re
src,dst=sys.argv[1],sys.argv[2]
s=open(src).read()
i=s.index("mk() {")
# end of the mk function: first "; }\n" after start (single logical statement)
j=s.index("; }\n",i)+4
body=s[i:j].replace("mk() {","mk_orig() {",1)
hook='''
# --- injeksi 4r (dibuat oleh supabase/tests/retention-vault/run-local.sh; BUKAN bagian suite asli): pasang 4r pada setiap DB uji ---
rv4r() { local db="$1"
  if [ "$(PA -d "$db" -c "select to_regclass('public.prompter_invoices') is null")" = t ]; then P -d "$db" -f "$root/supabase/migrations/20260901130513_prompter_billing_invoices.sql" >/dev/null || return 1; fi
  P -d "$db" -f "$root/supabase/migrations/20261128090000_prompter_retention_vault.sql" >/dev/null; }
mk() { mk_orig "$@" && rv4r "$1"; }
'''
s=s[:i]+body+hook+s[j:]
open(dst,'w').write(s)
