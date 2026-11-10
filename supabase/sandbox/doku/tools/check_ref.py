#!/usr/bin/env python3
"""Validasi FORMAT ref project Supabase untuk allow-list guard (offline, tanpa jaringan).
  python3 tools/check_ref.py <ref>
Mencerminkan lib/billing/providers/doku-sandbox-db-guard.ts: ^[a-z0-9]{20}$, bukan ref production."""
import re, sys
PROD = {"wjjyqovhmwenbcvbnkgx"}
OTP = {"bmwpykwoylmzrbmbdeqw"}  # dilarang disentuh untuk tugas ini (bukan bagian guard di kode)
r = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
print(f"ref='{r}' panjang={len(r)}")
ok = True
if not re.fullmatch(r"[a-z0-9]{20}", r):
    print("FAIL: harus tepat 20 karakter a-z0-9 (guard menolak selain itu)"); ok = False
if r in PROD: print("FAIL: ref PRODUCTION"); ok = False
if r in OTP: print("FAIL: ref linoe-otp-test (dilarang untuk sandbox ini)"); ok = False
print("PASS (format)" if ok else "FAIL")
sys.exit(0 if ok else 1)
