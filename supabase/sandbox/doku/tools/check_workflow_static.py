#!/usr/bin/env python3
"""Static self-check for the DOKU sandbox runner workflow + script. Exits 1 on the first violated safety property.
Usage: python3 check_workflow_static.py            (paths resolved relative to this file's repo checkout)"""
import os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
wf_path = os.path.join(root, ".github", "workflows", "doku-sandbox-runner.yml")
rn_path = os.path.join(here, "run_sandbox.sh")
errors = []

def need(cond, msg):
    if not cond: errors.append(msg)

wf = open(wf_path, encoding="utf-8").read() if os.path.exists(wf_path) else ""
rn = open(rn_path, encoding="utf-8").read()
code = "\n".join(l for l in wf.splitlines() if not l.lstrip().startswith("#"))
if wf:
    need(re.search(r"^on:\s*\n\s+workflow_dispatch:", code, re.M), "harus workflow_dispatch")
    need(not re.search(r"^\s+(push|pull_request|pull_request_target|schedule|workflow_run):", code, re.M), "tidak boleh pemicu otomatis")
    need("github.ref == 'refs/heads/main'" in code, "job harus dibatasi ke main")
    need("environment: doku-sandbox" in code, "harus memakai Environment doku-sandbox")
    need("check_approval.py" in code, "harus membuktikan persetujuan Environment")
    need(len(re.findall(r"secrets\.", code)) == 1 and "secrets.DOKU_DB_PASSWORD" in code, "hanya satu secret: DOKU_DB_PASSWORD")
    need(not re.search(r"MIGRATION_DB|SERVICE_ROLE|service_role|SUPABASE_ACCESS_TOKEN", code), "tidak boleh menyentuh rahasia production")
    need(not re.search(r"\buses:\s*(?!actions/)", code) and "uses:" not in code, "tanpa action pihak ketiga (tidak ada 'uses:')")
    need(not re.search(r"db push|supabase (db|link|login)", code), "tanpa Supabase CLI / db push")
    need("wjjyqovhmwenbcvbnkgx" not in code and "bmwpykwoylmzrbmbdeqw" not in code, "ref production tidak boleh muncul di workflow")
    # tidak ada ekspresi ${{ }} di dalam skrip run: (semua lewat env)
    for m in re.finditer(r"^\s+run:\s*(\|?)\s*\n?(.*?)(?=^\s{6}- name:|\Z)", code, re.M | re.S):
        need("${{" not in m.group(2), "ekspresi ${{ }} di dalam skrip run:")
    need(code.count("DOKU_DB_PASSWORD") == 1, "secret terpasang di satu langkah saja")
    m = re.search(r"^\s+target_ref:\s*\n(?P<b>(?:\s{8,}.*\n)+)", code, re.M)
    need(bool(m) and "type: choice" in m.group("b") and re.findall(r"^\s+-\s*(\S+)\s*$", m.group("b"), re.M) == ["eskqngzhtndkfqjoxxou"],
         "target_ref harus choice dengan satu opsi: ref sandbox")
    i_app, i_val, i_pw = code.find("check_approval.py"), code.find("validate_target.py"), code.find("DOKU_DB_PASSWORD")
    need(0 < i_app < i_val < i_pw, "urutan wajib: check_approval -> validate_target -> langkah ber-secret")
    need(set(re.findall(r"vars\.(\w+)", code)) <= {"DOKU_DB_HOST", "DOKU_DB_USER"}, "hanya vars DOKU_DB_HOST/DOKU_DB_USER")
    need("INPUT_TARGET_REF: ${{ inputs.target_ref }}" in code, "validate_target harus menerima target_ref")
else:
    errors.append("workflow tidak ditemukan: " + wf_path)
need("eskqngzhtndkfqjoxxou" in rn and "wjjyqovhmwenbcvbnkgx" in rn, "runner harus memuat ref sandbox dan ref production (untuk penolakan)")
need(os.path.exists(os.path.join(here, "validate_target.py")), "validate_target.py harus ada")
need("set -u -o pipefail" in rn, "runner harus set -u -o pipefail")
need(not re.search(r"set -x|set -o xtrace", rn), "runner tidak boleh xtrace")
need(not re.search(r"echo[^\n]*PGPASSWORD|printf[^\n]*PGPASSWORD", rn), "runner tidak boleh mencetak PGPASSWORD")
need(not re.search(r"db push|supabase (db|link)", rn), "runner tanpa Supabase CLI")
if errors:
    print("STOP: " + "; ".join(errors)); sys.exit(1)
print("PASS: workflow dan runner memenuhi semua sifat keamanan statis")
