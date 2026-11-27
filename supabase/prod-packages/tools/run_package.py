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
  verify-only    state-aware: pre-apply -> preflight (A) + privilege probes; applied but unrecorded -> C; done -> F
  apply          requires the pre-apply state: A -> privilege probes -> B -> C(compared with A) -> D -> (ledger check) -> F
  record-ledger  requires "applied, not recorded": C -> D -> (ledger check) -> F
  rollback       requires an applied state: E, then (when the package has G) G + the state afterwards must be PRE/ROLLED_BACK

Package shapes (manifest "shape"): "wrapped" (default, p0-2: B wraps the migration verbatim) and "native-txn" (B IS the migration
file with its own BEGIN..COMMIT; E IS the rollback file). Operations that the global lint rejects (drop policy/trigger/function,
create policy/trigger, delete from, UPDATE of non-public tables, ACL changes outside public) are only accepted when the package
lists them in its explicit "allow" list. Privilege probes are derived from that list and never write (decision R1: no privilege
escalation; a BLOCK/UNKNOWN probe stops the run before any write).

PUBLIC LOG: nothing that came out of the database is printed except booleans, integers, hashes and timestamps; PostgreSQL error
text is reduced to SQLSTATE + a fixed description.

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
#
# Two layers, both fail-closed:
#   1. FORBIDDEN: global patterns. Nothing in the manifest can lift these (ownership change, role switch, advisory locks,
#      dynamic EXECUTE, COPY PROGRAM, psql meta-commands, ...). A few of them are "gated" operations (drop/create policy or
#      trigger, drop function, delete from, UPDATE of a non-public table, ACL changes outside public): the SAME patterns stay
#      in force, and a statement is only removed from the lint input when it matches ONE entry of that package's explicit
#      `allow` list (kind + schema + table + literal names). No allow-list = everything is rejected exactly as before.
#   2. allow-list entries are validated (validate_allow): literal identifiers only, no wildcard, schema in {public, storage},
#      no unknown keys, and an entry that no statement uses is itself an error (stale allow-lists are not tolerated).
# --------------------------------------------------------------------------------------------------------------------
ALLOW_SCHEMAS = ("public", "storage")
ALLOW_KINDS = ("drop_policy", "create_policy", "drop_trigger", "create_trigger", "drop_function", "update_rows", "delete_from",
               "revoke", "grant")
KNOWN_PRIVS = {"all", "select", "insert", "update", "delete", "truncate", "references", "trigger", "execute", "usage"}
SENSITIVE_GRANTEES = {"public", "anon", "authenticated"}
IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'

FORBIDDEN = [
    (r"\bdb\s+push\b|\bmigration\s+up\b|\bsupabase\s+(db|migration)\b", "Supabase CLI replay"),
    (r"cron\.(schedule|alter_job|unschedule)", "cron change"),
    (r"\balter\s+(system|role|database|user)\b", "role/system change"),
    (r"\bcreate\s+(role|user|extension|database|schema|publication|subscription|event\s+trigger)\b", "create role/extension/etc"),
    (r"\bdrop\s+(table|schema|database|role|user|extension|index|trigger|policy|view|column)\b", "destructive DDL"),
    (r"\btruncate\s+(table\s+)?(public\.)?\w+\s*(;|$)", "TRUNCATE statement"),
    (r"\btruncate\s+(?:table\s+)?(?:only\s+)?(?!on\b)(?:\"[^\"]+\"|\w+)", "TRUNCATE statement (any schema, any form)"),
    (r"\bset\s+(?:session\s+|local\s+)?(role|session\s+authorization)\b|\breset\s+role\b", "role switch"),
    (r"\bcopy\b[^;]*\b(program|to\s+'|from\s+'|from\s+stdin)", "COPY to/from file/program"),
    (r"pg_read_file|pg_read_binary_file|lo_import|lo_export|dblink|pg_ls_dir|pg_sleep|pg_terminate_backend|pg_cancel_backend", "server file/process access"),
    (r"\bpublic\.(publoe|mitapeng)\w*|\bumkmpro_\w+", "other product object"),
    (r"\bdelete\s+from\b", "row removal"),
    # --- added in PR-1 (production pipeline v2). None of these occurs in the p0-2 package. ---
    (r"\bowner\s+to\b|\breassign\s+owned\b|\bdrop\s+owned\b", "ownership change"),
    (r"session_replication_role", "session_replication_role (disables triggers/FK)"),
    (r"set_config\s*\(\s*'(role|session_authorization|session_replication_role)'", "role switch via set_config"),
    (r"pg_(try_)?advisory\w*", "advisory lock"),
    (r"\bdrop\s+function\b", "DROP FUNCTION outside the allow-list"),
    (r"\bcreate\s+policy\b", "CREATE POLICY outside the allow-list"),
    (r"\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b", "CREATE TRIGGER outside the allow-list"),
    (r"\bupdate\s+(?:only\s+)?(?!public\s*\.)" + IDENT + r"\s*\.\s*" + IDENT + r"\b", "UPDATE of a non-public table outside the allow-list"),
    (r"\balter\s+default\s+privileges\b", "ALTER DEFAULT PRIVILEGES"),
    (r"\b(grant|revoke)\b[^;]*\ball\s+(tables|functions|sequences|routines|procedures)\s+in\s+schema\b", "bulk ACL change"),
    (r"\bgrant\s+(?!(?:all|select|insert|update|delete|truncate|references|trigger|execute|usage|create|connect|temporary|temp|set|alter|maintain)\b)"
     + IDENT + r"(?:\s*,\s*" + IDENT + r")*\s+to\b", "role membership grant (privilege escalation)"),
    (r"\b(grant|revoke)\b[^;]*\b(storage|auth|vault|cron|supabase_migrations|extensions|realtime|pg_catalog|information_schema|pgsodium)\b", "ACL change on a protected schema outside the allow-list"),
    (r"\bdisable\s+(trigger|rule|row\s+level\s+security)\b", "disables a trigger/rule/RLS"),
]


def strip_sql(sql):
    """Drop /* */ and -- comments (good enough for lint: the reviewed files hold no '--' inside string literals)."""
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return re.sub(r"--[^\n]*", " ", sql)


def _blank(seg):
    return re.sub(r"[^\n]", " ", seg)


_DQ = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")


def _skip_single_quoted(sql, i):
    """sql[i] == "'" -> index just after the closing quote ('' is an escaped quote)."""
    n, j = len(sql), i + 1
    while j < n:
        if sql[j] == "'":
            if j + 1 < n and sql[j + 1] == "'":
                j += 2
                continue
            return j + 1
        j += 1
    return n


def mask_literals(sql):
    """Blank '...' strings, "..." identifiers and $tag$ ... $tag$ bodies (newlines kept). Input must be comment-free."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'":
            j = _skip_single_quoted(sql, i)
            out.append(_blank(sql[i:j]))
            i = j
        elif c == '"':
            j = sql.find('"', i + 1)
            j = n if j < 0 else j + 1
            out.append(_blank(sql[i:j]))
            i = j
        elif c == "$":
            m = _DQ.match(sql, i)
            if m:
                j = sql.find(m.group(0), m.end())
                j = n if j < 0 else j + len(m.group(0))
                out.append(_blank(sql[i:j]))
                i = j
            else:
                out.append(c)
                i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def mask_strings(sql):
    """Blank only '...' literals (dollar-quoted bodies stay visible: they hold the plpgsql statements that must be linted)."""
    out, i, n = [], 0, len(sql)
    while i < n:
        if sql[i] == "'":
            j = _skip_single_quoted(sql, i)
            out.append(_blank(sql[i:j]))
            i = j
        else:
            out.append(sql[i])
            i += 1
    return "".join(out)


def has_escape_string(sql):
    """True when an E'...' literal STARTS anywhere (backslash escapes would defeat the quote scanner above)."""
    i, n = 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'":
            if i > 0 and sql[i - 1] in "eE" and (i < 2 or not (sql[i - 2].isalnum() or sql[i - 2] in "_$")):
                return True
            i = _skip_single_quoted(sql, i)
        elif c == "$":
            m = _DQ.match(sql, i)
            i = (m.end() if m else i + 1)  # enter dollar bodies: a literal inside a plpgsql body counts too
        else:
            i += 1
    return False


def dollar_spans(sql):
    """[(body_start, body_end)] of every top-level $tag$ ... $tag$ body."""
    spans, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'":
            i = _skip_single_quoted(sql, i)
        elif c == "$":
            m = _DQ.match(sql, i)
            if not m:
                i += 1
                continue
            j = sql.find(m.group(0), m.end())
            if j < 0:
                spans.append((m.end(), n))
                break
            spans.append((m.end(), j))
            i = j + len(m.group(0))
        else:
            i += 1
    return spans


def _id(s):
    s = s.strip()
    return s[1:-1] if s.startswith('"') and s.endswith('"') else s.lower()


def _q(rx):
    return re.compile(rx, re.I)


GATED = {
    "drop_policy": _q(rf"\bdrop\s+policy\s+(?:if\s+exists\s+)?(?P<name>{IDENT})\s+on\s+(?P<schema>{IDENT})\s*\.\s*(?P<table>{IDENT})(?!\s*\.)(?!\s+cascade\b)"),
    "create_policy": _q(rf"\bcreate\s+policy\s+(?P<name>{IDENT})\s+on\s+(?P<schema>{IDENT})\s*\.\s*(?P<table>{IDENT})(?!\s*\.)"),
    "drop_trigger": _q(rf"\bdrop\s+trigger\s+(?:if\s+exists\s+)?(?P<name>{IDENT})\s+on\s+(?P<schema>{IDENT})\s*\.\s*(?P<table>{IDENT})(?!\s*\.)(?!\s+cascade\b)"),
    "create_trigger": _q(rf"\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(?P<name>{IDENT})\s+(?:before|after|instead\s+of)\s[^;]*?\bon\s+(?P<schema>{IDENT})\s*\.\s*(?P<table>{IDENT})(?!\s*\.)(?P<rest>[^;]*)"),
    "drop_function": _q(rf"\bdrop\s+function\s+(?:if\s+exists\s+)?(?P<schema>{IDENT})\s*\.\s*(?P<name>{IDENT})\s*\((?P<args>[^)]*)\)(?!\s*cascade\b)"),
    "update_rows": _q(rf"\bupdate\s+(?:only\s+)?(?P<schema>{IDENT})\s*\.\s*(?P<table>{IDENT})(?:\s+(?:as\s+)?(?!set\b)(?P<alias>{IDENT}))?\s+set\b(?P<rest>[^;]*)"),
    "delete_from": _q(rf"\bdelete\s+from\s+(?:only\s+)?(?P<schema>{IDENT})\s*\.\s*(?P<table>{IDENT})(?P<rest>[^;]*)"),
    "acl": _q(rf"\b(?P<verb>revoke|grant)\s+(?P<privs>[a-z_][a-z_ ,]*?)\s+on\s+(?:(?P<otype>table|function|sequence)\s+)?(?P<schema>{IDENT})\s*\.\s*(?P<obj>{IDENT})(?P<args>\s*\([^)]*\))?\s+(?:from|to)\s+(?P<roles>[^;]*)"),
}
FUNC_DEF = re.compile(rf"\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:{IDENT}\s*\.\s*)?(?P<fn>{IDENT})", re.I)
_TRG_FN = re.compile(r"\bexecute\s+(?:function|procedure)\s+(?P<f>[\w.\"]+)", re.I)


def _enclosing_function(body, pos, spans):
    best = None
    for m in FUNC_DEF.finditer(body):
        if m.start() > pos:
            break
        for a, b in spans:
            if a > m.end():
                if a <= pos < b:
                    best = _id(m.group("fn"))
                break
    return best


def _gated_op(kind, m, body, spans):
    """Parse one statement match into an op dict, or None when the statement class is not gated (e.g. UPDATE of public)."""
    g = m.groupdict()
    op = {"kind": kind, "start": m.start(), "end": m.end(), "schema": _id(g["schema"]) if g.get("schema") else None}
    if kind in ("drop_policy", "create_policy", "drop_trigger", "create_trigger"):
        op["table"], op["name"] = _id(g["table"]), _id(g["name"])
        if kind == "create_trigger":
            f = _TRG_FN.search(g.get("rest") or "")
            op["fn"] = _id(f.group("f").replace("public.", "")) if f else None
    elif kind == "drop_function":
        op["name"] = _id(g["name"])
    elif kind == "update_rows":
        if op["schema"] == "public":
            return None
        op["table"] = _id(g["table"])
        rest = g.get("rest") or ""
        setc = re.split(r"\bwhere\b|\bfrom\b|\breturning\b", rest, maxsplit=1, flags=re.I)[0]
        op["columns"] = sorted({_id(c) for c in re.findall(rf"(?:^|,)\s*({IDENT})\s*=", setc)})
        op["where"] = bool(re.search(r"\bwhere\b", rest, re.I))
    elif kind == "delete_from":
        op["table"] = _id(g["table"])
        op["where"] = bool(re.search(r"\bwhere\b", g.get("rest") or "", re.I))
        op["in_function"] = _enclosing_function(body, m.start(), spans)
    elif kind == "acl":
        verb = g["verb"].lower()
        privs = sorted({re.sub(r"\s+", " ", p.strip().lower()).replace("all privileges", "all") for p in g["privs"].split(",") if p.strip()})
        roles_txt = g["roles"]
        grant_opt = bool(re.search(r"with\s+grant\s+option|granted\s+by", roles_txt, re.I))
        roles_txt = re.sub(r"\b(with\s+grant\s+option|cascade|restrict|granted\s+by\s+\S+)\b", " ", roles_txt, flags=re.I)
        roles = sorted({_id(r.replace("group ", "").strip()) for r in roles_txt.split(",") if r.strip()})
        gated = op["schema"] != "public" or grant_opt or (verb == "grant" and set(roles) & SENSITIVE_GRANTEES)
        if not gated:
            return None
        op.update(kind=verb, obj=_id(g["obj"]), privileges=privs, roles=roles, grant_option=grant_opt)
    return op


def _entry_matches(e, op):
    if e.get("kind") != op["kind"]:
        return False
    k = op["kind"]
    if e.get("schema") != op["schema"]:
        return False
    if k in ("drop_policy", "create_policy", "drop_trigger", "create_trigger"):
        if e.get("table") != op["table"] or op["name"] not in e.get("names", []):
            return False
        if k == "create_trigger" and e.get("functions") is not None and op.get("fn") not in e["functions"]:
            return False
        return True
    if k == "drop_function":
        return op["name"] in e.get("names", [])
    if k == "update_rows":
        return (e.get("table") == op["table"] and set(op["columns"]) <= set(e.get("columns", [])) and bool(op["columns"])
                and (op["where"] or not e.get("require_where", True)))
    if k == "delete_from":
        if e.get("table") != op["table"] or not (op["where"] or not e.get("require_where", True)):
            return False
        return e.get("in_function") is None or e.get("in_function") == op["in_function"]
    if k in ("revoke", "grant"):
        return (op["obj"] in e.get("objects", []) and set(op["privileges"]) <= set(e.get("privileges", []))
                and set(op["roles"]) <= set(e.get("roles", [])) and (not op["grant_option"] or e.get("grant_option", False)))
    return False


def _describe(op):
    k = op["kind"]
    if k in ("revoke", "grant"):
        return f"{k} {','.join(op['privileges'])} on {op['schema']}.{op['obj']} -> {','.join(op['roles'])}"
    tail = ":" + op["name"] if op.get("name") and k != "drop_function" else ""
    if k == "drop_function":
        return f"drop_function {op['schema']}.{op['name']}"
    return f"{k} {op['schema']}.{op.get('table', '')}{tail}"


def gate_statements(name, body, allow, used=None):
    """Return (body with allow-listed statements blanked, [violations]). `used` collects indexes of allow entries that matched."""
    spans = dollar_spans(body)
    ops = []
    for kind, rx in GATED.items():
        for m in rx.finditer(body):
            op = _gated_op(kind, m, body, spans)
            if op:
                ops.append(op)
    out, chars = [], list(body)
    for op in sorted(ops, key=lambda o: o["start"]):
        idx = next((i for i, e in enumerate(allow) if _entry_matches(e, op)), None)
        if idx is None:
            out.append(f"{name}: {_describe(op)} is not in the package allow-list")
        elif used is not None:
            used.add(idx)
        for i in range(op["start"], op["end"]):
            if chars[i] != "\n":
                chars[i] = " "
    return "".join(chars), out


def lint_forbidden(name, sql, allow=None, used=None):
    out = []
    body, gate_out = gate_statements(name, strip_sql(sql), allow or [], used)
    out += gate_out
    low = body.lower()
    for pat, why in FORBIDDEN:
        if re.search(pat, low, re.I | re.S):
            out.append(f"{name}: forbidden SQL ({why})")
    if re.search(r"\bexecute\s+(?!on\b|function\b|procedure\b)", mask_strings(low)):
        out.append(f"{name}: forbidden SQL (dynamic EXECUTE)")
    if has_escape_string(body):
        out.append(f"{name}: forbidden SQL (escape-string literal E'...')")
    return out


def lint_psql_meta(name, sql):
    """psql meta-commands (\\!, \\i, \\copy, \\gset ...) run on the runner host: none is allowed anywhere in a package file."""
    if "\\" in mask_literals(strip_sql(sql)):
        return [f"{name}: contains a backslash outside string literals (psql meta-command)"]
    return []


def validate_allow(entries, label="allow"):
    """Structure of the explicit allow-list. Literal identifiers only; no wildcard; no unknown keys; schema in ALLOW_SCHEMAS."""
    problems = []
    if not isinstance(entries, list):
        return [f"{label}: must be a list"]
    ident = re.compile(r"^[a-z_][a-z0-9_]*$")
    for i, e in enumerate(entries):
        w = f"{label}[{i}]"
        if not isinstance(e, dict) or e.get("kind") not in ALLOW_KINDS:
            problems.append(f"{w}: kind must be one of {ALLOW_KINDS}")
            continue
        k = e["kind"]
        keys = {"kind", "schema"}
        if k in ("drop_policy", "create_policy", "drop_trigger", "create_trigger"):
            keys |= {"table", "names"} | ({"functions"} if k == "create_trigger" else set())
        elif k == "drop_function":
            keys |= {"names"}
        elif k == "update_rows":
            keys |= {"table", "columns", "require_where"}
        elif k == "delete_from":
            keys |= {"table", "in_function", "require_where"}
        else:
            keys |= {"objects", "privileges", "roles", "grant_option"}
        if set(e) - keys:
            problems.append(f"{w}: unknown keys {sorted(set(e) - keys)}")
        if e.get("schema") not in ALLOW_SCHEMAS:
            problems.append(f"{w}: schema must be one of {ALLOW_SCHEMAS}")
        if "table" in keys and not (isinstance(e.get("table"), str) and ident.match(e["table"])):
            problems.append(f"{w}: table must be one literal identifier")
        lists = [x for x in ("names", "columns", "objects", "roles", "functions", "privileges") if x in keys]
        for lk in lists:
            v = e.get(lk)
            if lk == "functions" and v is None:
                continue
            if not isinstance(v, list) or not v:
                problems.append(f"{w}: {lk} must be a non-empty list")
                continue
            for x in v:
                if not isinstance(x, str) or not x.strip() or x != x.strip() or re.search(r"[*%?\\]", x) or len(x) > 120:
                    problems.append(f"{w}: {lk} entry must be a literal name (no wildcard, no padding)")
                elif lk in ("columns", "objects", "roles") and not ident.match(x):
                    problems.append(f"{w}: {lk} entry must be a lower-case identifier")
                elif lk == "privileges" and x not in KNOWN_PRIVS:
                    problems.append(f"{w}: unknown privilege")
        if k in ("revoke", "grant") and "all" in (e.get("privileges") or []) and k == "grant":
            problems.append(f"{w}: 'grant all' cannot be allow-listed")
        if "in_function" in e and e["in_function"] is not None and not (isinstance(e["in_function"], str) and ident.match(e["in_function"])):
            problems.append(f"{w}: in_function must be one literal function name")
    return problems


def check_unused(entries, used, label):
    return [f"{label}[{i}] is not used by any statement (stale allow-list entry)" for i in range(len(entries)) if i not in used]


WRITE_RE = re.compile(r"^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate|do|call|copy|set|reset|begin|commit)\b", re.I | re.M)


def lint_readonly(name, sql):
    hits = WRITE_RE.findall(strip_sql(sql))
    return [f"{name}: read-only file contains a '{h.lower()}' statement" for h in sorted(set(hits))]


def check_native_txn(name, sql):
    """Shape N: the file carries its OWN transaction: exactly one top-level BEGIN first and one COMMIT last, nothing else."""
    body = mask_literals(strip_sql(sql))
    stmts = [s.strip().lower() for s in body.split(";") if s.strip()]
    out = []
    if not stmts or not re.fullmatch(r"(begin|start\s+transaction)(\s+(isolation|read|not|deferrable).*)?", stmts[0], re.S):
        out.append(f"{name}: native-transaction file must start with BEGIN")
    if not stmts or stmts[-1] != "commit":
        out.append(f"{name}: native-transaction file must end with COMMIT")
    ctl = [s for s in stmts if re.match(r"(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction|commit\s+prepared)\b", s)]
    if len(ctl) != 2:
        out.append(f"{name}: expected exactly one BEGIN and one COMMIT at top level, found {len(ctl)} transaction-control statements")
    return out


def has_txn_control(sql):
    body = mask_literals(strip_sql(sql))
    return [s.strip() for s in body.split(";")
            if re.match(r"\s*(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release)\b", s, re.I)]


def ddl_targets(sql):
    """Objects a migration body creates/alters/grants on, e.g. {'function:fn_x','table:prompter_invoices','index:uq_x'}.
    v2 additionally recognises policies, triggers, UPDATE/DELETE of rows, ACL changes and DDL outside `public` (schema-qualified)."""
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
    # ---- v2 ----
    for m in re.finditer(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?!temp\b|temporary\b|unlogged\b)(?:public\.)?(\w+)\s*\(", b, re.I):
        t.add("table:" + m.group(1).lower())
    for kind in ("create_policy", "drop_policy", "create_trigger", "drop_trigger"):
        for m in GATED[kind].finditer(b):
            g = m.groupdict()
            t.add(f"{kind.split('_')[1]}:{_id(g['schema'])}.{_id(g['table'])}:{_id(g['name'])}")
    for m in GATED["drop_function"].finditer(b):
        g = m.groupdict()
        t.add(("function:" if _id(g["schema"]) == "public" else f"function:{_id(g['schema'])}.") + _id(g["name"]))
    for kind in ("update_rows", "delete_from"):
        for m in GATED[kind].finditer(b):
            g = m.groupdict()
            if kind == "update_rows" and _id(g["schema"]) == "public":
                continue
            t.add(f"rows:{_id(g['schema'])}.{_id(g['table'])}")
    for m in GATED["acl"].finditer(b):
        g = m.groupdict()
        if _id(g["schema"]) != "public":
            t.add(f"acl:{_id(g['schema'])}.{_id(g['obj'])}")
    for m in re.finditer(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?!temp\b|temporary\b|unlogged\b)(?!public\.)(\w+)\.(\w+)", b, re.I):
        t.add(f"table:{m.group(1).lower()}.{m.group(2).lower()}")
    for m in re.finditer(r"comment\s+on\s+(?:column|table)\s+(?!public\.)(\w+)\.(\w+)", b, re.I):
        t.add(f"table:{m.group(1).lower()}.{m.group(2).lower()}")
    return t


def public_refs(sql):
    return {m.group(1).lower() for m in re.finditer(r"\bpublic\.(\w+)", strip_sql(sql), re.I)}


FOREIGN_SCHEMAS = "storage|auth|vault|cron|supabase_migrations|extensions|realtime|net|pgsodium|supabase_functions"


def foreign_refs(sql):
    """schema.object references to Supabase-managed schemas (e.g. storage.objects). Opt-in per package (allowed_foreign_refs)."""
    return {f"{m.group(1).lower()}.{m.group(2).lower()}" for m in re.finditer(rf"\b({FOREIGN_SCHEMAS})\.(\w+)", strip_sql(sql), re.I)}


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


PROBE_NEEDS = {"owner", "select", "insert", "update", "delete", "truncate", "trigger", "references"}
TABLE_RE = re.compile(r"^(public|storage)\.[a-z_][a-z0-9_]*$")
FUNC_RE = re.compile(r"^(public|storage)\.[a-z_][a-z0-9_]*\([a-z0-9_ ,\[\]]*\)$")
GUARD_TAGS_DEFAULT = ("PREFLIGHT GAGAL", "PEMERIKSAAN AKHIR GAGAL", "DIBATALKAN")


def validate_probes(spec, label="probes"):
    problems = []
    if not isinstance(spec, dict) or set(spec) - {"tables", "functions", "schemas", "ledger_insert"}:
        return [f"{label}: unknown structure"]
    for t in spec.get("tables", []):
        if not (isinstance(t, dict) and TABLE_RE.match(str(t.get("table", ""))) and isinstance(t.get("need"), list) and t["need"]
                and set(t["need"]) <= PROBE_NEEDS and set(t) <= {"table", "need"}):
            problems.append(f"{label}.tables: each entry needs a literal public/storage table and a non-empty need list")
    for f_ in spec.get("functions", []):
        if not (isinstance(f_, str) and FUNC_RE.match(f_)):
            problems.append(f"{label}.functions: literal schema.name(argtypes) required")
    for s in spec.get("schemas", []):
        if s not in ALLOW_SCHEMAS:
            problems.append(f"{label}.schemas: schema must be one of {ALLOW_SCHEMAS}")
    return problems


def derive_probe_spec(pkg):
    """Privilege probes mirror the package: the allow-lists (+ explicit `probes`) say which rights the apply will need.
    A package without allow-list/probes (p0-2) has an empty spec and runs no probe: its behaviour does not change."""
    tables = {}

    def need(t, *ks):
        tables.setdefault(t, set()).update(ks)

    for e in list(pkg.get("allow", [])) + list(pkg.get("rollback_allow", [])):
        k, s = e["kind"], e["schema"]
        if k in ("drop_policy", "create_policy", "drop_trigger"):
            need(f"{s}.{e['table']}", "owner")
        elif k == "create_trigger":
            need(f"{s}.{e['table']}", "owner", "trigger")
        elif k == "update_rows":
            need(f"{s}.{e['table']}", "select", "update")
        elif k == "delete_from":
            need(f"{s}.{e['table']}", "select", "delete")
        elif k in ("revoke", "grant"):
            for o in e["objects"]:
                need(f"{s}.{o}", "owner")
    ex = pkg.get("probes", {})
    for t in ex.get("tables", []):
        need(t["table"], *t["need"])
    spec = {"tables": [{"table": t, "need": sorted(n)} for t, n in sorted(tables.items())],
            "functions": sorted(ex.get("functions", [])), "schemas": sorted(ex.get("schemas", [])),
            "ledger_insert": bool(ex.get("ledger_insert") or pkg.get("ledger_verify"))}
    return spec if (spec["tables"] or spec["functions"] or spec["schemas"] or spec["ledger_insert"]) else None


def lint_rollback(name, text, pkg, allow, used):
    body = strip_sql(text)
    for lit in pkg.get("rollback_allowed_statements", []):  # the rollback may only drop what the migration added, listed literally
        body = re.sub(re.sub(r"\s+", r"\\s+", re.escape(lit).replace("\\ ", " ")), " ", body, flags=re.I)
    return lint_forbidden(name, body, allow, used)


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
        with open(path, encoding="utf-8", newline="") as f:
            text = f.read()
        if "\r" in text:
            problems.append(f"{label}: contains a carriage return (CRLF): package files must be LF")
        return text

    mig = get(pkg["migration"], "migration")
    rb = get(pkg["rollback"], "rollback")
    for k, entry in pkg["files"].items():
        texts[k] = get(entry, f"file {k}")
    if problems:
        return pkg, problems
    missing = [k for k in "ABCDEFS" if k not in texts]
    if missing:
        return pkg, [f"package files missing from the manifest: {missing}"]
    shape = pkg.get("shape", "wrapped")
    if shape not in ("wrapped", "native-txn"):
        return pkg, [f"unknown package shape '{shape}'"]
    allow, rallow = pkg.get("allow", []), pkg.get("rollback_allow", [])
    problems += validate_allow(allow, "allow") + validate_allow(rallow, "rollback_allow")
    if "probes" in pkg:
        problems += validate_probes(pkg["probes"])
    tm = pkg.get("timeouts")
    if tm is not None and not (isinstance(tm, dict) and set(tm) <= {"lock_ms", "statement_ms"}
                               and all(isinstance(v, int) for v in tm.values())
                               and 100 <= tm.get("lock_ms", 3000) <= 10000 and 1000 <= tm.get("statement_ms", 120000) <= 120000):
        problems.append("timeouts: lock_ms 100..10000 and statement_ms 1000..120000 (integers) only")
    gt = pkg.get("guard_tags")
    if gt is not None and not (isinstance(gt, list) and gt and all(isinstance(x, str) and re.fullmatch(r"[A-Z0-9][A-Z0-9 ]{2,38}[A-Z0-9]", x) for x in gt)):
        problems.append("guard_tags: upper-case literal tags only")
    if problems:  # a malformed allow-list is never used to lint
        return pkg, problems
    used_m, used_r = set(), set()
    for k, text in texts.items():
        problems += lint_psql_meta(f"file {k}", text)
        if k == "E":
            problems += lint_rollback("file E (after removing the allowed rollback statements)", text, pkg, rallow, None)
        elif k == "B":
            problems += lint_forbidden("file B", text, allow, None)
        else:
            problems += lint_forbidden(f"file {k}", text)
    problems += lint_psql_meta("migration", mig) + lint_psql_meta("rollback", rb)
    problems += lint_forbidden("migration", mig, allow, used_m)
    problems += lint_rollback("rollback", rb, pkg, rallow, used_r)
    problems += check_unused(allow, used_m, "allow") + check_unused(rallow, used_r, "rollback_allow")
    for k in ("A", "C", "F", "S", "G"):
        if k in texts:
            problems += lint_readonly(f"file {k}", texts[k])
    b = texts["B"]
    if shape == "wrapped":
        # B = guards + the migration verbatim + post checks; E = the rollback verbatim
        s, e = b.find("-- ===== isi migrasi"), b.find("-- ===== akhir isi migrasi")
        if s < 0 or e < 0 or b[b.index("\n", s) + 1:e].strip() != mig.strip():
            problems.append("file B does not embed the migration verbatim")
        if mig.rstrip() not in b:
            problems.append("file B: migration text not found")
        if rb.rstrip() not in texts["E"]:
            problems.append("file E does not embed the rollback verbatim")
        if has_txn_control(mig) or has_txn_control(rb):
            problems.append("wrapped shape: the migration/rollback must not carry its own BEGIN/COMMIT (B/E wrap them)")
    else:
        # shape N: B IS the migration and E IS the rollback (one source of truth, no copy); each carries its own transaction
        if pkg["files"]["B"]["path"] != pkg["migration"]["path"] or pkg["files"]["B"]["sha256"] != pkg["migration"]["sha256"] or b != mig:
            problems.append("native-txn shape: file B must be the migration file itself")
        if pkg["files"]["E"]["path"] != pkg["rollback"]["path"] or pkg["files"]["E"]["sha256"] != pkg["rollback"]["sha256"] or texts["E"] != rb:
            problems.append("native-txn shape: file E must be the rollback file itself")
        problems += check_native_txn("migration", mig) + check_native_txn("rollback", rb)
    if re.search(r"insert\s+into\s+supabase_migrations", strip_sql(b), re.I):
        problems.append("file B writes the migration ledger (only D may)")
    d = strip_sql(texts["D"])
    ins = re.findall(r"insert\s+into\s+supabase_migrations\.schema_migrations", d, re.I)
    if len(ins) != 1 or f"'{pkg['version']}'" not in d or re.search(r"^\s*(update|delete|drop|truncate|alter|create|grant|revoke)\b", d, re.I | re.M):
        problems.append("file D must do exactly one ledger INSERT of the manifest version and nothing else")
    if ":'created_by'" not in texts["D"]:
        problems.append("file D must take created_by from the runner")
    if pkg.get("ledger_verify"):
        if pkg["migration"]["sha256"] not in texts["D"]:
            problems.append("ledger_verify: file D must embed the migration SHA-256 in the ledger statements")
        if not (re.fullmatch(r"\d{14}", pkg["version"]) and re.fullmatch(r"[a-z0-9_]{3,80}", pkg["name"])):
            problems.append("ledger_verify: version must be 14 digits and name [a-z0-9_]")
    # object allow-lists: a changed SQL body that touches anything new fails even when its checksum was regenerated
    targets = ddl_targets(mig)
    if targets != set(pkg["ddl_targets"]):
        problems.append(f"migration DDL targets {sorted(targets)} != manifest {sorted(pkg['ddl_targets'])}")
    refs = public_refs(mig)
    extra = refs - set(pkg["allowed_public_refs"])
    if extra:
        problems.append(f"migration references public objects outside the allow-list: {sorted(extra)}")
    if allow or "allowed_foreign_refs" in pkg:
        fx = foreign_refs(mig) - set(pkg.get("allowed_foreign_refs", []))
        if fx:
            problems.append(f"migration references Supabase-managed objects outside allowed_foreign_refs: {sorted(fx)}")
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
# PUBLIC-LOG SAFETY (the repository is public, so is every Actions log).
# Rule: the runner never prints a value that came out of the database except through the helpers below, which only let
# through booleans, integers, md5/sha-256 hex and timestamps. Names of policies/buckets/tables/rows and raw PostgreSQL
# error text (which quotes object names) are never echoed: only the SQLSTATE class and a fixed description. A static test
# (tests/test_tools.py, AST walk) fails if run_package.py interpolates raw result variables into a log line.
# --------------------------------------------------------------------------------------------------------------------
SAFE_CELL_RE = re.compile(r"^(?:t|f|-?\d{1,18}|[0-9a-f]{32}|[0-9a-f]{64}|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[+-]\d{2}(?::?\d{2})?|Z)?)?$")
COL_RE = re.compile(r"^[A-Za-z0-9_]{1,80}$")
BUILTIN_ROLES = {"postgres", "supabase_admin", "supabase_storage_admin", "supabase_auth_admin", "supabase_functions_admin",
                 "authenticator", "service_role", "anon", "authenticated", "dashboard_user", "pgbouncer", "pg_database_owner", "linoe_migrator"}
SQLSTATE_TEXT = {
    "42501": "insufficient privilege (not the owner / no permission)", "55P03": "lock not available (lock_timeout)",
    "57014": "statement canceled (statement_timeout)", "P0001": "package guard raised an exception", "40P01": "deadlock detected",
    "23505": "unique violation", "23503": "foreign key violation", "23502": "not-null violation", "23514": "check violation",
    "42P01": "undefined table", "42704": "undefined object", "42883": "undefined function", "42703": "undefined column",
    "42710": "duplicate object", "42P07": "duplicate relation", "42P06": "duplicate schema", "25006": "read-only transaction",
    "25P02": "transaction aborted", "28000": "authentication failed", "28P01": "authentication failed", "3D000": "database does not exist",
    "53300": "too many connections", "57P01": "server shutting down", "08006": "connection failure", "08001": "cannot connect",
    "0A000": "feature not supported", "22023": "invalid parameter value", "22P02": "invalid text representation", "XX000": "internal error",
}


def safe_cell(v):
    v = v or ""
    return f"'{v}'" if SAFE_CELL_RE.match(v) else f"<withheld len={len(v)}>"


def safe_col(h, i=0):
    return h if COL_RE.match(h or "") else f"<col{i}>"


def check_log_safe(header, row, skip=()):
    """Result cells must be boolean/integer/hash/timestamp. Anything else (free text = possibly someone else's object name) is a STOP."""
    return [f"{safe_col(h, i)}: value is outside the log-safe grammar (boolean/integer/hash/timestamp), len={len(v)}"
            for i, (h, v) in enumerate(zip(header, row)) if h not in skip and not SAFE_CELL_RE.match(v)]


def safe_error(stderr, env, tags=GUARD_TAGS_DEFAULT):
    """Reduce psql stderr to SQLSTATE + a fixed description. NOTHING from the message is echoed except a declared guard tag."""
    text = scrub(stderr or "", env)
    m = re.search(r"ERROR:\s+([0-9A-Z]{5}):\s*(.*)", text)
    if m:
        code, msg = m.group(1), m.group(2)
        desc = SQLSTATE_TEXT.get(code) or "database error (class " + code[:2] + ")"
        if code == "P0001":
            tag = next((t for t in tags if msg.startswith(t)), None)
            return f"SQLSTATE {code}: {desc} [{tag or 'untagged'}] (message text withheld: public log)"
        return f"SQLSTATE {code}: {desc} (message text withheld: public log)"
    if re.search(r"authentication failed|password|no pg_hba|SASL", text, re.I):
        return "connection refused: authentication failed (details withheld)"
    if re.search(r"could not connect|Connection refused|timeout expired|could not translate host|No route|server closed the connection|SSL|FATAL", text, re.I):
        if re.search(r"database .* does not exist", text, re.I):
            return "database not found (name withheld)"
        if re.search(r"role .* does not exist", text, re.I):
            return "login role not found (name withheld)"
        return "connection failed (details withheld)"
    return "psql error (unclassified; text withheld: public log)"


def safe_audit_value(v):
    v = (v or "").strip()
    if SAFE_CELL_RE.match(v) or v in ("true", "false", "n/a", "tidak ada"):
        return v
    parts = [p.strip() for p in v.split(",")]
    if all(re.fullmatch(r"[a-z_][a-z0-9_]*(=\d{1,9})?", p) and p.split("=")[0] in BUILTIN_ROLES for p in parts):
        return v
    return f"<withheld len={len(v)}>"


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


def pg_options(timeouts=None):
    t = {"lock_ms": 3000, "statement_ms": 120000}
    t.update(timeouts or {})
    return (f"-c statement_timeout={int(t['statement_ms'])} -c lock_timeout={int(t['lock_ms'])} "
            "-c idle_in_transaction_session_timeout=60000 -c client_min_messages=warning")


def psql(path, env, variables=None, timeouts=None, tags=None, all_rows=False):
    """Run a SQL file, return (header, row) of the LAST result set parsed from CSV, or ([], []).
    all_rows=True (single-SELECT files only): (header, [rows])."""
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "--csv", "-d", env.get("PGDATABASE", "postgres"), "-f", path]
    for k, v in (variables or {}).items():
        cmd[1:1] = ["-v", f"{k}={v}"]
    e = dict(env)
    e["PGOPTIONS"] = pg_options(timeouts)
    e["PGCONNECT_TIMEOUT"] = "20"
    r = subprocess.run(cmd, env=e, capture_output=True, text=True)
    if r.returncode != 0:
        raise Stop(f"psql failed for {os.path.basename(path)}: {safe_error(r.stderr, env, tags or GUARD_TAGS_DEFAULT)}")
    rows = [x for x in csv.reader(io.StringIO(r.stdout)) if x]
    if all_rows:
        return (rows[0], rows[1:]) if rows else ([], [])
    if len(rows) < 2:
        return [], []
    return rows[-2], rows[-1]


def psql_at(path, env, sep):
    """Read-only audit files printed unaligned. Returns stdout; failure -> Stop with a redacted reason."""
    r = subprocess.run(["psql", "-X", "-q", "-At", "-F", sep, "-v", "VERBOSITY=verbose", "-d", env.get("PGDATABASE", "postgres"), "-f", path],
                       env=env, capture_output=True, text=True)
    if r.returncode != 0:
        raise Stop(f"psql failed for {os.path.basename(path)}: {safe_error(r.stderr, env)}")
    return r.stdout


HARUS = re.compile(r"_harus_(true|false|ge_(\d+)|(\d+))$")


def evaluate(header, row, baseline=None):
    """Return (failures, notes). The expectation is encoded in the column NAME (_harus_*, _catat, _samakan_A, _info)."""
    fails, notes = [], []
    base = {}
    if baseline:
        for h, v in zip(*baseline):
            if h.endswith("_catat"):
                base[h[: -len("_catat")]] = v
    for i, (h, v) in enumerate(zip(header, row)):
        hn = safe_col(h, i)
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
                fails.append(f"{hn}: got {safe_cell(v)}")
        elif h.lower().endswith("_samakan_a"):  # PostgreSQL folds unquoted aliases to lower case
            key = h[: -len("_samakan_a")]
            if baseline is None:
                notes.append(f"{hn}: not compared (no preflight baseline in this run)")
            elif key not in base:
                fails.append(f"{hn}: no matching baseline column")
            elif base[key] != v:
                fails.append(f"{hn}: differs from the preflight value")
        elif h.endswith("_catat") or re.search(r"(^|_)info(_|$)", h):
            continue
        else:
            fails.append(f"{hn}: column name has no expectation (_harus_*/_catat/_samakan_A/_info)")
    return fails, notes


# --------------------------------------------------------------------------------------------------------------------
# main flow
# --------------------------------------------------------------------------------------------------------------------
STATES = ("PRE", "APPLIED_UNRECORDED", "DONE", "ROLLED_BACK", "UNKNOWN")


def state_of(hdr, row, pkg):
    d = dict(zip(hdr, row))
    if "keadaan" in d:  # packages that compute the state in SQL (S file): a closed vocabulary, anything else = UNKNOWN
        return d["keadaan"] if d["keadaan"] in STATES else "UNKNOWN"
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


PROBE_SQL = os.path.join(HERE, "privilege_probe_readonly.sql")
LEDGER_SQL = os.path.join(HERE, "ledger_verify_readonly.sql")
PROBE_STATUS = ("PASS", "BLOCK", "UNKNOWN", "INFO")


def run_probes(spec, env, rep, tags=None):
    """Read-only privilege probes. Returns (n_pass, n_block, n_unknown). Prints probe id + status only (no object names)."""
    h, rows = psql(PROBE_SQL, env, {"probe_spec": json.dumps(spec, separators=(",", ":"))}, tags=tags, all_rows=True)
    if h != ["probe", "status", "info"]:
        raise Stop("privilege probe returned an unexpected shape")
    npass = nblock = nunk = 0
    for i, r in enumerate(rows):
        if len(r) != 3:
            nunk += 1
            continue
        label, status, info = r
        if not re.fullmatch(r"[a-z0-9_.]{1,48}", label) or status not in PROBE_STATUS or not SAFE_CELL_RE.match(info):
            label, status, info = f"invalid_row_{i}", "UNKNOWN", ""
        if status == "PASS":
            npass += 1
        elif status == "BLOCK":
            nblock += 1
        elif status == "UNKNOWN":
            nunk += 1
        rep.add(f"    probe {label}: {status}" + (f" {info}" if info else ""))
    rep.add(f"- probes: {npass} PASS, {nblock} BLOCK, {nunk} UNKNOWN (read-only; nothing was written)")
    return npass, nblock, nunk


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
        tags = tuple(pkg.get("guard_tags", GUARD_TAGS_DEFAULT))
        tmo = pkg.get("timeouts")
        spec = derive_probe_spec(pkg)
        audit_sql = os.path.join(a.root, "supabase/prod-packages/tools/owner_audit_readonly.sql")
        f = lambda k: os.path.join(a.root, pkg["files"][k]["path"])
        if a.mode == "owner-audit":
            out = psql_at(audit_sql, env, " = ")
            rep.add("- owner audit (read-only):")
            for line in out.strip().splitlines():
                item, _, val = line.partition(" = ")
                rep.add(f"    {item if COL_RE.match(item) else '<item>'} = {safe_audit_value(val)}")
            if spec:
                npass, nblock, nunk = run_probes(spec, env, rep, tags)
                if nblock or nunk:
                    rep.add("- HOLD: privilege probes are not all PASS; apply would be refused. No privilege escalation is attempted (decision R1).")
            rep.flush_summary()
            return 0
        # role safety (production): never a superuser, never a member of postgres/supabase_admin unless the manifest says so
        if a.target == "production" and not manifest.get("approved_privileged_role", False):
            out = psql_at(audit_sql, env, "=")
            kv = dict(x.split("=", 1) for x in out.strip().splitlines() if "=" in x)
            if kv.get("login_superuser") == "true" or kv.get("login_anggota_postgres") == "true" or kv.get("login_anggota_supabase_admin") == "true":
                raise Stop("login role is superuser or a member of postgres/supabase_admin: refused until a separate approved change sets approved_privileged_role")
            rep.add("- PASS role is not a superuser and not a member of postgres/supabase_admin")
        hdr, row = psql(f("S"), env, tags=tags)
        state = state_of(hdr, row, pkg)
        rep.add(f"- state: {state}")

        def run_check(key, label, baseline=None):
            h, r = psql(f(key), env, tags=tags)
            bad = check_log_safe(h, r, skip=("keadaan",))
            if bad:
                for x in bad:
                    rep.add(f"- FAIL {label}: {x}")
                raise Stop(f"{label} produced output outside the log-safe grammar")
            fails, notes = evaluate(h, r, baseline)
            for n in notes:
                rep.add(f"    note {label}: {n}")
            if fails:
                for x in fails:
                    rep.add(f"- FAIL {label}: {x}")
                raise Stop(f"{label} did not hold")
            rep.add(f"- PASS {label} ({len(h)} columns)")
            return (h, r)

        def probe_gate():
            if not spec:
                return
            npass, nblock, nunk = run_probes(spec, env, rep, tags)
            if nblock or nunk:
                raise Stop(f"privilege probes: {nblock} BLOCK, {nunk} UNKNOWN: refused before any write. No privilege escalation is attempted (decision R1)")

        def ledger_check():
            if not pkg.get("ledger_verify"):
                return
            h, r = psql(LEDGER_SQL, env, {"ver": pkg["version"], "nm": pkg["name"], "sha": pkg["migration"]["sha256"]}, tags=tags)
            fails, _ = evaluate(h, r)
            if fails:
                for x in fails:
                    rep.add(f"- FAIL ledger verification: {x}")
                raise Stop("ledger verification did not hold")
            rep.add("- PASS ledger row: present once, name and SHA-256 match the manifest")

        vars_ = {"created_by": f"github-actions:{a.run_id}:{(a.sha or 'local')[:12]}"}
        if a.mode == "verify-only":
            if state == "PRE":
                run_check("A", "A preflight")
                probe_gate()
            elif state == "APPLIED_UNRECORDED":
                run_check("C", "C verification (applied, not yet recorded in the ledger; no preflight baseline)")
                rep.add("- NEXT: run mode record-ledger")
            elif state == "DONE":
                run_check("F", "F final verification")
            else:
                raise Stop(f"database state is {state} (neither pre-apply, applied, nor done): nothing else was run")
        elif a.mode == "apply":
            if state != "PRE":
                raise Stop(f"apply refused: state is {state}, not PRE (nothing was run)")
            base = run_check("A", "A preflight")
            probe_gate()
            try:
                h, r = psql(f("B"), env, timeouts=tmo, tags=tags)
            except Stop as e:
                try:  # B is one transaction: report the state afterwards so the Summary proves nothing was left half-done
                    h2, r2 = psql(f("S"), env, tags=tags)
                    rep.add(f"- state after the failed B: {state_of(h2, r2, pkg)} (B is atomic: a failure leaves the database as it was)")
                except Stop:
                    rep.add("- state after the failed B could not be read")
                raise e
            rep.add(f"- PASS B apply ({len(r)} result columns)")
            run_check("C", "C verification (compared with A)", baseline=base)
            h, r = psql(f("D"), env, vars_, tags=tags)
            fails, _ = evaluate(h, r)
            if fails:
                for x in fails:
                    rep.add(f"- FAIL D ledger: {x}")
                raise Stop("D did not hold")
            rep.add("- PASS D ledger recorded")
            ledger_check()
            run_check("F", "F final verification")
        elif a.mode == "record-ledger":
            if state != "APPLIED_UNRECORDED":
                raise Stop(f"record-ledger refused: state is {state}")
            run_check("C", "C verification (no preflight baseline)")
            h, r = psql(f("D"), env, vars_, tags=tags)
            fails, _ = evaluate(h, r)
            if fails:
                raise Stop("D did not hold: " + "; ".join(fails))
            rep.add("- PASS D ledger recorded")
            ledger_check()
            run_check("F", "F final verification")
        elif a.mode == "rollback":
            if state not in ("APPLIED_UNRECORDED", "DONE"):
                raise Stop(f"rollback refused: state is {state}")
            h, r = psql(f("E"), env, timeouts=tmo, tags=tags)
            fails, _ = evaluate(h, r)
            if fails:
                raise Stop("E result did not hold: " + "; ".join(fails))
            if "G" in pkg["files"]:
                run_check("G", "G state after rollback")
                h2, r2 = psql(f("S"), env, tags=tags)
                after = state_of(h2, r2, pkg)
                rep.add(f"- state after rollback: {after}")
                if after not in ("PRE", "ROLLED_BACK"):
                    raise Stop(f"rollback ran but the state afterwards is {after}, not PRE/ROLLED_BACK")
            rep.add("- PASS E rolled back. The ledger row, if any, is NOT removed automatically.")
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
