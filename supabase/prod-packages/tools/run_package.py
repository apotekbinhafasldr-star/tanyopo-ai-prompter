#!/usr/bin/env python3
"""LINOE production package runner (stdlib only).

Runs ONE package from supabase/prod-packages/manifest.json against ONE database, step by step, and STOPs on the first
check that does not hold. It never scans the migrations directory, never calls the Supabase CLI, never creates a role and
never prints a credential. Connection settings come ONLY from the standard libpq environment (PGHOST, PGPORT, PGUSER,
PGPASSWORD, PGSSLMODE, PGDATABASE).

Targets
  rehearsal   a disposable local/CI PostgreSQL (host must be localhost, 127.0.0.1 or a socket directory)
  production  the shared Supabase project: Supavisor pooler in SESSION mode only, TLS required, login role = the manifest's
              migration_role, and the role must be neither a superuser nor a member of postgres/supabase_admin (unless the
              manifest says approved_privileged_role = true, which needs its own reviewed PR)

Modes
  check-only     files + checksums + SQL lint only (no database)
  owner-audit    read-only ownership/privilege report (decides how narrow the migration role can be)
  verify-only    state-aware: pre-apply -> preflight (A); applied but unrecorded -> C; done -> F
  apply          requires the pre-apply state: A -> B -> C(compared with A) -> D -> F
  record-ledger  requires "applied, not recorded": C -> D -> F
  rollback       requires an applied state: E (refuses itself while linked invoices exist)

Exit code 0 = every check held. Anything else = STOP.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MODES = ("check-only", "owner-audit", "verify-only", "apply", "record-ledger", "rollback")

# --------------------------------------------------------------------------------------------------------------------
# static lint
# --------------------------------------------------------------------------------------------------------------------
FORBIDDEN = [
    (r"\bdb\s+push\b|\bmigration\s+up\b|\bsupabase\s+(db|migration)\b", "Supabase CLI replay"),
    (r"cron\.(schedule|alter_job|unschedule)", "cron change"),
    (r"\balter\s+(system|role|database|user)\b", "role/system change"),
    (r"\bcreate\s+(role|user|extension|database|schema|publication|subscription|event\s+trigger)\b", "create role/extension/etc"),
    (r"\bdrop\s+(table|schema|database|role|user|extension|index|trigger|policy|view|column)\b", "destructive DDL"),
    (r"\btruncate\s+(table\s+)?(public\.)?\w+\s*(;|$)", "TRUNCATE statement"),
    (r"\bset\s+(session\s+)?(role|session\s+authorization)\b|\breset\s+role\b", "role switch"),
    (r"\bcopy\b[^;]*\b(program|to\s+'|from\s+'|from\s+stdin)", "COPY to/from file/program"),
    (r"pg_read_file|pg_read_binary_file|lo_import|lo_export|dblink|pg_ls_dir|pg_sleep|pg_terminate_backend|pg_cancel_backend", "server file/process access"),
    (r"\bpublic\.(publoe|mitapeng)\w*|\bumkmpro_\w+", "other product object"),
    (r"\bdelete\s+from\b", "row removal"),
]


def strip_sql(sql):
    """Drop /* */ and -- comments (good enough for lint: the reviewed files hold no '--' inside string literals)."""
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return re.sub(r"--[^\n]*", " ", sql)


def lint_forbidden(name, sql):
    out = []
    body = strip_sql(sql).lower()
    for pat, why in FORBIDDEN:
        if re.search(pat, body, re.I | re.S):
            out.append(f"{name}: forbidden SQL ({why})")
    return out


WRITE_RE = re.compile(r"^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate|do|call|copy|set|reset|begin|commit)\b", re.I | re.M)


def lint_readonly(name, sql):
    hits = WRITE_RE.findall(strip_sql(sql))
    return [f"{name}: read-only file contains a '{h.lower()}' statement" for h in sorted(set(hits))]


def ddl_targets(sql):
    """Objects a migration body creates/alters/grants on, e.g. {'function:fn_x','table:prompter_invoices','index:uq_x'}."""
    b = strip_sql(sql)
    t = set()
    for m in re.finditer(r"create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)", b, re.I):
        t.add("function:" + m.group(1).lower())
    for m in re.finditer(r"alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.(\w+)", b, re.I):
        t.add("table:" + m.group(1).lower())
    for m in re.finditer(r"create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+public\.(\w+)", b, re.I):
        t.add("index:" + m.group(1).lower())
        t.add("table:" + m.group(2).lower())
    for m in re.finditer(r"\b(?:revoke|grant)\b[^;]*?\bon\s+function\s+public\.(\w+)", b, re.I | re.S):
        t.add("function:" + m.group(1).lower())
    for m in re.finditer(r"\b(?:revoke|grant)\b[^;]*?\bon\s+(?!function\b)(?:table\s+)?public\.(\w+)", b, re.I | re.S):
        t.add("table:" + m.group(1).lower())
    for m in re.finditer(r"comment\s+on\s+(?:column|table)\s+public\.(\w+)", b, re.I):
        t.add("table:" + m.group(1).lower())
    for m in re.finditer(r"comment\s+on\s+function\s+public\.(\w+)", b, re.I):
        t.add("function:" + m.group(1).lower())
    return t


def public_refs(sql):
    return {m.group(1).lower() for m in re.finditer(r"\bpublic\.(\w+)", strip_sql(sql), re.I)}


# --------------------------------------------------------------------------------------------------------------------
# manifest + package verification (no database)
# --------------------------------------------------------------------------------------------------------------------
def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def load_manifest(root, manifest_path=None):
    p = manifest_path or os.path.join(root, "supabase", "prod-packages", "manifest.json")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def verify_package(root, manifest, pkg_id):
    """Return (package dict, [problems]). Never relies on a checksum alone: lint + object allow-lists run as well."""
    problems = []
    pkgs = manifest.get("packages", {})
    if pkg_id not in pkgs:
        return None, [f"package '{pkg_id}' is not in the manifest"]
    pkg = pkgs[pkg_id]
    texts = {}

    def get(entry, label):
        path = os.path.join(root, entry["path"])
        if not os.path.isfile(path):
            problems.append(f"{label}: file missing ({entry['path']})")
            return None
        if sha256(path) != entry["sha256"]:
            problems.append(f"{label}: SHA-256 does not match the manifest ({entry['path']})")
        with open(path, encoding="utf-8") as f:
            return f.read()

    mig = get(pkg["migration"], "migration")
    rb = get(pkg["rollback"], "rollback")
    for k, entry in pkg["files"].items():
        texts[k] = get(entry, f"file {k}")
    if problems:
        return pkg, problems
    for k, text in texts.items():
        if k == "E":  # the rollback may only drop what the migration added, listed literally in the manifest
            body = strip_sql(text)
            for lit in pkg.get("rollback_allowed_statements", []):
                body = re.sub(re.sub(r"\s+", r"\\s+", re.escape(lit).replace("\\ ", " ")), " ", body, flags=re.I)
            problems += lint_forbidden("file E (after removing the allowed rollback statements)", body)
        else:
            problems += lint_forbidden(f"file {k}", text)
    problems += lint_forbidden("migration", mig)
    for k in ("A", "C", "F", "S"):
        if k in texts:
            problems += lint_readonly(f"file {k}", texts[k])
    # B = guards + the migration verbatim + post checks; E = the rollback verbatim; neither may write the ledger
    b = texts["B"]
    s, e = b.find("-- ===== isi migrasi"), b.find("-- ===== akhir isi migrasi")
    if s < 0 or e < 0 or b[b.index("\n", s) + 1:e].strip() != mig.strip():
        problems.append("file B does not embed the migration verbatim")
    if mig.rstrip() not in b:
        problems.append("file B: migration text not found")
    if rb.rstrip() not in texts["E"]:
        problems.append("file E does not embed the rollback verbatim")
    if re.search(r"insert\s+into\s+supabase_migrations", strip_sql(b), re.I):
        problems.append("file B writes the migration ledger (only D may)")
    d = strip_sql(texts["D"])
    ins = re.findall(r"insert\s+into\s+supabase_migrations\.schema_migrations", d, re.I)
    if len(ins) != 1 or f"'{pkg['version']}'" not in d or re.search(r"^\s*(update|delete|drop|truncate|alter|create|grant|revoke)\b", d, re.I | re.M):
        problems.append("file D must do exactly one ledger INSERT of the manifest version and nothing else")
    if ":'created_by'" not in texts["D"]:
        problems.append("file D must take created_by from the runner")
    # object allow-lists: a changed SQL body that touches anything new fails even when its checksum was regenerated
    targets = ddl_targets(mig)
    if targets != set(pkg["ddl_targets"]):
        problems.append(f"migration DDL targets {sorted(targets)} != manifest {sorted(pkg['ddl_targets'])}")
    refs = public_refs(mig)
    extra = refs - set(pkg["allowed_public_refs"])
    if extra:
        problems.append(f"migration references public objects outside the allow-list: {sorted(extra)}")
    ver_in_name = os.path.basename(pkg["migration"]["path"]).startswith(pkg["version"] + "_")
    if not ver_in_name:
        problems.append("manifest version does not match the migration file name")
    return pkg, problems


# --------------------------------------------------------------------------------------------------------------------
# connection safety
# --------------------------------------------------------------------------------------------------------------------
PRIV_ROLES = {"postgres", "supabase_admin", "service_role", "authenticator", "anon", "authenticated", "pgbouncer", "dashboard_user"}


def validate_connection(target, env, manifest):
    host, port, user = env.get("PGHOST", ""), env.get("PGPORT", ""), env.get("PGUSER", "")
    ssl = env.get("PGSSLMODE", "")
    errs = []
    if target == "rehearsal":
        if not (host in ("localhost", "127.0.0.1", "::1") or host.startswith("/")):
            errs.append("rehearsal target must be a local host or a socket directory")
        if re.search(r"supabase\.(co|com)", host + env.get("PGDATABASE", ""), re.I):
            errs.append("rehearsal target looks like Supabase")
        return errs
    ref = manifest["project_ref"]
    if not re.fullmatch(r"aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com", host):
        errs.append("production host must be the Supavisor pooler (aws-N-<region>.pooler.supabase.com)")
    if port != "5432":
        errs.append("production port must be 5432 (pooler SESSION mode); transaction mode is refused")
    if ssl not in ("require", "verify-ca", "verify-full"):
        errs.append("production needs PGSSLMODE=require|verify-ca|verify-full")
    role, _, suffix = user.partition(".")
    if suffix != ref:
        errs.append("production login must be <role>.<project_ref> of the manifest project")
    if role != manifest["migration_role"]:
        errs.append(f"production login role must be '{manifest['migration_role']}'")
    if role in PRIV_ROLES or role.startswith("supabase_"):
        errs.append("a built-in/privileged login role is refused")
    if not env.get("PGPASSWORD"):
        errs.append("PGPASSWORD is empty")
    return errs


# --------------------------------------------------------------------------------------------------------------------
# psql
# --------------------------------------------------------------------------------------------------------------------
class Stop(Exception):
    pass


def scrub(text, env):
    pw = env.get("PGPASSWORD")
    if pw:
        text = text.replace(pw, "***")
    return text


def psql(path, env, variables=None):
    """Run a SQL file, return (header, row) of the LAST result set parsed from CSV, or ([], [])."""
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--csv", "-d", env.get("PGDATABASE", "postgres"), "-f", path]
    for k, v in (variables or {}).items():
        cmd[1:1] = ["-v", f"{k}={v}"]
    e = dict(env)
    e["PGOPTIONS"] = "-c statement_timeout=120000 -c idle_in_transaction_session_timeout=60000 -c client_min_messages=warning"
    e["PGCONNECT_TIMEOUT"] = "20"
    r = subprocess.run(cmd, env=e, capture_output=True, text=True)
    if r.returncode != 0:
        msg = scrub((r.stderr or "").strip(), env)
        raise Stop(f"psql failed for {os.path.basename(path)}: {msg[-600:]}")
    rows = [x for x in csv.reader(io.StringIO(r.stdout)) if x]
    if len(rows) < 2:
        return [], []
    return rows[-2], rows[-1]


HARUS = re.compile(r"_harus_(true|false|ge_(\d+)|(\d+))$")


def evaluate(header, row, baseline=None):
    """Return (failures, notes). The expectation is encoded in the column NAME (_harus_*, _catat, _samakan_A, _info)."""
    fails, notes = [], []
    base = {}
    if baseline:
        for h, v in zip(*baseline):
            if h.endswith("_catat"):
                base[h[: -len("_catat")]] = v
    for h, v in zip(header, row):
        m = HARUS.search(h)
        if m:
            kind = m.group(1)
            if kind in ("true", "false"):
                ok = (v == "t") if kind == "true" else (v == "f")
            elif kind.startswith("ge_"):
                ok = v.lstrip("-").isdigit() and int(v) >= int(m.group(2))
            else:
                ok = v == m.group(3)
            if not ok:
                fails.append(f"{h}: got '{v}'")
        elif h.lower().endswith("_samakan_a"):  # PostgreSQL folds unquoted aliases to lower case
            key = h[: -len("_samakan_a")]
            if baseline is None:
                notes.append(f"{h}: not compared (no preflight baseline in this run)")
            elif key not in base:
                fails.append(f"{h}: no matching baseline column")
            elif base[key] != v:
                fails.append(f"{h}: differs from the preflight value")
        elif h.endswith("_catat") or re.search(r"(^|_)info(_|$)", h):
            continue
        else:
            fails.append(f"{h}: column name has no expectation (_harus_*/_catat/_samakan_A/_info)")
    return fails, notes


# --------------------------------------------------------------------------------------------------------------------
# main flow
# --------------------------------------------------------------------------------------------------------------------
def state_of(hdr, row, pkg):
    d = dict(zip(hdr, row))
    v2, v3 = pkg["pre_fn_hash"], pkg["post_fn_hash"]
    col, led = d.get("kolom_transaction_id"), d.get("ledger_p02")
    if d.get("fn_hash") == v2 and col == "0" and led == "0":
        return "PRE"
    if d.get("fn_hash") == v3 and col == "1" and led == "0":
        return "APPLIED_UNRECORDED"
    if d.get("fn_hash") == v3 and col == "1" and led == "1":
        return "DONE"
    return "UNKNOWN"


class Report:
    def __init__(self):
        self.lines = []

    def add(self, line):
        self.lines.append(line)
        print(line, flush=True)

    def flush_summary(self):
        p = os.environ.get("GITHUB_STEP_SUMMARY")
        if p:
            with open(p, "a", encoding="utf-8") as f:
                f.write("\n".join(self.lines) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", required=True)
    ap.add_argument("--mode", required=True, choices=MODES)
    ap.add_argument("--target", choices=("rehearsal", "production"), default="rehearsal")
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--manifest")
    ap.add_argument("--sha", default="")
    ap.add_argument("--run-id", default="local")
    a = ap.parse_args(argv)
    rep = Report()
    env = dict(os.environ)
    try:
        manifest = load_manifest(a.root, a.manifest)
        pkg, problems = verify_package(a.root, manifest, a.package)
        if problems:
            for p in problems:
                rep.add(f"- FAIL static: {p}")
            raise Stop("package verification failed")
        rep.add(f"- PASS static: package '{a.package}' files, checksums, lint and object allow-lists")
        if a.mode == "check-only":
            rep.flush_summary()
            return 0
        errs = validate_connection(a.target, env, manifest)
        if errs:
            for e in errs:
                rep.add(f"- FAIL connection: {e}")
            raise Stop("connection refused by the runner")
        rep.add(f"- PASS connection policy ({a.target})")
        pdir = os.path.join(a.root, os.path.dirname(pkg["files"]["A"]["path"]))
        f = lambda k: os.path.join(a.root, pkg["files"][k]["path"])
        if a.mode == "owner-audit":
            r = subprocess.run(["psql", "-X", "-q", "-At", "-F", " = ", "-d", env.get("PGDATABASE", "postgres"), "-f",
                                os.path.join(a.root, "supabase/prod-packages/tools/owner_audit_readonly.sql")],
                               env=env, capture_output=True, text=True)
            if r.returncode != 0:
                raise Stop("owner audit failed: " + scrub(r.stderr, env)[-300:])
            rep.add("- owner audit (read-only):")
            for line in r.stdout.strip().splitlines():
                rep.add(f"    {line}")
            rep.flush_summary()
            return 0
        # role safety (production): never a superuser, never a member of postgres/supabase_admin unless the manifest says so
        if a.target == "production" and not manifest.get("approved_privileged_role", False):
            tmp = os.path.join(a.root, "supabase/prod-packages/tools/owner_audit_readonly.sql")
            r = subprocess.run(["psql", "-X", "-q", "-At", "-F", "=", "-d", env.get("PGDATABASE", "postgres"), "-f", tmp],
                               env=env, capture_output=True, text=True)
            if r.returncode != 0:
                raise Stop("role check failed: " + scrub(r.stderr, env)[-300:])
            kv = dict(x.split("=", 1) for x in r.stdout.strip().splitlines() if "=" in x)
            if kv.get("login_superuser") == "true" or kv.get("login_anggota_postgres") == "true" or kv.get("login_anggota_supabase_admin") == "true":
                raise Stop("login role is superuser or a member of postgres/supabase_admin: refused until a separate approved change sets approved_privileged_role")
            rep.add("- PASS role is not a superuser and not a member of postgres/supabase_admin")
        hdr, row = psql(os.path.join(pdir, "S_p02_state_readonly.sql"), env)
        state = state_of(hdr, row, pkg)
        rep.add(f"- state: {state}")

        def run_check(key, label, baseline=None):
            h, r = psql(f(key), env)
            fails, notes = evaluate(h, r, baseline)
            for n in notes:
                rep.add(f"    note {label}: {n}")
            if fails:
                for x in fails:
                    rep.add(f"- FAIL {label}: {x}")
                raise Stop(f"{label} did not hold")
            rep.add(f"- PASS {label} ({len(h)} columns)")
            return (h, r)

        vars_ = {"created_by": f"github-actions:{a.run_id}:{(a.sha or 'local')[:12]}"}
        if a.mode == "verify-only":
            if state == "PRE":
                run_check("A", "A preflight")
            elif state == "APPLIED_UNRECORDED":
                run_check("C", "C verification (applied, not yet recorded in the ledger; no preflight baseline)")
                rep.add("- NEXT: run mode record-ledger")
            elif state == "DONE":
                run_check("F", "F final verification")
            else:
                raise Stop("database state is UNKNOWN (neither pre-apply, applied, nor done): nothing else was run")
        elif a.mode == "apply":
            if state != "PRE":
                raise Stop(f"apply refused: state is {state}, not PRE (nothing was run)")
            base = run_check("A", "A preflight")
            h, r = psql(f("B"), env)
            rep.add(f"- PASS B apply ({r[0] if r else 'ok'})")
            run_check("C", "C verification (compared with A)", baseline=base)
            h, r = psql(f("D"), env, vars_)
            fails, _ = evaluate(h, r)
            if fails:
                for x in fails:
                    rep.add(f"- FAIL D ledger: {x}")
                raise Stop("D did not hold")
            rep.add("- PASS D ledger recorded")
            run_check("F", "F final verification")
        elif a.mode == "record-ledger":
            if state != "APPLIED_UNRECORDED":
                raise Stop(f"record-ledger refused: state is {state}")
            run_check("C", "C verification (no preflight baseline)")
            h, r = psql(f("D"), env, vars_)
            fails, _ = evaluate(h, r)
            if fails:
                raise Stop("D did not hold: " + "; ".join(fails))
            rep.add("- PASS D ledger recorded")
            run_check("F", "F final verification")
        elif a.mode == "rollback":
            if state not in ("APPLIED_UNRECORDED", "DONE"):
                raise Stop(f"rollback refused: state is {state}")
            h, r = psql(f("E"), env)
            fails, _ = evaluate(h, r)
            if fails:
                raise Stop("E result did not hold: " + "; ".join(fails))
            rep.add("- PASS E rolled back (function back to B2 v2). The ledger row, if any, is NOT removed automatically.")
        rep.add("- RESULT: PASS")
        rep.flush_summary()
        return 0
    except Stop as e:
        rep.add(f"- RESULT: STOP - {e}")
        rep.add("- Nothing further was run. No automatic rollback was attempted.")
        rep.flush_summary()
        return 1


if __name__ == "__main__":
    sys.exit(main())
