#!/usr/bin/env python3
"""Pemeriksaan STATIS berkas sandbox (tanpa database, tanpa jaringan). Exit 1 bila ada yang gagal.
  python3 tools/check_bundles.py
"""
import hashlib, json, pathlib, re, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent.parent
MIG = HERE.parent.parent / "migrations"
errs = []
def bad(m): errs.append(m)

man = json.loads((HERE / "MANIFEST.json").read_text())
files = sorted(MIG.glob("*.sql"))
listed = [m for p in man["parts"] for m in p["migrations"]]
if [m["file"] for m in listed] != [f.name for f in files]:
    bad("MANIFEST tidak sama dengan daftar/urutan supabase/migrations (jalankan tools/build_bundles.py)")
for m in listed:
    f = MIG / m["file"]
    if not f.exists() or hashlib.sha256(f.read_bytes()).hexdigest() != m["sha256"]:
        bad(f"sha256 migrasi berubah: {m['file']}")
for p in man["parts"]:
    b = HERE / p["bundle"]
    if not b.exists() or hashlib.sha256(b.read_bytes()).hexdigest() != p["bundle_sha256"]:
        bad(f"bundel tidak sinkron: {p['bundle']}")
        continue
    t = b.read_text()
    for m in p["migrations"]:
        if (MIG / m["file"]).read_text() not in t:
            bad(f"isi migrasi tidak persis di {p['bundle']}: {m['file']}")
    if t.count("begin;") < 1 or not t.rstrip().endswith("commit;"):
        bad(f"{p['bundle']} harus dibungkus begin; ... commit;")

PROD, OTP = "wjjyqovhmwenbcvbnkgx", "bmwpykwoylmzrbmbdeqw"
FORBID = [r"grant\s+postgres", r"set\s+role\s+postgres", r"supabase\s+db\s+push", r"postgres(ql)?://", r"eyJ[A-Za-z0-9_-]{20,}",
          r"sb_secret_", r"service_role_key", r"drop\s+schema", r"truncate\s", r"PAYMENT_LIVE_ENABLED"]
for f in sorted(HERE.glob("*.sql")):
    if f.name.startswith("10_"):
        continue  # isi migrasi diperiksa lewat sha256 di atas
    code = "\n".join(l for l in f.read_text().splitlines() if not l.strip().startswith("--"))
    for pat in FORBID:
        if re.search(pat, code, re.I):
            bad(f"{f.name}: pola terlarang /{pat}/")
    for ref in (PROD, OTP):
        if ref in code:
            bad(f"{f.name}: ref project terlarang di kode ({ref})")
for f in ("00_preflight_readonly.sql", "30_verify_readonly.sql", "tools/readonly_prod_definition_extract.sql"):
    code = "\n".join(l for l in (HERE / f).read_text().splitlines() if not l.strip().startswith("--"))
    code = re.sub(r"'(?:[^']|'')*'", "''", code)  # isi literal string (mis. 'insert' di has_table_privilege) bukan perintah
    if re.search(r"\b(insert|update|delete|create|drop|alter|grant|revoke|truncate|do\s+\$)\b", code, re.I):
        bad(f"{f} harus read-only (ada kata kunci tulis/DDL)")
if "begin;" not in (HERE / "99_rollback_sandbox.sql").read_text():
    bad("99_rollback harus transaksional")
if not re.search(r"raise exception[^;]*SMOKE_REPORT", (HERE / "31_smoke_checkout_apply_rollback.sql").read_text(), re.S):
    bad("31_smoke harus selalu berakhir dengan exception (rollback)")

for f in sorted(HERE.glob("[0-9]*.sql")):
    if "ref eskqngzhtndkfqjoxxou" not in "".join(f.read_text().splitlines(keepends=True)[:14]):
        bad(f"{f.name}: baris 'PROJECT YANG BENAR' (ref sandbox) hilang di header")
if not re.fullmatch(r"[a-z0-9]{20}", "eskqngzhtndkfqjoxxou"):
    bad("ref sandbox tidak valid")
rb = (HERE / "ANDROID_RUNBOOK.md").read_text()
if "eskqngzhtndkfqjoxxou" not in rb or "T0" not in rb:
    bad("ANDROID_RUNBOOK.md harus memuat ref sandbox dan tahap T0")
print("OK: semua pemeriksaan statis lulus" if not errs else "GAGAL:\n  " + "\n  ".join(errs))
sys.exit(1 if errs else 0)
