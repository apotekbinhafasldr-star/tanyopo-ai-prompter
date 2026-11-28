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
import collections
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
# static lint (v2.1: a real SQL tokenizer + DEFAULT-DENY per statement)
#
# History: v2.0 removed comments with a regex and then matched regexes on the rest. That was wrong: "select '/*'; <cmd>;
# select '*/';" made the lint blind to <cmd> (psql meta-commands, DROP POLICY, an early COMMIT). v2.1 therefore:
#   1. tokenizes the file the way PostgreSQL/psql do: '...' with '' escapes, E'...' with backslash escapes, $tag$...$tag$,
#      "..." identifiers (with ""), U&, -- comments and NESTED /* */ comments. Anything that does not tokenize = rejected.
#   2. rejects, on tokens, anything psql would act on outside a literal: a backslash (psql meta-command), :var / :'var'
#      interpolation (only D may use :'created_by'), E'..' and U&'..' literals.
#   3. splits the file into top-level statements and ACCEPTS ONLY the statement classes listed in classify(); every other
#      statement (INSERT, ALTER POLICY, CREATE INDEX on storage, COPY, LOCK, VACUUM, DO with unknown content, ...) is
#      rejected ("default-deny", fail-closed). Gated classes (drop/create policy or trigger, drop function, UPDATE/INSERT/DELETE,
#      ACL changes outside public) must ALSO match one entry of the package's explicit `allow` list (kind + schema + object +
#      literal names). Identifiers are normalised first ("public"."x" == public.x); a quoted name that is not a plain
#      lower-case identifier is rejected, so no guard can be bypassed with quoting.
#   4. keeps the older FORBIDDEN regexes as a SECOND net, run on the normalised token text of every statement that was not
#      accepted through an allow-list entry. The allow-list can never lift: ownership change (owner\s+to), role switch,
#      session_replication_role, pg_(try_)?advisory locks, dynamic EXECUTE, set_config, COPY, role membership grant
#      (privilege escalation), ALTER DEFAULT PRIVILEGES, psql meta-command, another product's objects.
# Documented limit: the lint cannot prove what an UNQUALIFIED function call does (select some_public_fn()). That is covered by
# review + the read-only transaction used for A/C/F/S/G + ddl_targets/public_refs (every object a package names is pinned in
# the manifest) + the sandbox rehearsal. See docs/PRODUCTION_MIGRATION.md.
# --------------------------------------------------------------------------------------------------------------------
ALLOW_SCHEMAS = ("public", "storage")
ALLOW_KINDS = ("drop_policy", "create_policy", "drop_trigger", "create_trigger", "drop_function", "update_rows", "insert_rows",
               "delete_from", "revoke", "grant")
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

# words that are refused wherever they appear (outside literals), whatever the package says
BAN_WORDS = {
    "set_config", "setval", "pg_notify", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "pg_file_write",
    "pg_sleep", "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_switch_wal", "pg_logical_emit_message",
    "lo_import", "lo_export", "lo_creat", "lo_create", "lo_unlink", "lo_put", "lo_from_bytea", "query_to_xml", "table_to_xml",
    "cursor_to_xml", "query_to_xml_and_xmlschema", "session_replication_role", "current_setting_unsafe",
    # sequences / counters / server-side effects (also refused when double-quoted: the check runs on the normalised identifier)
    "nextval", "currval", "lastval", "txid_current", "pg_current_xact_id", "pg_promote", "pg_rotate_logfile", "pg_create_restore_point",
    "pg_drop_replication_slot", "pg_stat_reset", "pg_stat_reset_shared", "pg_stat_reset_single_table_counters",
    "pg_stat_reset_single_function_counters", "pg_stat_statements_reset", "pg_import_system_collations", "pg_wal_replay_pause",
    "pg_wal_replay_resume", "pg_start_backup", "pg_stop_backup", "pg_backup_start", "pg_backup_stop", "pg_replication_slot_advance",
    "lo_open", "lo_close", "lo_get", "lo_truncate", "lo_lseek", "lo_tell", "lowrite", "loread", "pg_log_backend_memory_contexts",
}
BAN_PREFIX_MORE = ("pg_replication_origin", "pg_create_", "pg_copy_", "pg_ls_", "pg_read_", "pg_stat_reset", "pg_backup_",
                   "pg_wal_replay", "pg_logical_slot_", "pg_drop_")
# product words: any identifier or literal that names another product's object is refused
OTHER_PRODUCT_RE = re.compile(r"publoe|mitapeng|umkmpro|kagura|apotek", re.I)
# in a string literal the shared project name "umkmpro-ai" may be mentioned (messages); other umkmpro* names may not
OTHER_PRODUCT_LIT_RE = re.compile(r"publoe|mitapeng|kagura|apotek|umkmpro(?![-_ ]*ai\b)", re.I)

BAN_PREFIX = ("dblink", "pg_advisory", "pg_try_advisory")

# Unqualified names that may be followed by "(" in a statement that runs at apply time: pure built-ins only. Evidence per function:
# pg_proc.provolatile is 'i' (immutable) or 's' (stable) for every overload in pg_catalog (PG16), except clock_timestamp/statement_timestamp/
# gen_random_uuid (volatile but read-only). Words that are SQL keywords are NOT here: see SQL_RESERVED/SQL_COLNAME below.
PURE_FUNCS = {
    "now", "clock_timestamp", "statement_timestamp", "count", "sum", "min", "max", "avg", "bool_and", "bool_or", "every", "md5",
    "array_agg", "string_agg", "jsonb_agg", "json_agg", "jsonb_build_object", "json_build_object",
    "jsonb_build_array", "to_char", "to_date", "to_timestamp", "to_number", "to_regclass", "to_regprocedure", "to_regproc", "to_regtype",
    "to_regnamespace", "to_regrole", "regexp_replace", "regexp_match", "regexp_matches", "length", "char_length", "lower", "upper", "concat",
    "concat_ws", "replace", "substr", "btrim", "ltrim", "rtrim", "left", "right", "format", "quote_ident",
    "quote_literal", "split_part", "string_to_array", "array_to_string", "array_length", "cardinality", "unnest", "generate_series",
    "date_trunc", "date_part", "age", "abs", "round", "floor", "ceil", "ceiling", "jsonb_array_length", "jsonb_typeof",
    "jsonb_extract_path_text", "jsonb_object_keys", "gen_random_uuid", "pg_get_functiondef", "pg_get_function_identity_arguments",
    "pg_get_function_arguments", "pg_get_expr", "pg_get_constraintdef", "pg_get_indexdef", "pg_get_triggerdef", "pg_get_viewdef",
    "has_function_privilege", "has_table_privilege", "has_schema_privilege", "has_column_privilege", "has_sequence_privilege",
    "has_any_column_privilege", "pg_has_role", "to_jsonb", "to_json", "jsonb_each", "jsonb_each_text", "row_to_json", "aclexplode",
    "jsonb_array_elements", "jsonb_array_elements_text", "chr", "obj_description", "pg_get_userbyid", "row_number", "rank", "dense_rank",
    "current_setting", "pg_typeof", "current_schema",
    # added after QA delta (all immutable/stable in pg_proc, PG16): none writes, none reads outside the catalog/arguments
    "strpos", "lpad", "rpad", "initcap", "array_append", "array_prepend", "array_cat", "array_remove", "array_position",
    "regexp_split_to_array", "jsonb_set", "jsonb_object_agg", "format_type", "mod", "power", "sqrt", "make_date", "col_description",
    "current_database", "version", "pg_size_pretty", "pg_get_serial_sequence", "pg_table_is_visible", "percentile_cont", "lag", "lead",
    "first_value", "last_value",
}
# PostgreSQL 16 pg_get_keywords(): catcode R (reserved) and C (cannot be a function or type name) words are SQL syntax, never a call of a
# user function, so they may precede "(" (select, in, exists, values, coalesce, interval, ...). Unreserved (U) and type_func (T) words CAN
# be user function names ("set", "first", "key", "range", "filter", ...) and are only accepted in the exact syntactic contexts below.
SQL_RESERVED = set("""all analyse analyze and any array as asc asymmetric both case cast check collate column constraint create
current_catalog current_date current_role current_time current_timestamp current_user default deferrable desc distinct do else end except
false fetch for foreign from grant group having in initially intersect into lateral leading limit localtime localtimestamp not null offset on
only or order placing primary references returning select session_user some symmetric system_user table then to trailing true union unique
user using variadic when where window with""".split())
SQL_COLNAME = set("""between bigint bit boolean char character coalesce dec decimal exists extract float greatest grouping inout int integer
interval json_array json_arrayagg json_object json_objectagg least national nchar none normalize nullif numeric out overlay position
precision real row setof smallint substring time timestamp treat trim values varchar xmlattributes xmlconcat xmlelement xmlexists xmlforest
xmlnamespaces xmlparse xmlpi xmlroot xmlserialize xmltable""".split())
# non-reserved words allowed before "(" only directly after one of these words (or "::" for the type-name words)
PAREN_CTX = {"by": {"order", "group", "partition"}, "key": {"primary", "foreign"},
             "join": {"inner", "left", "right", "full", "cross", "natural", "outer"}, "varying": {"character", "char", "bit"},
             "timestamptz": {"::"}, "timetz": {"::"}, "varbit": {"::"}}
PLPGSQL_FIRST = {"if", "elsif", "elseif", "while", "return", "perform", "raise", "assert"}  # only as the first token of a statement/head
INDEX_METHODS = {"btree", "hash", "gin", "gist", "spgist", "brin"}
OBJ_WORDS = {"table", "policy", "function", "trigger", "index", "schema", "role", "user", "extension", "database", "view", "sequence",
             "type", "or", "unique", "materialized", "publication", "subscription", "procedure", "domain", "temp", "temporary",
             "unlogged", "rule", "aggregate", "operator", "server", "foreign", "column", "constraint", "owned", "default", "event"}


class LintError(Exception):
    """The text does not tokenize like PostgreSQL would read it: treated as a violation (fail-closed)."""


class Deny(Exception):
    """A statement is outside the accepted classes (message = reason, never object contents)."""


Tok = collections.namedtuple("Tok", "kind text start end")
_DQ = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")
_PARAM = re.compile(r"\$\d+")
WORD_RE = re.compile(r"[A-Za-z_\u0080-\U0010ffff][A-Za-z0-9_$\u0080-\U0010ffff]*")
NUM_RE = re.compile(r"(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?")


def _scan_sq(sql, i, esc):
    """sql[i] == "'" -> index after the closing quote. '' is an escaped quote; with esc (E'..') a backslash escapes the next char."""
    n, j = len(sql), i + 1
    while j < n:
        c = sql[j]
        if esc and c == "\\":
            j += 2
            continue
        if c == "'":
            if j + 1 < n and sql[j + 1] == "'":
                j += 2
                continue
            return j + 1
        j += 1
    raise LintError("unterminated string literal")


def tokenize(sql):
    """Token list [(kind, text, start, end)]. kinds: ws comment str estr qid dq word num param pvar meta punct."""
    if "\r" in sql:
        # psql ends a -- comment at CR, the tokenizer would not: refuse instead of guessing (defence in depth, verify_package also refuses CR)
        raise LintError("carriage return in SQL text")
    out, i, n = [], 0, len(sql)

    def add(kind, j):
        nonlocal i
        out.append(Tok(kind, sql[i:j], i, j))
        i = j

    while i < n:
        c = sql[i]
        if c.isspace():
            j = i + 1
            while j < n and sql[j].isspace():
                j += 1
            add("ws", j)
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            add("comment", n if j < 0 else j)
        elif sql.startswith("/*", i):
            depth, j = 1, i + 2
            while depth:
                a, b = sql.find("/*", j), sql.find("*/", j)
                if b < 0:
                    raise LintError("unterminated block comment")
                if 0 <= a < b:
                    depth, j = depth + 1, a + 2
                else:
                    depth, j = depth - 1, b + 2
            add("comment", j)
        elif c == "'":
            add("str", _scan_sq(sql, i, False))
        elif c == '"':
            j = i + 1
            while True:
                k = sql.find('"', j)
                if k < 0:
                    raise LintError("unterminated quoted identifier")
                if k + 1 < n and sql[k + 1] == '"':
                    j = k + 2
                    continue
                j = k + 1
                break
            add("qid", j)
        elif c == "$":
            m = _DQ.match(sql, i)
            if m:
                k = sql.find(m.group(0), m.end())
                if k < 0:
                    raise LintError("unterminated dollar-quoted string")
                add("dq", k + len(m.group(0)))
            else:
                m2 = _PARAM.match(sql, i)
                add("param" if m2 else "punct", m2.end() if m2 else i + 1)
        elif c == "\\":
            add("meta", i + 1)
        elif c == ":":
            if sql.startswith("::", i):
                add("punct", i + 2)
            elif i + 1 < n and (sql[i + 1] in "'\"{" or WORD_RE.match(sql, i + 1)):
                add("pvar", i + 1)
            else:
                add("punct", i + 1)
        else:
            m = WORD_RE.match(sql, i)
            if m:
                if m.group(0) in ("e", "E") and m.end() < n and sql[m.end()] == "'":
                    add("estr", _scan_sq(sql, m.end(), True))
                else:
                    add("word", m.end())
                continue
            m = NUM_RE.match(sql, i)
            if m and m.end() > i:
                add("num", m.end())
                continue
            add("punct", i + 1)
    return out


def sig_tokens(toks):
    return [t for t in toks if t.kind not in ("ws", "comment")]


def dq_body(t):
    m = _DQ.match(t.text)
    return t.text[len(m.group(0)):-len(m.group(0))]


def split_statements(sig):
    out, cur = [], []
    for t in sig:
        if t.kind == "punct" and t.text == ";":
            if cur:
                out.append(cur)
            cur = []
        else:
            cur.append(t)
    if cur:
        out.append(cur)
    return out


def is_w(t, *ws):
    return t.kind == "word" and t.text.lower() in ws


def lw(t):
    return t.text.lower() if t.kind == "word" else None


def ident(t, strict=True):
    """Normalised identifier: unquoted -> lower-case; "quoted" -> its content. strict: only plain [a-z_][a-z0-9_]* is accepted."""
    if t.kind == "word":
        v = t.text.lower()
    elif t.kind == "qid":
        v = t.text[1:-1].replace('""', '"')
    else:
        raise Deny("identifier expected")
    if not v or (strict and not re.fullmatch(r"[a-z_][a-z0-9_]*", v)):
        raise Deny("quoted/odd identifier is not a plain lower-case name")
    return v


def qname(s, i, strict=True):
    parts = [ident(s[i], strict)]
    i += 1
    while i + 1 < len(s) and s[i].kind == "punct" and s[i].text == "." and s[i + 1].kind in ("word", "qid"):
        parts.append(ident(s[i + 1], strict))
        i += 2
    return parts, i


def need(s, i, *ws):
    if i >= len(s) or not is_w(s[i], *ws):
        raise Deny("unexpected statement shape")
    return i + 1


def norm_text(s):
    """Normalised statement text: words lower-case, "quoted" plain names unquoted, strings -> '', no spaces around dots."""
    parts = []
    for t in s:
        if t.kind == "word":
            parts.append(t.text.lower())
        elif t.kind == "qid":
            v = t.text[1:-1].replace('""', '"')
            parts.append(v if re.fullmatch(r"[a-z_][a-z0-9_]*", v) else t.text)
        elif t.kind in ("str", "estr"):
            parts.append("''")
        elif t.kind == "dq":
            parts.append("$$")
        else:
            parts.append(t.text)
    out = ""
    for p in parts:
        if out and p not in (".", ",", ";", ")", "(") and not out.endswith((".", "(")):
            out += " "
        out += p
    return out


def norm_literal(text):
    """Statement text -> comparison key (used for rollback_allowed_statements): raw string contents kept."""
    s = split_statements(sig_tokens(tokenize(text)))
    return [" ".join(t.text.lower() if t.kind in ("word",) else t.text for t in st) for st in s]


def depth0(s, pred, start=0):
    d = 0
    for k in range(start, len(s)):
        t = s[k]
        if t.kind == "punct" and t.text == "(":
            d += 1
        elif t.kind == "punct" and t.text == ")":
            d -= 1
        elif d == 0 and pred(t):
            return k
    return -1


def match_paren(s, i):
    """s[i] is '(' -> index of its matching ')' or -1."""
    d = 0
    for k in range(i, len(s)):
        if s[k].kind == "punct" and s[k].text == "(":
            d += 1
        elif s[k].kind == "punct" and s[k].text == ")":
            d -= 1
            if d == 0:
                return k
    return -1


def split_commas(s):
    out, cur, d = [], [], 0
    for t in s:
        if t.kind == "punct" and t.text in "([":
            d += 1
        elif t.kind == "punct" and t.text in ")]":
            d -= 1
        if d == 0 and t.kind == "punct" and t.text == ",":
            out.append(cur)
            cur = []
        else:
            cur.append(t)
    out.append(cur)
    return out


def sig_string(name, toks):
    """Canonical function signature name(type, type) from the tokens between '(' and ')' (types only)."""
    return f"{name}({','.join(norm_text(part) for part in split_commas(toks) if part)})"


def norm_sig(text):
    s = sig_tokens(tokenize(text))
    name = ident(s[0])
    return sig_string(name, s[2:-1])


class Ctx:
    def __init__(self, name, allow, used, role, txn, literals, allow_pvar, pins=None, pin_hits=None):
        self.name, self.allow, self.used, self.role, self.txn = name, allow or [], used, role, txn
        # T1: per-package function-body pins (already filtered to ONE scope by verify_package). pin = the pin matched by the function being linted.
        self.pins, self.pin_hits, self.pin, self.last_pin = pins or [], pin_hits if pin_hits is not None else PinHits(), None, None
        self.literals, self.allow_pvar = literals, allow_pvar
        self.out, self.targets, self.fn_name = [], set(), None
        self.literal_hits = set()
        # what the statements need at apply time (feeds the read-only privilege probes): see derive_needs()
        self.need_tables, self.need_fn, self.fn_created, self.tbl_created, self.need_schema = {}, set(), set(), set(), set()

    def bad(self, why):
        self.out.append(f"{self.name}: {why}")


def _entry_ok(e, op):
    if e.get("kind") != op["kind"] or e.get("schema") != op["schema"]:
        return False
    k = op["kind"]
    if k in ("drop_policy", "create_policy", "drop_trigger", "create_trigger"):
        if e.get("table") != op["table"] or op["name"] not in e.get("names", []):
            return False
        if k == "create_trigger" and e.get("functions") is not None and op.get("fn") not in e["functions"]:
            return False
        return True
    if k == "drop_function":
        return op["sig"] in e.get("signatures", [])
    if k == "update_rows":
        return (e.get("table") == op["table"] and bool(op["columns"]) and set(op["columns"]) <= set(e.get("columns", []))
                and (op["where"] or not e.get("require_where", True)))
    if k == "insert_rows":
        return e.get("table") == op["table"] and bool(op["columns"]) and set(op["columns"]) <= set(e.get("columns", []))
    if k == "delete_from":
        if e.get("table") != op["table"] or not (op["where"] or not e.get("require_where", True)):
            return False
        return e.get("in_function") is None or e.get("in_function") == op["in_function"]
    if k in ("revoke", "grant"):
        return (op["obj"] in e.get("objects", []) and set(op["privileges"]) <= set(e.get("privileges", []))
                and set(op["roles"]) <= set(e.get("roles", [])) and (not op["grant_option"] or e.get("grant_option", False)))
    return False


_entry_matches = _entry_ok  # name kept for older callers


def _describe(op):
    k = op["kind"]
    if k in ("revoke", "grant"):
        return f"{k} {','.join(op['privileges'])} on {op['schema']}.{op['obj']} -> {','.join(op['roles'])}"
    if k == "drop_function":
        return f"drop_function {op['schema']}.{op['sig']}"
    tail = ":" + op["name"] if op.get("name") else ""
    return f"{k} {op['schema']}.{op.get('table', '')}{tail}"


def _need(ctx, schema, obj, *kinds):
    ctx.need_tables.setdefault(f"{schema}.{obj}", set()).update(kinds)


def _op_needs(ctx, op):
    k, sc = op["kind"], op["schema"]
    if k in ("drop_policy", "create_policy", "drop_trigger"):
        _need(ctx, sc, op["table"], "owner")
    elif k == "create_trigger":
        _need(ctx, sc, op["table"], "owner", "trigger")
    elif k == "update_rows":
        _need(ctx, sc, op["table"], "select", "update")
    elif k == "insert_rows":
        _need(ctx, sc, op["table"], "insert")
    elif k == "delete_from":
        _need(ctx, sc, op["table"], "select", "delete")
    elif k == "drop_function":
        ctx.need_fn.add(f"{sc}.{op['sig']}")
    elif k in ("revoke", "grant"):
        if op.get("otype") == "function":
            ctx.need_fn.add(f"{sc}.{op['sig']}")
        else:
            _need(ctx, sc, op["obj"], "owner")


def gate(ctx, op):
    """The op must match ONE allow-list entry. Returns True when it did (so the FORBIDDEN second net skips the statement)."""
    _op_needs(ctx, op)
    idx = next((i for i, e in enumerate(ctx.allow) if _entry_ok(e, op)), None)
    if idx is None:
        ctx.bad(f"{_describe(op)} is not in the package allow-list")
        return True
    if ctx.used is not None:
        ctx.used.add(idx)
    return True


# ---- statement parsers (each returns True when the statement was accepted through an allow-list entry) -----------------
def p_drop_policy_trigger(ctx, s, kind):
    i = 2
    if is_w(s[i], "if"):
        i = need(s, i + 1, "exists")
    name = ident(s[i], False)
    i = need(s, i + 1, "on")
    parts, i = qname(s, i)
    if len(parts) != 2 or i != len(s):
        raise Deny("expected: DROP <POLICY|TRIGGER> [IF EXISTS] name ON schema.table (nothing else)")
    ctx.targets.add(f"{kind}:{parts[0]}.{parts[1]}:{name}")
    return gate(ctx, {"kind": f"drop_{kind}", "schema": parts[0], "table": parts[1], "name": name})


def p_create_policy(ctx, s):
    name = ident(s[2], False)
    i = need(s, 3, "on")
    parts, i = qname(s, i)
    if len(parts) != 2:
        raise Deny("schema-qualified table required")
    ctx.targets.add(f"policy:{parts[0]}.{parts[1]}:{name}")
    return gate(ctx, {"kind": "create_policy", "schema": parts[0], "table": parts[1], "name": name})


def p_create_trigger(ctx, s, i):
    # create [or replace] [constraint] trigger NAME {before|after|instead of} ... on schema.table ... execute function|procedure f()
    name = ident(s[i], False)
    j = depth0(s, lambda t: is_w(t, "on"), i + 1)
    if j < 0:
        raise Deny("trigger without ON table")
    parts, j2 = qname(s, j + 1)
    if len(parts) != 2:
        raise Deny("schema-qualified table required")
    k = depth0(s, lambda t: is_w(t, "execute"), j2)
    if k < 0 or k + 1 >= len(s) or not is_w(s[k + 1], "function", "procedure"):
        raise Deny("trigger needs EXECUTE FUNCTION")
    fparts, _ = qname(s, k + 2)
    if len(fparts) == 2 and fparts[0] != "public":
        raise Deny("trigger function must be in public")
    ctx.targets.add(f"trigger:{parts[0]}.{parts[1]}:{name}")
    return gate(ctx, {"kind": "create_trigger", "schema": parts[0], "table": parts[1], "name": name, "fn": fparts[-1]})


def p_drop_function(ctx, s):
    i = 2
    if is_w(s[i], "if"):
        i = need(s, i + 1, "exists")
    parts, i = qname(s, i)
    if len(parts) != 2 or i >= len(s) or not (s[i].kind == "punct" and s[i].text == "("):
        raise Deny("expected DROP FUNCTION schema.name(argument types)")
    close = match_paren(s, i)
    if close < 0 or close != len(s) - 1:
        raise Deny("DROP FUNCTION must end after the argument list (no CASCADE)")
    sig = sig_string(parts[1], s[i + 1:close])
    ctx.targets.add(("function:" if parts[0] == "public" else f"function:{parts[0]}.") + parts[1])
    return gate(ctx, {"kind": "drop_function", "schema": parts[0], "name": parts[1], "sig": sig})


_TRIVIAL_WORDS = {"true", "false", "not", "and", "or", "is", "null", "in", "any", "all", "exists", "select", "from", "distinct", "unknown"}


def _where_ok(clause):
    """A WHERE clause must exist, must reference a column/parameter, and must not be an obvious tautology (TRUE, 1=1, '... OR TRUE').
    Documented limit: a tautology written some other way cannot be excluded by a lint; the allow-list entry + review cover that."""
    core = [t for t in clause if not (t.kind == "punct" and t.text in "()")]
    if not core:
        return False
    w = [lw(t) for t in core]
    if len(core) == 1 and w[0] in ("true", "false", "null"):
        return False
    for k, x in enumerate(w):
        if x == "true" and ((k and w[k - 1] == "or") or (k + 1 < len(w) and w[k + 1] == "or")):
            return False
    for k in range(len(core) - 2):
        if core[k].kind == "num" and core[k + 1].text == "=" and core[k + 2].kind == "num" and core[k].text == core[k + 2].text:
            return False
    return any((t.kind in ("qid", "param") or (t.kind == "word" and lw(t) not in _TRIVIAL_WORDS)) for t in core)


def _tail_clause(s, start, stops):
    j = depth0(s, lambda t: lw(t) in stops, start)
    return s[start:] if j < 0 else s[start:j]


def p_update(ctx, s, phase):
    i = 1
    if is_w(s[i], "only"):
        i += 1
    parts, i = qname(s, i)
    if len(parts) != 2:
        raise Deny("UPDATE needs a schema-qualified table (search_path is not trusted)")
    schema, table = parts
    if phase == "fn" and schema == "public":
        return False  # a function body that updates public tables: the table is pinned by public_refs / ddl_targets
    if i < len(s) and is_w(s[i], "as"):
        i += 1
    if i < len(s) and not is_w(s[i], "set") and s[i].kind in ("word", "qid"):
        i += 1  # alias
    i = need(s, i, "set")
    stop = depth0(s, lambda t: is_w(t, "where", "from", "returning"), i)
    setl = s[i:] if stop < 0 else s[i:stop]
    cols = []
    for item in split_commas(setl):
        if len(item) < 3 or item[0].kind not in ("word", "qid") or not (item[1].kind == "punct" and item[1].text == "="):
            raise Deny("SET list item is not 'column = expression'")
        cols.append(ident(item[0]))
    w = depth0(s, lambda t: is_w(t, "where"), i)
    has_where = False
    if w >= 0:
        has_where = _where_ok(_tail_clause(s, w + 1, {"returning"}))
        if not has_where:
            raise Deny("UPDATE WHERE clause is missing or trivially true")
    if schema != "public":
        ctx.targets.add(f"rows:{schema}.{table}")
    return gate(ctx, {"kind": "update_rows", "schema": schema, "table": table, "columns": sorted(set(cols)), "where": has_where})


def p_delete(ctx, s, phase):
    i = need(s, 1, "from")
    if is_w(s[i], "only"):
        i += 1
    parts, i = qname(s, i)
    if len(parts) != 2:
        raise Deny("DELETE needs a schema-qualified table")
    w = depth0(s, lambda t: is_w(t, "where"), i)
    has_where = False
    if w >= 0:
        has_where = _where_ok(_tail_clause(s, w + 1, {"returning"}))
        if not has_where:
            raise Deny("DELETE WHERE clause is missing or trivially true")
    ctx.targets.add(f"rows:{parts[0]}.{parts[1]}")
    return gate(ctx, {"kind": "delete_from", "schema": parts[0], "table": parts[1], "where": has_where, "in_function": ctx.fn_name})


def p_insert(ctx, s, phase):
    i = need(s, 1, "into")
    parts, i = qname(s, i)
    if ctx.role == "ledger" and parts == ["supabase_migrations", "schema_migrations"] and phase == "top":
        return False
    if len(parts) != 2:
        raise Deny("INSERT needs a schema-qualified table")
    schema, table = parts
    if phase == "fn" and schema == "public":
        return False
    cols = []
    if i < len(s) and s[i].kind == "punct" and s[i].text == "(" and not (i + 1 < len(s) and is_w(s[i + 1], "select", "with", "values")):
        close = match_paren(s, i)
        if close < 0:
            raise Deny("INSERT column list is not closed")
        cols = [ident(item[0]) for item in split_commas(s[i + 1:close]) if item and item[0].kind in ("word", "qid")]
    ctx.targets.add(f"rows:{schema}.{table}")
    return gate(ctx, {"kind": "insert_rows", "schema": schema, "table": table, "columns": sorted(set(cols))})


def p_acl(ctx, s):
    verb = lw(s[0])
    on = depth0(s, lambda t: is_w(t, "on"), 1)
    if on < 0:
        raise Deny("role membership grant (privilege escalation) or unrecognised ACL statement")
    privs = []
    for item in split_commas(s[1:on]):
        ws = [lw(t) for t in item]
        if ws and ws[-1] == "privileges":
            ws = ws[:-1]
        if len(ws) != 1 or ws[0] is None or ws[0] not in KNOWN_PRIVS:
            raise Deny("only plain privilege names are accepted (no column lists, no GRANT OPTION FOR)")
        privs.append(ws[0])
    i = on + 1
    otype = "table"
    if is_w(s[i], "table", "function", "sequence"):
        otype = lw(s[i])
        i += 1
    elif is_w(s[i], "all", "schema", "database", "domain", "language", "foreign", "type", "large", "tablespace", "procedure", "routine"):
        raise Deny("bulk ACL change or unsupported object type")
    parts, i = qname(s, i)
    if len(parts) != 2:
        raise Deny("schema-qualified object required")
    fsig = None
    if otype == "function":
        if i >= len(s) or not (s[i].kind == "punct" and s[i].text == "("):
            raise Deny("function ACL needs an argument list")
        close = match_paren(s, i)
        if close < 0:
            raise Deny("function argument list not closed")
        fsig = sig_string(parts[1], s[i + 1:close])
        i = close + 1
    if i >= len(s) or not is_w(s[i], "to" if verb == "grant" else "from"):
        raise Deny("expected TO/FROM")
    roles, grant_opt = [], False
    rest = s[i + 1:]
    k = 0
    cur = []
    items = []
    while k < len(rest):
        t = rest[k]
        if t.kind == "punct" and t.text == ",":
            items.append(cur)
            cur = []
        elif is_w(t, "with") and k + 2 < len(rest) + 0 and is_w(rest[k + 1], "grant") and is_w(rest[k + 2], "option"):
            grant_opt = True
            k += 2
        elif is_w(t, "cascade", "restrict"):
            pass
        elif is_w(t, "granted", "group"):
            raise Deny("GRANTED BY / GROUP is not accepted")
        else:
            cur.append(t)
        k += 1
    items.append(cur)
    for it in items:
        if len(it) != 1 or it[0].kind not in ("word", "qid"):
            raise Deny("grantee must be a plain role name")
        r = ident(it[0], False) if it[0].kind == "qid" else it[0].text.lower()
        if r in ("current_user", "session_user", "current_role"):
            raise Deny("grantee must be a plain role name")
        roles.append(r)
    if not roles or not roles[0]:
        raise Deny("no grantee")
    schema, obj = parts
    ctx.targets.add((("function:" if otype == "function" else "table:") + obj) if schema == "public" else f"acl:{schema}.{obj}")
    privs_n = sorted(set(privs))
    gated = schema != "public" or grant_opt or (verb == "grant" and set(roles) & SENSITIVE_GRANTEES)
    op = {"kind": verb, "schema": schema, "obj": obj, "privileges": privs_n, "roles": sorted(set(roles)), "grant_option": grant_opt,
          "otype": otype, "sig": fsig}
    if not gated:
        _op_needs(ctx, op)
        return False
    return gate(ctx, op)


def _depth_scan(s):
    d = 0
    for t in s:
        if t.kind == "punct" and t.text == "(":
            d += 1
        elif t.kind == "punct" and t.text == ")":
            d -= 1
        yield d, t


def check_calls(ctx, s, qualified=True, ddl=False, plpgsql=False):
    """Default-deny for function calls in statements that run at apply time (top level, DO, after COMMIT, DML/DDL expressions).

    A word/quoted identifier directly followed by "(" is a call unless: it is SQL syntax (reserved / col_name keyword, unquoted), it is
    a pure built-in from PURE_FUNCS, or it is a non-reserved keyword in its exact syntactic context (PAREN_CTX, plpgsql statement head).
    Quoted identifiers are normalised first ("nextval" == nextval; "Now" is NOT now; a quoted keyword is a function name).
    schema.name( is refused unless the schema is pg_catalog/information_schema AND the name is pure; a table reference followed by a
    column list (insert into t (..), create index .. on t (..), references t (..) in DDL) is recognised by the word before the schema.
    Not covered (documented): operators, casts, views, RLS/policy functions, triggers and the attribute notation t.fn (no parentheses).
    """
    excl = {"into", "on", "table", "references", "only", "exists"} if ddl else {"into"}
    for k, t in enumerate(s):
        if t.kind not in ("word", "qid") or k + 1 >= len(s) or not (s[k + 1].kind == "punct" and s[k + 1].text == "("):
            continue
        try:
            name = ident(t, False)
        except Deny:
            raise Deny("call of a function with an unreadable name")
        prev = s[k - 1] if k >= 1 else None
        if prev is not None and prev.kind == "punct" and prev.text == ".":
            if k >= 2 and s[k - 2].kind in ("word", "qid") and not (k >= 3 and s[k - 3].kind == "punct" and s[k - 3].text == "."):
                before = s[k - 3] if k >= 3 else None
                if before is not None and before.kind == "word" and before.text.lower() in excl:
                    continue  # "<into|on|table|references> schema.table (column list)"
                sch = ident(s[k - 2], False)
                if sch in ("pg_catalog", "information_schema") and name in PURE_FUNCS:
                    continue
            raise Deny("call of a schema-qualified function that is not a pure built-in")
        if prev is not None and (prev.kind in ("str", "num", "qid", "param") or (prev.kind == "punct" and prev.text in (")", "]"))):
            continue  # an operand precedes: infix keyword, alias with a column list ("(subquery) r(n)"); never a call start
        if prev is not None and is_w(prev, "as"):
            continue  # "... as a(x, o)" alias / "as numeric(10,2)" type
        pw = prev.text.lower() if prev is not None and prev.kind in ("word", "punct") else None
        if t.kind == "word":
            if name in SQL_RESERVED or name in SQL_COLNAME:
                continue
            if name in PURE_FUNCS:
                continue
            if name in PAREN_CTX and pw in PAREN_CTX[name]:
                continue
            if name == "conflict" and pw == "on" and is_w(s[0], "insert") and not any(is_w(x, "join") for x in s[:k]):
                continue  # INSERT ... ON CONFLICT (cols); in a JOIN ... ON the same word would be a user function
            if name == "materialized" and pw == "not" and k >= 2 and is_w(s[k - 2], "as"):
                continue  # WITH x AS NOT MATERIALIZED (...)
            if plpgsql and name in PLPGSQL_FIRST and (k == 0 or pw in ("begin", "loop", "declare")):
                continue  # plpgsql statement head inside a DO body only; never after then/else (CASE in plain SQL)
            if ddl and name in INDEX_METHODS and pw == "using":
                continue
            if (ddl and name in ("timestamptz", "timetz", "varbit") and prev is not None and prev.kind in ("word", "qid") and pw not in SQL_RESERVED
                    and k >= 2 and (is_w(s[k - 2], "column") or (s[k - 2].kind == "punct" and s[k - 2].text in ("(", ",")))):
                continue  # type with a precision at a column-definition position: "add column c timestamptz(3)" / "(.., c timestamptz(3))"
        elif name in PURE_FUNCS:
            continue
        raise Deny("call of a function that is not a pure built-in (unregistered / schema-less user function)")


def read_stmt(ctx, s, phase):
    """select/with/values/table: no writes. Top-level and DO: no SELECT INTO, no FOR UPDATE, no qualified user-function call."""
    words = [lw(t) for t in s]
    for k, w in enumerate(words):
        if w is None:
            continue
        if w in ("insert", "update") and phase == "fn" and _pin_cte_dml_ok(ctx, s, k):
            continue  # T1: declared data-modifying CTE of a pinned function body
        if w in ("insert", "delete", "merge", "truncate", "copy", "call", "grant", "revoke", "alter", "drop", "create", "vacuum"):
            raise Deny(f"'{w}' inside a read statement (data-modifying CTE or similar)")
        if w == "update":
            if not (phase == "fn" and k > 0 and words[k - 1] in ("for", "key")):
                raise Deny("'update' inside a read statement")
        if w == "into" and phase == "top":
            raise Deny("SELECT INTO creates a table")
        if w == "execute":
            raise Deny("dynamic EXECUTE")
    if phase in ("top", "do"):
        check_calls(ctx, s, qualified=True, plpgsql=(phase == "do"))
    return False


def p_alter_table(ctx, s):
    check_calls(ctx, s, True, ddl=True)  # DEFAULT / CHECK expressions run at apply time
    i = 2
    if is_w(s[i], "if"):
        i = need(s, i + 1, "exists")
    if is_w(s[i], "only"):
        i += 1
    parts, i = qname(s, i)
    if len(parts) != 2 or parts[0] != "public":
        raise Deny("ALTER TABLE is accepted on public tables only")
    ctx.targets.add(f"table:{parts[1]}")
    _need(ctx, "public", parts[1], "owner")
    for act in split_commas(s[i:]):
        w = [lw(t) for t in act]
        ok = (w[:1] == ["add"] or w[:2] == ["validate", "constraint"] or w[:4] in (["enable", "row", "level", "security"], ["force", "row", "level", "security"])
              or (w[:2] == ["alter", "column"] and w[3:5] in (["set", "default"], ["drop", "default"], ["set", "not"], ["drop", "not"])))
        if not ok:
            raise Deny("ALTER TABLE action is not in the accepted list (add column/constraint, alter column default/not null, enable/force RLS)")
    return False


def p_create_index(ctx, s):
    check_calls(ctx, s, True, ddl=True)  # index expressions / predicate run at apply time
    i = 1
    if is_w(s[i], "unique"):
        i += 1
    i = need(s, i, "index")
    if is_w(s[i], "concurrently"):
        raise Deny("CREATE INDEX CONCURRENTLY cannot run inside the transaction")
    if is_w(s[i], "if"):
        i = need(s, i + 1, "not")
        i = need(s, i, "exists")
    name = ident(s[i])
    i = need(s, i + 1, "on")
    if is_w(s[i], "only"):
        i += 1
    parts, i = qname(s, i)
    if len(parts) != 2 or parts[0] != "public":
        raise Deny("CREATE INDEX is accepted on public tables only")
    ctx.targets.update({f"index:{name}", f"table:{parts[1]}"})
    _need(ctx, "public", parts[1], "owner")
    return False


def p_create_table(ctx, s, temp):
    i = need(s, 2 if temp else 1, "table")
    if is_w(s[i], "if"):
        i = need(s, i + 1, "not")
        i = need(s, i, "exists")
    parts, i = qname(s, i)
    if not temp:
        check_calls(ctx, s, True, ddl=True)
    if temp:
        if len(parts) != 1:
            raise Deny("temporary table must be a bare name")
        j = i
        if j < len(s) and is_w(s[j], "on"):
            j = need(s, j + 1, "commit")
            if is_w(s[j], "drop"):
                j += 1
            elif is_w(s[j], "delete", "preserve"):
                j = need(s, j + 1, "rows")
            else:
                raise Deny("unexpected ON COMMIT action")
        j = need(s, j, "as")
        if j >= len(s) or not (is_w(s[j], "select", "with") or (s[j].kind == "punct" and s[j].text == "(")):
            raise Deny("CREATE TEMP TABLE must be AS SELECT")
        read_stmt(ctx, s[j:], "top")
        return False
    if len(parts) != 2 or parts[0] != "public":
        raise Deny("CREATE TABLE is accepted in public only")
    if i >= len(s) or not (s[i].kind == "punct" and s[i].text == "("):
        raise Deny("CREATE TABLE must list its columns (no AS/LIKE/PARTITION OF)")
    ctx.targets.add(f"table:{parts[1]}")
    ctx.tbl_created.add(f"public.{parts[1]}")
    ctx.need_schema.add("public")
    return False


def p_comment(ctx, s):
    i = need(s, 1, "on")
    if not is_w(s[i], "table", "column", "function"):
        raise Deny("COMMENT ON is accepted for public tables, columns and functions only")
    kind = lw(s[i])
    parts, i = qname(s, i + 1)
    fsig = None
    if kind == "function":
        if i >= len(s) or s[i].text != "(":
            raise Deny("function comment needs an argument list")
        close = match_paren(s, i)
        if close < 0:
            raise Deny("argument list not closed")
        fsig = sig_string(parts[-1], s[i + 1:close])
        i = close + 1
    want = {"table": 2, "column": 3, "function": 2}[kind]
    if len(parts) != want or parts[0] != "public":
        raise Deny("COMMENT ON target must be public.<name>")
    i = need(s, i, "is")
    if i != len(s) - 1 or not (s[i].kind in ("str", "dq") or is_w(s[i], "null")):
        raise Deny("COMMENT must be IS 'literal' or IS NULL")
    ctx.targets.add(("function:" if kind == "function" else "table:") + parts[1])
    if kind == "function":
        ctx.need_fn.add(f"public.{fsig}")
    else:
        _need(ctx, "public", parts[1], "owner")
    return False


_TYPE_FIRST = {"double", "timestamp", "time", "character", "bit", "national", "interval", "varchar", "char", "with", "without"}


# --------------------------------------------------------------------------------------------------------------------
# T1: function-body pins. A pin lifts exactly two lint rules (advisory_xact_lock, dml_cte) for ONE function, in ONE package and scope,
# when the schema-qualified signature AND the exact body bytes (sha256) match. Everything else in the lint still runs on the body.
# --------------------------------------------------------------------------------------------------------------------
PIN_PERMITS = ("advisory_xact_lock", "dml_cte")
PIN_KEYS = {"scope", "signature", "fn_sha256", "body_md5_ws", "db_hash", "permit", "advisory_keys", "dml_targets", "why"}
PIN_MAX = 4


def fn_sha256(header, body):
    """sha256 over the normalised CREATE FUNCTION header tokens (comments/whitespace dropped) + NUL + the EXACT body bytes."""
    return hashlib.sha256((header + "\0" + body).encode("utf-8")).hexdigest()


def pin_header(toks):
    """CREATE FUNCTION tokens before AND after the body, exact (words lower-cased; string literals and quoted names kept verbatim): a changed default or clause unbinds the pin."""
    return " ".join(t.text.lower() if t.kind == "word" else t.text for t in toks)


def body_md5_ws(text):
    return hashlib.md5(re.sub(r"\s+", "", text).encode("utf-8")).hexdigest()


def validate_pins(pins, pkg):
    """Structure of function_body_pins. Literal values only; every declared capability must be narrower than the package's own object lists."""
    if not isinstance(pins, list) or len(pins) > PIN_MAX:
        return [f"function_body_pins: a list of at most {PIN_MAX} entries"]
    out, seen = [], set()
    refs = {"public." + r for r in pkg.get("allowed_public_refs", [])}
    fns = {t.split(":", 1)[1] for t in pkg.get("ddl_targets", []) if t.startswith("function:")}
    for n, p in enumerate(pins):
        w = f"function_body_pins[{n}]"
        if not isinstance(p, dict) or set(p) != PIN_KEYS:
            out.append(f"{w}: keys must be exactly {sorted(PIN_KEYS)}")
            continue
        if p["scope"] not in ("migration", "rollback"):
            out.append(f"{w}.scope: migration|rollback")
        m = re.fullmatch(r"public\.([a-z_][a-z0-9_]*)\([a-z0-9_ ,\[\]]*\)", p["signature"]) if isinstance(p["signature"], str) else None
        if not m or m.group(1) not in fns:
            out.append(f"{w}.signature: public.<function in ddl_targets>(types)")
        if (p["scope"], p["signature"]) in seen:
            out.append(f"{w}: duplicate (scope, signature)")
        seen.add((p["scope"], p["signature"]))
        for k, n_ in (("fn_sha256", 64), ("body_md5_ws", 32)):
            if not (isinstance(p[k], str) and re.fullmatch(r"[0-9a-f]{%d}" % n_, p[k])):
                out.append(f"{w}.{k}: lower-case hex, {n_} characters")
        want_db = "post_fn_hash" if p["scope"] == "migration" else "pre_fn_hash"
        if p["db_hash"] not in (None, want_db) or (p["db_hash"] and pkg.get(p["db_hash"]) != p["body_md5_ws"]):
            out.append(f"{w}.db_hash: null or {want_db} equal to body_md5_ws (ties the lint pin to the database-side body check)")
        pm = p["permit"]
        if not (isinstance(pm, list) and pm and len(set(pm)) == len(pm) and set(pm) <= set(PIN_PERMITS)):
            out.append(f"{w}.permit: a non-empty subset of {PIN_PERMITS}")
            continue
        keys, tg = p["advisory_keys"], p["dml_targets"]
        if ("advisory_xact_lock" in pm) != bool(keys) or not (isinstance(keys, list) and all(isinstance(x, str) and re.fullmatch(r"[a-z_][a-z0-9_]{7,60}", x) for x in keys)):
            out.append(f"{w}.advisory_keys: literal lock-key names, non-empty exactly when advisory_xact_lock is permitted")
        if ("dml_cte" in pm) != bool(tg) or not (isinstance(tg, list) and tg == sorted(set(tg)) and set(tg) <= refs):
            out.append(f"{w}.dml_targets: sorted unique public.<table> entries that are in allowed_public_refs, non-empty exactly when dml_cte is permitted")
        if not (isinstance(p["why"], str) and 10 <= len(p["why"]) <= 200):
            out.append(f"{w}.why: 10..200 characters")
    return out


class PinHits(collections.Counter):
    """How often each (scope, signature) pin matched, plus the matched body text (for the reviewer-facing pin report)."""
    def __init__(self):
        super().__init__()
        self.bodies, self.used = {}, set()


PIN_REPORT = []


def pin_report(pin_m, hits_m, hits_r):
    """Lines for the public Summary: what each pin lets through, and how the pinned new body differs from the pinned old (= live) body."""
    import difflib
    out = []
    for p in pin_m:
        key = (p["scope"], p["signature"])
        out.append(f"- PIN {p['signature']}: lifts {', '.join(p['permit'])}; lock keys {p['advisory_keys']}; CTE writes {p['dml_targets']}")
        new, old = hits_m.bodies.get(key), hits_r.bodies.get(("rollback", p["signature"]))
        if new is not None and old is not None:
            d = [x for x in difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=0) if x[:1] in "+-" and x[:3] not in ("+++", "---")]
            out.append(f"- PIN diff migration body vs rollback (live) body: {len(d)} changed line(s)")
            out += [f"    {x[:160]}" for x in d[:12]]
    return out


def find_pin(ctx, sig_s, header, body_text):
    """The pin whose signature, header+exact-body sha256 AND whitespace-insensitive body md5 all match (else None: the default lint applies)."""
    sha, md = fn_sha256(header, body_text), body_md5_ws(body_text)
    for p in ctx.pins:
        if p["signature"] == sig_s and p["fn_sha256"] == sha and p["body_md5_ws"] == md:
            ctx.pin_hits[(p["scope"], p["signature"])] += 1
            getattr(ctx.pin_hits, "bodies", {})[(p["scope"], p["signature"])] = body_text
            return p
    return None


def _advisory_ok(ctx, sig, k, pin):
    """sig[k] = pg_try_advisory_xact_lock: only `pg_try_advisory_xact_lock(hashtextextended('<declared key>', 0))`, unqualified or pg_catalog."""
    if "advisory_xact_lock" not in pin["permit"]:
        return False
    if k and sig[k - 1].kind == "punct" and sig[k - 1].text == ".":
        if not (k >= 2 and sig[k - 2].kind in ("word", "qid") and ident(sig[k - 2], False) == "pg_catalog") or (k >= 3 and sig[k - 3].text == "."):
            return False
    seq = sig[k + 1:k + 9]
    ok = (len(seq) == 8 and seq[0].text == "(" and seq[1].kind == "word" and seq[1].text.lower() == "hashtextextended" and seq[2].text == "("
            and seq[3].kind == "str" and seq[3].text[1:-1] in pin["advisory_keys"] and "'" not in seq[3].text[1:-1] and seq[4].text == ","
            and seq[5].kind == "num" and seq[5].text == "0" and seq[6].text == ")" and seq[7].text == ")")
    if ok:
        getattr(ctx.pin_hits, "used", set()).add(("key", pin["scope"], seq[3].text[1:-1]))
    return ok


def _pin_cte_dml_ok(ctx, s, k):
    """s[k] is insert|update inside a WITH of a pinned function: only `<cte> as ( insert into <t> ...` / `<cte> as ( update [only] <t> ...` with <t> declared."""
    pin = ctx.pin
    if not pin or "dml_cte" not in pin["permit"] or k < 3:
        return False
    if not (s[k - 1].kind == "punct" and s[k - 1].text == "(" and is_w(s[k - 2], "as") and s[k - 3].kind in ("word", "qid")):
        return False
    j = k + 1
    if lw(s[k]) == "insert":
        if not (j < len(s) and is_w(s[j], "into")):
            return False
        j += 1
    elif j < len(s) and is_w(s[j], "only"):
        j += 1
    try:
        parts, _ = qname(s, j)
    except (Deny, IndexError):
        return False
    ok = len(parts) == 2 and ".".join(parts) in pin["dml_targets"]
    if ok:
        getattr(ctx.pin_hits, "used", set()).add(("dml", pin["scope"], ".".join(parts)))
    return ok


def arg_sig(name, toks):
    """name(type,type) of a CREATE FUNCTION argument list: argument names, modes (OUT is not part of the identity) and defaults dropped."""
    out = []
    for part in split_commas(toks):
        if not part:
            continue
        k = depth0(part, lambda t: is_w(t, "default") or (t.kind == "punct" and t.text == "="))
        part = part if k < 0 else part[:k]
        if part and is_w(part[0], "out"):
            continue
        if part and is_w(part[0], "in", "inout", "variadic"):
            part = part[1:]
        if len(part) >= 2 and part[0].kind in ("word", "qid") and not is_w(part[0], *_TYPE_FIRST):
            part = part[1:]
        out.append(norm_text(part))
    return f"{name}({','.join(out)})"


FN_CLAUSE_START = {"language", "security", "set", "as", "stable", "volatile", "immutable", "strict", "called", "leakproof", "parallel", "cost", "rows", "not", "null", "window"}
FN_CLAUSE_WORDS = {"returns", "setof", "table", "language", "plpgsql", "sql", "security", "definer", "invoker", "set", "search_path", "to",
                   "public", "pg_temp", "pg_catalog", "stable", "volatile", "immutable", "strict", "as", "leakproof", "not", "parallel",
                   "safe", "restricted", "unsafe", "cost", "null", "input", "called", "on", "returns", "rows"}


def p_create_function(ctx, s, i):
    parts, i = qname(s, i)
    if len(parts) != 2 or parts[0] != "public":
        raise Deny("CREATE FUNCTION is accepted in public only (schema-qualified)")
    name = parts[1]
    if name in PURE_FUNCS or name in SQL_RESERVED or name in SQL_COLNAME:
        raise Deny("a function named like a pure built-in would shadow it by overload resolution (md5(1) -> public.md5(int))")
    if i >= len(s) or s[i].text != "(":
        raise Deny("function argument list expected")
    close = match_paren(s, i)
    if close < 0:
        raise Deny("argument list not closed")
    body, body_k, lang, in_returns, depth = None, -1, None, False, 0
    for k in range(close + 1, len(s)):
        t = s[k]
        if t.kind == "punct" and t.text == "(":
            depth += 1
        elif t.kind == "punct" and t.text == ")":
            depth -= 1
        elif depth:
            continue
        elif t.kind == "dq":
            if body is not None:
                raise Deny("two function bodies")
            body, body_k = t, k
        elif t.kind == "str" and is_w(s[k - 1], "as"):
            raise Deny("function body must be dollar-quoted")
        elif t.kind == "word":
            w = lw(t)
            if w in FN_CLAUSE_START:
                in_returns = False
            if w == "returns":
                in_returns = True
            elif w == "language":
                if k + 1 >= len(s) or not is_w(s[k + 1], "plpgsql", "sql"):
                    raise Deny("only LANGUAGE plpgsql or sql is accepted")
                lang = lw(s[k + 1])
            elif w == "set" and not (k + 1 < len(s) and is_w(s[k + 1], "search_path")):
                raise Deny("only SET search_path is accepted in a function header")
            elif not in_returns and w not in FN_CLAUSE_WORDS:
                raise Deny("function header clause is not in the accepted list")
    if body is None or lang is None:
        raise Deny("function needs LANGUAGE plpgsql|sql and a dollar-quoted body")
    ctx.targets.add(f"function:{name}")
    sig_s = "public." + arg_sig(name, s[i + 1:close])
    ctx.fn_created.add(sig_s)
    ctx.need_schema.add("public")
    old = ctx.fn_name
    ctx.fn_name = name
    ctx.pin = ctx.last_pin = find_pin(ctx, sig_s, pin_header(s[:body_k]) + " $body " + pin_header(s[body_k + 1:]), dq_body(body)) if ctx.role == "write" else None
    try:
        lint_body(ctx, dq_body(body), "fn")
    finally:
        ctx.fn_name, ctx.pin = old, None
    return False


def p_do(ctx, s):
    i = 1
    if is_w(s[i], "language"):
        if i + 1 >= len(s) or not is_w(s[i + 1], "plpgsql"):
            raise Deny("DO LANGUAGE must be plpgsql")
        i += 2
    if i != len(s) - 1 or s[i].kind != "dq":
        raise Deny("DO needs exactly one dollar-quoted body")
    lint_body(ctx, dq_body(s[i]), "do")
    return False


TIMEOUT_MAX_MS = {"lock_timeout": 10000, "statement_timeout": 120000}


def _timeout_ms(t):
    """'3s' / '500ms' / '2min' / 3000 (ms) -> milliseconds, or None when it is not a plain positive duration."""
    text = t.text[1:-1] if t.kind == "str" else t.text
    m = re.fullmatch(r"\s*(\d{1,9})\s*(ms|s|min|h|d)?\s*", text, re.I)
    if not m or (t.kind == "str" and "'" in text):
        return None
    mult = {None: 1, "ms": 1, "s": 1000, "min": 60000, "h": 3600000, "d": 86400000}[m.group(2).lower() if m.group(2) else None]
    return int(m.group(1)) * mult


def p_set(ctx, s):
    if (len(s) == 5 and is_w(s[1], "local") and is_w(s[2], "lock_timeout", "statement_timeout") and
            (s[3].kind == "punct" and s[3].text == "=" or is_w(s[3], "to")) and s[4].kind in ("str", "num")):
        ms = _timeout_ms(s[4])
        lim = TIMEOUT_MAX_MS[s[2].text.lower()]
        if ms is None or ms <= 0 or ms > lim:
            raise Deny(f"{s[2].text.lower()} must be a positive duration of at most {lim // 1000}s (0 = unlimited is refused)")
        return False
    raise Deny("only SET LOCAL lock_timeout/statement_timeout = <literal> is accepted")


PREFIX_STOP = {"then", "loop"}


def _strip_prefix(s):
    """plpgsql: peel IF..THEN / ELSIF..THEN / ELSE / BEGIN / DECLARE / FOR..LOOP / WHEN..THEN prefixes, return (head, tail)."""
    head = []
    while s:
        w = lw(s[0])
        if w in ("else", "begin", "declare", "loop"):
            head.append(s[0])
            s = s[1:]
        elif w in ("if", "elsif", "elseif", "for", "foreach", "while", "when", "exception"):
            case, k, d = 0, 0, 0
            cut = -1
            while k < len(s):
                t = s[k]
                if t.kind == "punct" and t.text == "(":
                    d += 1
                elif t.kind == "punct" and t.text == ")":
                    d -= 1
                elif d == 0 and is_w(t, "case"):
                    case += 1
                elif d == 0 and is_w(t, "end") and case:
                    case -= 1
                elif d == 0 and case == 0 and is_w(t, "then", "loop"):
                    cut = k
                    break
                k += 1
            if cut < 0:
                head.extend(s)
                return head, []
            head.extend(s[:cut + 1])
            s = s[cut + 1:]
        else:
            break
    return head, s


GENERIC_START = {"select", "perform", "return", "raise", "end", "null", "exit", "continue", "get", "assert", "open", "close", "fetch",
                 "move", "case", "if"}
HARD_DENY_START = {"commit", "rollback", "savepoint", "release", "execute", "call", "vacuum", "reindex", "cluster", "refresh", "listen",
                   "notify", "unlisten", "prepare", "deallocate", "discard", "load", "import", "reset", "lock", "analyze", "checkpoint",
                   "copy", "start", "begin_", "do", "security", "explain", "show", "truncate", "merge"}


def _anywhere(ctx, toks, phase, allow_into=True):
    """No data/DDL verbs in a segment that does not START with one."""
    w = [lw(t) for t in toks]
    for k, x in enumerate(w):
        nxt = w[k + 1] if k + 1 < len(w) else None
        prev = w[k - 1] if k else None
        if x in ("grant", "revoke", "truncate", "copy", "merge", "vacuum", "execute"):
            raise Deny(f"'{x}' is not accepted here" + (" (dynamic EXECUTE)" if x == "execute" else ""))
        if x == "insert" and nxt == "into":
            raise Deny("INSERT inside a control/read statement")
        if x == "delete" and nxt == "from":
            raise Deny("DELETE inside a control/read statement")
        if x == "update" and prev not in ("for", "do", "key", "on"):
            raise Deny("UPDATE inside a control/read statement")
        if x in ("create", "alter", "drop") and nxt in OBJ_WORDS:
            raise Deny("DDL inside a control/read statement")
        if x == "lock" and nxt == "table":
            raise Deny("LOCK TABLE")


def lint_body(ctx, text, phase):
    """plpgsql / SQL function body or DO body. phase: 'do' (runs at apply time) or 'fn' (definition only)."""
    try:
        sig = sig_tokens(tokenize(text))
    except LintError as e:
        raise Deny(f"body does not tokenize ({e})")
    check_tokens(ctx, sig, in_body=True)
    for seg in split_statements(sig):
        head, tail = _strip_prefix(seg)
        try:
            if head:
                _anywhere(ctx, head, phase)
            if phase == "do" and not (tail and lw(tail[0]) in ("grant", "revoke", "set", "create", "alter", "drop", "comment")):
                check_calls(ctx, seg, qualified=True, plpgsql=True)  # head AND tail together: the head split must not hide a call ("if loop(1) then")
        except Deny as e:
            ctx.bad(f"statement not accepted ({e})")
            continue
        if not tail:
            continue
        first = lw(tail[0])
        try:
            accepted = None
            if first in HARD_DENY_START:
                raise Deny("dynamic EXECUTE is never accepted" if first == "execute" else f"'{first}' is not accepted inside a body")
            if first in ("update", "delete", "insert", "grant", "revoke", "set", "create", "alter", "drop", "comment", "with", "values", "table"):
                accepted = classify(ctx, tail, phase)
            else:
                _anywhere(ctx, tail, phase)
                if first == "select" or first == "perform":
                    read_stmt(ctx, tail, phase)
                accepted = False
        except (Deny, IndexError) as e:
            ctx.bad(f"statement not accepted ({e if isinstance(e, Deny) else 'cannot be parsed'})")
            continue
        if not accepted:
            _second_net(ctx, tail, ctx.pin)


def classify(ctx, s, phase="top"):
    """Return True when accepted through an allow-list entry; raise Deny when the statement class is not accepted."""
    f = lw(s[0])
    if f is None:
        raise Deny("statement does not start with a keyword")
    if f in ("select", "with", "values", "table"):
        if f == "with" and phase == "fn":
            pass
        return read_stmt(ctx, s, phase)
    if ctx.role == "readonly":
        raise Deny("a read-only file may only contain SELECT/WITH statements")
    if f == "set":
        return p_set(ctx, s)
    if f == "do":
        if phase != "top":
            raise Deny("nested DO")
        return p_do(ctx, s)
    if phase != "top" and f in ("create", "alter", "comment") and not (f == "create" and is_w(s[1], "policy", "trigger", "constraint") or
                                                                       f == "create" and is_w(s[1], "or") and is_w(s[2], "replace") and is_w(s[3], "trigger")):
        raise Deny("DDL other than allow-listed policy/trigger statements is not accepted inside a DO/function body")
    if f == "drop":
        if is_w(s[1], "policy"):
            return p_drop_policy_trigger(ctx, s, "policy")
        if is_w(s[1], "trigger"):
            return p_drop_policy_trigger(ctx, s, "trigger")
        if is_w(s[1], "function"):
            return p_drop_function(ctx, s)
        raise Deny("DROP is accepted for allow-listed policy/trigger/function only")
    if f == "create":
        i = 1
        if is_w(s[i], "or"):
            i = need(s, i + 1, "replace")
        if is_w(s[i], "function"):
            return p_create_function(ctx, s, i + 1)
        if i == 1 and is_w(s[1], "policy"):
            return p_create_policy(ctx, s)
        if is_w(s[i], "constraint"):
            i += 1
        if is_w(s[i], "trigger"):
            return p_create_trigger(ctx, s, i + 1)
        if i == 1 and is_w(s[1], "unique", "index"):
            return p_create_index(ctx, s)
        if i == 1 and is_w(s[1], "table"):
            return p_create_table(ctx, s, False)
        if i == 1 and is_w(s[1], "temp", "temporary"):
            return p_create_table(ctx, s, True)
        raise Deny("this CREATE form is not accepted")
    if f == "alter":
        if is_w(s[1], "table"):
            return p_alter_table(ctx, s)
        raise Deny("this ALTER form is not accepted")
    if f == "comment":
        return p_comment(ctx, s)
    if f in ("update", "delete", "insert") and phase == "top":
        check_calls(ctx, s, qualified=True)
    if f == "update":
        return p_update(ctx, s, phase)
    if f == "delete":
        return p_delete(ctx, s, phase)
    if f == "insert":
        return p_insert(ctx, s, phase)
    if f in ("grant", "revoke"):
        return p_acl(ctx, s)
    raise Deny(f"statement class '{f}' is not accepted")


TXN_BEGIN = (["begin"], ["begin", "transaction"], ["begin", "work"], ["start", "transaction"])
TXN_COMMIT = (["commit"], ["commit", "transaction"], ["commit", "work"])
TXN_WORDS = {"begin", "start", "commit", "end", "rollback", "abort", "savepoint", "release", "prepare"}


def txn_kind(s):
    w = [lw(t) for t in s]
    if w in TXN_BEGIN:
        return "begin"
    if w in TXN_COMMIT:
        return "commit"
    if w and w[0] in TXN_WORDS and not (w[0] == "prepare" and w[1:2] != ["transaction"]):
        return "other"
    return None


def check_tokens(ctx, sig, in_body=False):
    """Token-level refusals that hold everywhere (also inside DO/function bodies)."""
    for k, t in enumerate(sig):
        if t.kind == "meta":
            ctx.bad("contains a backslash outside string literals (psql meta-command)")
        elif t.kind == "pvar":
            nxt = sig[k + 1] if k + 1 < len(sig) else None
            if not (ctx.allow_pvar == "any" or (ctx.allow_pvar and nxt is not None and nxt.kind == "str" and nxt.text == "'created_by'")):
                ctx.bad("psql variable interpolation (:name / :'name') is not accepted here")
        elif t.kind == "estr":
            ctx.bad("forbidden SQL (escape-string literal E'...')")
        elif t.kind in ("word", "qid"):
            try:
                v = ident(t, False)
            except Deny:
                continue
            lo = v.lower() if t.kind == "qid" else v
            if lo == "pg_try_advisory_xact_lock" and t.kind == "word" and ctx.pin and in_body and _advisory_ok(ctx, sig, k, ctx.pin):
                pass  # T1: the one declared advisory-lock call of a pinned function body
            elif lo in BAN_WORDS or lo.startswith(BAN_PREFIX) or lo.startswith(BAN_PREFIX_MORE):
                ctx.bad(f"forbidden SQL (function or setting '{lo}' is refused)")
            if OTHER_PRODUCT_RE.search(v):
                ctx.bad("forbidden SQL (other product object)")
            if t.kind == "word" and lo == "u" and k + 2 < len(sig) and sig[k + 1].text == "&" and sig[k + 2].kind in ("str", "qid") \
                    and sig[k + 2].start == sig[k + 1].end:
                ctx.bad("forbidden SQL (U& unicode-escape literal)")
            if k + 2 < len(sig) and sig[k + 1].kind == "punct" and sig[k + 1].text == "." and sig[k + 2].kind in ("word", "qid"):
                try:
                    nxt = ident(sig[k + 2], False)
                except Deny:
                    nxt = ""
                if lo == "public" and re.match(r"(publoe|mitapeng)", nxt, re.I):
                    ctx.bad("forbidden SQL (other product object)")
                if lo == "cron":
                    ctx.bad("forbidden SQL (cron change)")
        elif t.kind == "str" and OTHER_PRODUCT_LIT_RE.search(t.text):
            ctx.bad("forbidden SQL (other product object named in a literal)")


def _second_net(ctx, s, pin=None):
    text = norm_text(s)
    for pat, why in FORBIDDEN:
        if re.search(pat, text, re.I | re.S):
            if why == "advisory lock" and pin and "advisory_xact_lock" in pin["permit"] and \
                    {m.group(0).lower() for m in re.finditer(pat, text, re.I | re.S)} == {"pg_try_advisory_xact_lock"}:
                continue  # T1: only the exact name; pg_advisory_lock / pg_try_advisory_lock / session-level variants stay refused
            ctx.bad(f"forbidden SQL ({why})")
    if re.search(r"\bexecute\s+(?!on\b|function\b|procedure\b)", text):
        ctx.bad("forbidden SQL (dynamic EXECUTE)")


def lint_sql(name, sql, role="write", allow=None, used=None, txn="none", literals=(), allow_pvar=False, targets=None, needs=None, pins=None, pin_hits=None):
    """The one entry point. role: write | readonly | ledger.  txn: none (no transaction control) | wrap (BEGIN first, one COMMIT, only
    SELECTs after it).  Returns [violation, ...]."""
    ctx = Ctx(name, allow, used, role, txn, set(literals or ()), allow_pvar, pins, pin_hits)
    try:
        sig = sig_tokens(tokenize(sql))
    except LintError as e:
        return [f"{name}: SQL does not tokenize ({e})"]
    check_tokens(ctx, sig)
    stmts = split_statements(sig)
    lits = {x for lit in (literals or ()) for x in norm_literal(lit)}
    begins, commits, after_commit = 0, 0, False
    for idx, s in enumerate(stmts):
        ctx.last_pin = None
        ctx.last_pin = None
        key = " ".join(t.text.lower() if t.kind == "word" else t.text for t in s)
        if key in lits:
            continue
        tk = txn_kind(s)
        if tk is not None:
            if txn != "wrap" or role == "readonly":
                ctx.bad("transaction control (BEGIN/COMMIT/ROLLBACK/SAVEPOINT/END/ABORT...) is not allowed in this file")
                continue
            if tk == "begin":
                begins += 1
                if idx != 0:
                    ctx.bad("BEGIN must be the first statement")
            elif tk == "commit":
                commits += 1
                after_commit = True
            else:
                ctx.bad("transaction control other than one BEGIN and one COMMIT is not allowed")
            continue
        try:
            if after_commit and lw(s[0]) not in ("select",):
                raise Deny("only SELECT may follow the COMMIT (everything else would run outside the atomic transaction)")
            accepted = classify(ctx, s, "top")
        except Deny as e:
            ctx.bad(f"statement not accepted ({e}); first words: {' '.join(norm_text(s[:2]).split()[:2])}")
            continue
        except (IndexError, KeyError):
            ctx.bad("statement not accepted (cannot be parsed)")
            continue
        pin, ctx.last_pin = ctx.last_pin, None
        if not accepted and role != "readonly" and lw(s[0]) not in ("do",):
            _second_net(ctx, s, pin)
    if txn == "wrap" and role != "readonly" and (begins != 1 or commits != 1 or (stmts and txn_kind(stmts[0]) != "begin")):
        ctx.bad("a file with its own transaction needs exactly one BEGIN (first) and one COMMIT")
    if targets is not None:
        targets.update(ctx.targets)
    if needs is not None:
        for q, ks in ctx.need_tables.items():
            needs["tables"].setdefault(q, set()).update(ks)
        needs["functions"] |= ctx.need_fn
        needs["created_fn"] |= ctx.fn_created
        needs["created_tables"] |= ctx.tbl_created
        needs["schemas"] |= ctx.need_schema
    return ctx.out


def lint_forbidden(name, sql, allow=None, used=None, txn="none", literals=()):
    return lint_sql(name, sql, "write", allow, used, txn, literals)


def lint_psql_meta(name, sql):
    """psql meta-commands (\\!, \\i, \\copy, \\gset ...) run on the runner host: none is allowed anywhere in a package file."""
    try:
        sig = sig_tokens(tokenize(sql))
    except LintError as e:
        return [f"{name}: SQL does not tokenize ({e})"]
    return [f"{name}: contains a backslash outside string literals (psql meta-command)"] if any(t.kind == "meta" for t in sig) else []


def lint_readonly(name, sql, allow_pvar=False):
    return lint_sql(name, sql, "readonly", allow_pvar=allow_pvar)


def has_txn_control(sql):
    try:
        stmts = split_statements(sig_tokens(tokenize(sql)))
    except LintError:
        return ["(does not tokenize)"]
    return [norm_text(s) for s in stmts if txn_kind(s)]


def check_native_txn(name, sql):
    """Shape N: the file carries its OWN transaction: exactly one top-level BEGIN first and one COMMIT last, nothing else."""
    try:
        stmts = split_statements(sig_tokens(tokenize(sql)))
    except LintError as e:
        return [f"{name}: SQL does not tokenize ({e})"]
    out = []
    kinds = [txn_kind(s) for s in stmts]
    if not stmts or kinds[0] != "begin":
        out.append(f"{name}: native-transaction file must start with BEGIN")
    if not stmts or kinds[-1] != "commit":
        out.append(f"{name}: native-transaction file must end with COMMIT")
    ctl = [k for k in kinds if k]
    if len(ctl) != 2 or ctl.count("other"):
        out.append(f"{name}: expected exactly one BEGIN and one COMMIT at top level, found {len(ctl)} transaction-control statements")
    return out


def _code_streams(sql):
    """Yield every token stream of a file: the top level and (recursively) every dollar-quoted body that tokenizes."""
    try:
        sig = sig_tokens(tokenize(sql))
    except LintError:
        return
    yield sig
    for t in sig:
        if t.kind == "dq":
            yield from _code_streams(dq_body(t))


def _text_literals(sql):
    """Raw text of every literal / dollar body (conservative scan, like the old regex lint)."""
    try:
        sig = sig_tokens(tokenize(sql))
    except LintError:
        return [sql]
    out = []
    for t in sig:
        if t.kind in ("str", "estr"):
            out.append(t.text)
        elif t.kind == "dq":
            out.append(dq_body(t))
            out.extend(_text_literals(dq_body(t)))
    return out


def _qualified_pairs(sql):
    """(schema, object) of every a.b / "a"."b" reference in code, normalised (lenient: odd quoted names are kept as written)."""
    pairs = set()
    for sig in _code_streams(sql):
        for k in range(len(sig) - 2):
            if sig[k].kind in ("word", "qid") and sig[k + 1].kind == "punct" and sig[k + 1].text == "." and sig[k + 2].kind in ("word", "qid"):
                try:
                    pairs.add((ident(sig[k], False).lower() if sig[k].kind == "word" else ident(sig[k], False),
                               ident(sig[k + 2], False).lower() if sig[k + 2].kind == "word" else ident(sig[k + 2], False)))
                except Deny:
                    pass
    return pairs


def ddl_targets(sql):
    """Objects a migration creates/alters/grants on, e.g. {'function:fn_x','table:prompter_invoices','index:uq_x'}: taken from the
    statements the lint accepted (so quoting/comments cannot hide one). Policies/triggers/rows/ACLs outside public are listed too."""
    t = set()
    lint_sql("targets", sql, "write", allow=None, used=None, txn="wrap" if has_txn_control(sql) else "none", targets=t,
             allow_pvar="any")
    return t


def public_refs(sql):
    refs = {b for a, b in _qualified_pairs(sql) if a == "public"}
    for lit in _text_literals(sql):
        refs |= {m.group(1).lower() for m in re.finditer(r"\bpublic\.\"?(\w+)", lit, re.I)}
    return refs


FOREIGN_SCHEMAS = "storage|auth|vault|cron|supabase_migrations|extensions|realtime|net|pgsodium|supabase_functions"


def foreign_refs(sql):
    """schema.object references to Supabase-managed schemas (e.g. storage.objects). Opt-in per package (allowed_foreign_refs)."""
    fs = set(FOREIGN_SCHEMAS.split("|"))
    refs = {f"{a}.{b}" for a, b in _qualified_pairs(sql) if a in fs}
    for lit in _text_literals(sql):
        refs |= {f"{m.group(1).lower()}.{m.group(2).lower()}" for m in re.finditer(rf"\b({FOREIGN_SCHEMAS})\.\"?(\w+)", lit, re.I)}
    return refs


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
            keys |= {"signatures"}
        elif k == "insert_rows":
            keys |= {"table", "columns"}
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
        lists = [x for x in ("names", "signatures", "columns", "objects", "roles", "functions", "privileges") if x in keys]
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
                elif lk == "signatures" and not (re.fullmatch(r"[a-z_][a-z0-9_]*\([a-z0-9_ ,\[\]]*\)", x) and norm_sig(x) == x):
                    problems.append(f"{w}: signatures must be canonical name(type,type) with no spaces after commas")
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


def check_unused(entries, used, label):
    return [f"{label}[{i}] is not used by any statement (stale allow-list entry)" for i in range(len(entries)) if i not in used]


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
    if not isinstance(spec, dict) or set(spec) - {"tables", "functions", "replaces", "schemas", "ledger_insert"}:
        return [f"{label}: unknown structure"]
    for t in spec.get("tables", []):
        if not (isinstance(t, dict) and TABLE_RE.match(str(t.get("table", ""))) and isinstance(t.get("need"), list) and t["need"]
                and set(t["need"]) <= PROBE_NEEDS and set(t) <= {"table", "need"}):
            problems.append(f"{label}.tables: each entry needs a literal public/storage table and a non-empty need list")
    for f_ in list(spec.get("functions", [])) + list(spec.get("replaces", [])):
        if not (isinstance(f_, str) and FUNC_RE.match(f_)):
            problems.append(f"{label}.functions: literal schema.name(argtypes) required")
    for s in spec.get("schemas", []):
        if s not in ALLOW_SCHEMAS:
            problems.append(f"{label}.schemas: schema must be one of {ALLOW_SCHEMAS}")
    return problems


def derive_needs(*sqls):
    """What the apply (and the rollback) statements need: {'tables': {schema.t: {owner,...}}, 'functions': {schema.sig},
    'replaces': {schema.sig}, 'schemas': {...}} taken from the statements the lint parsed (so it cannot drift from the SQL)."""
    n = {"tables": {}, "functions": set(), "created_fn": set(), "created_tables": set(), "schemas": set()}
    for sql in sqls:
        lint_sql("needs", sql, "write", allow=None, txn="wrap" if has_txn_control(sql) else "none", needs=n, allow_pvar="any")
    # objects the package itself creates need no pre-existing owner (the rollback may drop/alter what the migration created)
    return {"tables": {t: k for t, k in n["tables"].items() if t not in n["created_tables"]},
            "functions": n["functions"] - n["created_fn"], "replaces": n["created_fn"], "schemas": n["schemas"]}


def derive_probe_spec(pkg, texts=None):
    """Privilege probes mirror the package: the allow-lists (+ explicit `probes`) and, when `texts` (migration, rollback SQL) is given,
    the statements themselves say which rights the apply will need (ownership of altered tables/functions, CREATE on public ...).
    A package with neither (no allow-list, no texts) has an empty spec and runs no probe."""
    tables, funcs, repl, schemas = {}, set(), set(), set()

    def need(t, *ks):
        tables.setdefault(t, set()).update(ks)

    for e in list(pkg.get("allow", [])) + list(pkg.get("rollback_allow", [])):
        k, sc = e["kind"], e["schema"]
        if k in ("drop_policy", "create_policy", "drop_trigger"):
            need(f"{sc}.{e['table']}", "owner")
        elif k == "create_trigger":
            need(f"{sc}.{e['table']}", "owner", "trigger")
        elif k == "update_rows":
            need(f"{sc}.{e['table']}", "select", "update")
        elif k == "insert_rows":
            need(f"{sc}.{e['table']}", "insert")
        elif k == "delete_from":
            need(f"{sc}.{e['table']}", "select", "delete")
        elif k == "drop_function":
            funcs.update(f"{sc}.{x}" for x in e["signatures"])
        elif k in ("revoke", "grant"):
            for o in e["objects"]:
                need(f"{sc}.{o}", "owner")
    if texts:
        n = derive_needs(*texts)
        for t, ks in n["tables"].items():
            need(t, *ks)
        funcs |= n["functions"]
        repl |= n["replaces"]
        schemas |= n["schemas"]
    ex = pkg.get("probes", {})
    for t in ex.get("tables", []):
        need(t["table"], *t["need"])
    spec = {"tables": [{"table": t, "need": sorted(n_)} for t, n_ in sorted(tables.items())],
            "functions": sorted((funcs - repl) | set(ex.get("functions", []))), "replaces": sorted(repl),
            "schemas": sorted(schemas | set(ex.get("schemas", []))),
            "ledger_insert": bool(ex.get("ledger_insert") or pkg.get("ledger_verify"))}
    return spec if (spec["tables"] or spec["functions"] or spec["replaces"] or spec["schemas"] or spec["ledger_insert"]) else None


def lint_rollback(name, text, pkg, allow, used, txn="none", pins=None, pin_hits=None):
    """The rollback may only drop what the migration added, listed LITERALLY (statement equality on tokens, not a text substitution)."""
    return lint_sql(name, text, "write", allow, used, txn, pkg.get("rollback_allowed_statements", []), pins=pins, pin_hits=pin_hits)


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
    pins = pkg.get("function_body_pins", [])
    problems += validate_pins(pins, pkg)
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
    pin_m, pin_r = [p for p in pins if p["scope"] == "migration"], [p for p in pins if p["scope"] == "rollback"]
    hits_m, hits_r = PinHits(), PinHits()
    native = shape == "native-txn"
    for k, text in texts.items():
        problems += lint_psql_meta(f"file {k}", text)
        if k == "E":
            problems += lint_rollback("file E", text, pkg, rallow, None, txn="wrap", pins=pin_r)
        elif k == "B":
            problems += lint_sql("file B", text, "write", allow, None, "wrap", pins=pin_m)
        elif k == "D":
            problems += lint_sql("file D", text, "ledger", None, None, "wrap", allow_pvar=True)
        else:
            problems += lint_readonly(f"file {k}", text)
    problems += lint_psql_meta("migration", mig) + lint_psql_meta("rollback", rb)
    problems += lint_sql("migration", mig, "write", allow, used_m, "wrap" if native else "none", pins=pin_m, pin_hits=hits_m)
    problems += lint_rollback("rollback", rb, pkg, rallow, used_r, txn="wrap" if native else "none", pins=pin_r, pin_hits=hits_r)
    problems += [f"function_body_pins: pin {p['scope']} {p['signature']} matched {h[(p['scope'], p['signature'])]} time(s) (must be exactly 1: stale or unused pin)"
                 for p, h in [(p, hits_m) for p in pin_m] + [(p, hits_r) for p in pin_r] if h[(p["scope"], p["signature"])] != 1]
    for p, h in [(p, hits_m) for p in pin_m] + [(p, hits_r) for p in pin_r]:
        unused = [f"{k}:{x}" for k, x in [("key", x) for x in p["advisory_keys"]] + [("dml", x) for x in p["dml_targets"]] if (k, p["scope"], x) not in h.used]
        if unused and h[(p["scope"], p["signature"])] == 1:
            problems.append(f"function_body_pins: {p['scope']} {p['signature']} declares capabilities its body does not use: {unused}")
    global PIN_REPORT
    PIN_REPORT = pin_report(pin_m, hits_m, hits_r)
    problems += check_unused(allow, used_m, "allow") + check_unused(rallow, used_r, "rollback_allow")
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
    b_stmts = split_statements(sig_tokens(tokenize(b)))
    if any(norm_text(st).startswith("insert into supabase_migrations") for st in b_stmts):
        problems.append("file B writes the migration ledger (only D may)")
    d_sig = sig_tokens(tokenize(texts["D"]))
    d_stmts = split_statements(d_sig)
    ins = [st for st in d_stmts if norm_text(st).startswith("insert into supabase_migrations.schema_migrations")]
    bad_first = [st for st in d_stmts if lw(st[0]) in ("update", "delete", "drop", "truncate", "alter", "create", "grant", "revoke")]
    if len(ins) != 1 or not any(t.kind == "str" and t.text == f"'{pkg['version']}'" for t in d_sig) or bad_first:
        problems.append("file D must do exactly one ledger INSERT of the manifest version and nothing else")
    if not any(t.kind == "pvar" and k + 1 < len(d_sig) and d_sig[k + 1].text == "'created_by'" for k, t in enumerate(d_sig)):
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
SAFE_CELL_RE = re.compile(r"^(?:t|f|-?\d{1,19}|[0-9a-f]{32}|[0-9a-f]{64}|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[+-]\d{2}(?::?\d{2})?|Z)?)?$")
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


def pg_options(timeouts=None, readonly=False):
    t = {"lock_ms": 3000, "statement_ms": 120000}
    t.update(timeouts or {})
    # readonly: the server itself refuses writes in A/C/F/S/G and the probes, whatever their text says (defence in depth next to the lint)
    return (f"-c statement_timeout={int(t['statement_ms'])} -c lock_timeout={int(t['lock_ms'])} "
            "-c idle_in_transaction_session_timeout=60000 -c client_min_messages=warning"
            + (" -c default_transaction_read_only=on" if readonly else ""))


# ---------------------------------------------------------------------------------------------------------------------
# execution layer (PR-1 structural controls; the lint above is a tripwire, these are what the SERVER enforces)
#  1. every file runs in a session that first sets search_path = pg_catalog, pg_temp: an unqualified function/operator/type name can
#     only resolve to pg_catalog (closes keyword-named functions, attribute notation t.fn, overload shadowing md5(1) -> public.md5(int));
#     a schema-qualified name is NOT closed by this (x.y( is detected by the lint and, at apply, by the effects check below)
#  2. SQL goes to the server with psql -c (never -f): psql then performs no meta-command and no :variable interpolation on it;
#     the few :'name' variables are substituted here, as quoted literals, from validated values
#  3. check phase = BEGIN READ ONLY + one query (snapshot taken, so SET TRANSACTION READ WRITE is refused) ... ROLLBACK
#  4. apply phase = the runner splits the file at its single COMMIT and, before it, verifies from the server what the transaction did
# ---------------------------------------------------------------------------------------------------------------------
SESSION_SQL = "set search_path = pg_catalog, pg_temp; set standard_conforming_strings = on"
SNAPSHOT_SQL = "do $$ begin perform 1; end $$"
EFFECT_TAGS = ("EFEK DI LUAR DAFTAR",)
LEDGER_EFFECTS = (["supabase_migrations.schema_migrations"], [], [])
_LIT_OK = re.compile(r"[A-Za-z0-9_ .:\-]{1,160}")


def _sig_or_stop(text):
    try:
        return tokenize(text)
    except LintError as e:
        raise Stop(f"SQL does not tokenize ({e})")


def subst_pvars(text, variables):
    """Replace psql :'name' with a quoted SQL literal (standard_conforming_strings = on). Any other colon-variable form is refused."""
    toks = _sig_or_stop(text)
    out, pos, k = [], 0, 0
    while k < len(toks):
        t = toks[k]
        if t.kind == "meta":
            raise Stop("psql meta-command in SQL text")
        if t.kind == "pvar":
            nxt = toks[k + 1] if k + 1 < len(toks) else None
            if nxt is None or nxt.kind != "str" or nxt.start != t.end:
                raise Stop("unsupported psql variable form (only :'name' is substituted)")
            name = nxt.text[1:-1]
            val = (variables or {}).get(name)
            if not isinstance(val, str) or re.search(r"[\x00-\x08\x0b-\x1f\x7f]|\r|\n", val):
                raise Stop("psql variable has no safe value")
            out.append(text[pos:t.start])
            out.append("'" + val.replace("'", "''") + "'")
            pos = nxt.end
            k += 2
            continue
        k += 1
    out.append(text[pos:])
    return "".join(out)


def split_txn(text):
    """(head_through_BEGIN, middle, tail_from_COMMIT) for a file with exactly one BEGIN (first) and one COMMIT; else Stop."""
    toks = _sig_or_stop(text)
    sig = [t for t in toks if t.kind not in ("ws", "comment")]
    stmts, cur = [], []
    for t in sig:
        cur.append(t)
        if t.kind == "punct" and t.text == ";":
            stmts.append(cur)
            cur = []
    if cur:
        stmts.append(cur)
    kinds = [txn_kind([t for t in st if not (t.kind == "punct" and t.text == ";")]) for st in stmts]
    if not stmts or kinds[0] != "begin" or kinds.count("begin") != 1 or kinds.count("commit") != 1 or kinds.count("other"):
        raise Stop("file does not have exactly one BEGIN (first) and one COMMIT: the effects check cannot be placed")
    ci = kinds.index("commit")
    return text[:stmts[0][-1].end], text[stmts[0][-1].end:stmts[ci][0].start], text[stmts[ci][0].start:]


def _lit(s):
    if not isinstance(s, str) or not _LIT_OK.fullmatch(s):
        raise Stop("effects check: an object name has characters the runner does not embed")
    return "'" + s.replace("'", "''") + "'"


def _arr(items):
    return "array[" + ", ".join(_lit(x) for x in sorted(items)) + "]::text[]" if items else "array[]::text[]"


# catalog facts that no package may change (names/hashes stay inside the server; only a fixed message comes back)
_GLOBAL_PARTS = [
    ("roles", "(select coalesce(string_agg(rolname || rolsuper::text || rolcreaterole::text || rolcreatedb::text || rolcanlogin::text || rolreplication::text"
              " || rolbypassrls::text || rolinherit::text, ',' order by rolname), '') from pg_roles)"),
    ("memberships", "(select coalesce(string_agg(roleid::text || '>' || member::text, ',' order by roleid, member), '') from pg_auth_members)"),
    ("schemas", "(select coalesce(string_agg(nspname, ',' order by nspname), '') from pg_namespace where nspname !~ '^pg_temp|^pg_toast_temp')"),
    ("extensions", "(select coalesce(string_agg(extname, ',' order by extname), '') from pg_extension)"),
    ("event_triggers", "(select coalesce(string_agg(evtname, ',' order by evtname), '') from pg_event_trigger)"),
    ("publications", "(select coalesce(string_agg(pubname, ',' order by pubname), '') from pg_publication)"),
    ("foreign_servers", "(select coalesce(string_agg(srvname, ',' order by srvname), '') from pg_foreign_server)"),
    ("languages", "(select coalesce(string_agg(lanname, ',' order by lanname), '') from pg_language)"),
    ("casts", "(select count(*)::text from pg_cast where oid >= 16384)"),
    ("operators", "(select count(*)::text from pg_operator where oid >= 16384)"),
    ("types", "(select count(*)::text from pg_type where oid >= 16384 and (typtype in ('d', 'e', 'r', 'm') or (typtype = 'b' and typcategory <> 'A')))"),
    ("other_relations", "(select coalesce(string_agg(n.nspname || '.' || c.relname, ',' order by n.nspname, c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace"
                        " where n.nspname not in ('public', 'storage', 'pg_catalog', 'information_schema') and n.nspname !~ '^pg_(toast|temp)' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S'))"),
    ("other_functions", "(select coalesce(string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
                        " where n.nspname not in ('public', 'storage', 'pg_catalog', 'information_schema') and n.nspname !~ '^pg_(toast|temp)')"),
]
# object names inside the two schemas a package may change
_ITEMS_EXPR = (
    "(select coalesce(string_agg(x, E'\\n' order by x), '') from ("
    "select 'r:' || n.nspname || '.' || c.relname as x from pg_class c join pg_namespace n on n.oid = c.relnamespace"
    " where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S', 'i')"
    " union all select 'f:' || n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
    " where n.nspname in ('public', 'storage')"
    " union all select 'p:' || schemaname || '.' || tablename || '.' || policyname from pg_policies where schemaname in ('public', 'storage')"
    " union all select 't:' || n.nspname || '.' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid"
    " join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public', 'storage')"
    ") i(x))")


def effects_baseline_sql():
    return ("do $linoe$ begin "
            "if current_setting('track_counts') <> 'on' then raise exception 'EFEK DI LUAR DAFTAR: track_counts is off (the check would prove nothing)'; end if; "
            "perform set_config('linoe.tx0', txid_current()::text, true); "
            + "".join(f"perform set_config('linoe.g_{lbl}', md5({ex}), true); " for lbl, ex in _GLOBAL_PARTS) +
            f"perform set_config('linoe.c0', {_ITEMS_EXPR}, true); "
            "end $linoe$")


def effects_check_sql(written, names, prefixes):
    """Runs INSIDE the transaction, just before COMMIT. A raise aborts the transaction (psql ON_ERROR_STOP) = nothing is committed."""
    return ("do $linoe$ declare v_n int; begin "
            "if txid_current()::text is distinct from current_setting('linoe.tx0', true) then raise exception 'EFEK DI LUAR DAFTAR: transaction is not the one that started'; end if; "
            + "".join(f"if md5({ex}) is distinct from current_setting('linoe.g_{lbl}', true) then raise exception 'EFEK DI LUAR DAFTAR: catalog facts outside the package changed ({lbl})'; end if; "
                      for lbl, ex in _GLOBAL_PARTS) +
            "select count(*) into v_n from pg_stat_xact_all_tables s where (s.n_tup_ins + s.n_tup_upd + s.n_tup_del) > 0 "
            "and s.schemaname not in ('pg_catalog', 'information_schema', 'pg_toast') and s.schemaname !~ '^pg_temp' "
            f"and (s.schemaname || '.' || s.relname) <> all ({_arr(written)}); "
            "if v_n > 0 then raise exception 'EFEK DI LUAR DAFTAR: a table outside the package list was written'; end if; "
            f"with a as (select unnest(string_to_array(current_setting('linoe.c0', true), E'\\n')) as x), b as (select unnest(string_to_array({_ITEMS_EXPR}, E'\\n')) as x), "
            "d as ((select x from a except select x from b) union all (select x from b except select x from a)), "
            "e as (select x, case left(x, 2) when 'r:' then regexp_replace(x, '^r:[^.]*[.]', '') when 'f:' then regexp_replace(split_part(x, '(', 1), '^f:[^.]*[.]', '') "
            "when 'p:' then regexp_replace(x, '^p:[^.]*[.][^.]*[.]', '') else regexp_replace(x, '^t:[^.]*[.][^.]*[.]', '') end as bare from d) "
            f"select count(*) into v_n from e where not (bare = any ({_arr(names)}) or exists (select 1 from unnest({_arr(prefixes)}) q where starts_with(bare, q))); "
            "if v_n > 0 then raise exception 'EFEK DI LUAR DAFTAR: an object outside the package list was added or removed'; end if; "
            "end $linoe$")


def derive_effects(text, extra_statements=()):
    """(tables a package may write, object names it may add/remove/replace, name prefixes of implicit objects) from the lint's own targets."""
    written, names, prefixes = set(), set(), set()
    for st in extra_statements:  # manifest rollback_allowed_statements (e.g. "drop index if exists public.x"): the objects they name may disappear
        names.update(re.findall(r"\b(?:public|storage)\.([a-z_][a-z0-9_]*)", st))
    for t in ddl_targets(text):
        kind, _, rest = t.partition(":")
        if kind == "rows":
            written.add(rest)
        elif kind == "table":
            written.add("public." + rest)
            names.add(rest)
            prefixes.add(rest + "_")
        elif kind in ("function", "index"):
            names.add(rest.split(".")[-1])
        elif kind in ("policy", "trigger"):
            names.add(rest.split(":", 1)[1])
    return sorted(written), sorted(names), sorted(prefixes)


def run_sql(text, env, variables=None, timeouts=None, tags=None, mode="ro", fmt="csv", effects=None, label="file"):
    """Run SQL text in ONE psql session built from -c items. mode 'ro': BEGIN READ ONLY + snapshot + ROLLBACK. mode 'w': the text carries
    its own BEGIN/COMMIT; with effects=(written, names, prefixes) the runner verifies the transaction before the COMMIT."""
    text = subst_pvars(text, variables)
    if text.lstrip().startswith("\\"):
        raise Stop("SQL text starts with a backslash")
    t = {"lock_ms": 3000, "statement_ms": 120000}
    t.update(timeouts or {})
    # timeouts are ALSO set inside the session: a pooler that drops PGOPTIONS (Supavisor: UNKNOWN) must not remove them
    items = [SESSION_SQL, f"set statement_timeout = {int(t['statement_ms'])}; set lock_timeout = {int(t['lock_ms'])}"]
    if mode == "ro":
        items += ["begin read only", SNAPSHOT_SQL, text, "rollback"]
    elif effects is not None:
        head, mid, tail = split_txn(text)
        items += [head, effects_baseline_sql()] + ([mid] if mid.strip() else []) + [effects_check_sql(*effects), tail]
    else:
        items += [text]
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
    cmd += ["--csv"] if fmt == "csv" else ["-At", "-F", fmt]
    cmd += ["-d", env.get("PGDATABASE", "postgres")]
    for it in items:
        cmd += ["-c", it]
    e = dict(env)
    e["PGOPTIONS"] = pg_options(timeouts, mode == "ro")
    e["PGCONNECT_TIMEOUT"] = "20"
    r = subprocess.run(cmd, env=e, capture_output=True, text=True)
    if r.returncode != 0:
        raise Stop(f"psql failed for {label}: {safe_error(r.stderr, env, tuple(tags or GUARD_TAGS_DEFAULT) + EFFECT_TAGS)}")
    return r.stdout


def _read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def psql(path, env, variables=None, timeouts=None, tags=None, all_rows=False, readonly=False, effects=None):
    """Run a SQL file, return (header, row) of the LAST result set parsed from CSV, or ([], []).
    all_rows=True (single-SELECT files only): (header, [rows])."""
    out = run_sql(_read(path), env, variables, timeouts, tags, "ro" if readonly else "w", "csv", effects, os.path.basename(path))
    rows = [x for x in csv.reader(io.StringIO(out)) if x]
    if all_rows:
        return (rows[0], rows[1:]) if rows else ([], [])
    if len(rows) < 2:
        return [], []
    return rows[-2], rows[-1]


def psql_at(path, env, sep):
    """Read-only audit files printed unaligned. Returns stdout; failure -> Stop with a redacted reason."""
    return run_sql(_read(path), env, None, None, None, "ro", sep, None, os.path.basename(path))


HARUS = re.compile(r"_harus_(true|false|ge_(\d+)|(\d+))$")


def evaluate(header, row, baseline=None, require_harus=False):
    """Return (failures, notes). The expectation is encoded in the column NAME (_harus_*, _catat, _samakan_A, _info)."""
    fails, notes = [], []
    base = {}
    if require_harus and (not header or not any(HARUS.search(h) for h in header)):
        # an empty result or a result without a single _harus_* column proves nothing: it is a failure, never a silent pass
        return ["result has no _harus_* expectation column (empty result)"], notes
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
LEDGER_PRE_SQL = os.path.join(HERE, "ledger_precheck_readonly.sql")
PROBE_STATUS = ("PASS", "BLOCK", "UNKNOWN", "INFO")


def run_probes(spec, env, rep, tags=None):
    """Read-only privilege probes. Returns (n_pass, n_block, n_unknown). Prints probe id + status only (no object names)."""
    h, rows = psql(PROBE_SQL, env, {"probe_spec": json.dumps(spec, separators=(",", ":"))}, tags=tags, all_rows=True, readonly=True)
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
        for line in PIN_REPORT:
            rep.add(line)
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
        with open(os.path.join(a.root, pkg["migration"]["path"]), encoding="utf-8") as fm_, open(os.path.join(a.root, pkg["rollback"]["path"]), encoding="utf-8") as fr_:
            spec = derive_probe_spec(pkg, [fm_.read(), fr_.read()])
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
        hdr, row = psql(f("S"), env, tags=tags, readonly=True)
        state = state_of(hdr, row, pkg)
        rep.add(f"- state: {state}")

        def run_check(key, label, baseline=None):
            h, r = psql(f(key), env, tags=tags, readonly=True)
            bad = check_log_safe(h, r, skip=("keadaan",))
            if bad:
                for x in bad:
                    rep.add(f"- FAIL {label}: {x}")
                raise Stop(f"{label} produced output outside the log-safe grammar")
            fails, notes = evaluate(h, r, baseline, require_harus=True)
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
            h, r = psql(LEDGER_SQL, env, {"ver": pkg["version"], "nm": pkg["name"], "sha": pkg["migration"]["sha256"]}, tags=tags, readonly=True)
            fails, _ = evaluate(h, r, require_harus=True)
            if fails:
                for x in fails:
                    rep.add(f"- FAIL ledger verification: {x}")
                raise Stop("ledger verification did not hold")
            rep.add("- PASS ledger row: present once, name and SHA-256 match the manifest")

        def ledger_precheck():
            """Before B and again before D: the version and the NAME must not be in the ledger yet (a duplicate name would make D's ON CONFLICT silently record nothing)."""
            if not pkg.get("ledger_verify"):
                return
            h, r = psql(LEDGER_PRE_SQL, env, {"ver": pkg["version"], "nm": pkg["name"]}, tags=tags, readonly=True)
            fails, _ = evaluate(h, r, require_harus=True)
            if fails:
                for x in fails:
                    rep.add(f"- FAIL ledger pre-check: {x}")
                raise Stop("ledger pre-check did not hold: version or name already in the ledger; nothing was written")
            rep.add("- PASS ledger pre-check: neither the version nor the name is in the ledger yet")

        vars_ = {"created_by": f"github-actions:{a.run_id}:{(a.sha or 'local')[:12]}"}
        if a.mode == "verify-only":
            if state == "PRE":
                run_check("A", "A preflight")
                probe_gate()
                ledger_precheck()
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
            ledger_precheck()
            try:
                h, r = psql(f("B"), env, timeouts=tmo, tags=tags, effects=derive_effects(_read(f("B"))))
            except Stop as e:
                try:  # report the state afterwards: only when it is PRE do we say the database was left as it was
                    h2, r2 = psql(f("S"), env, tags=tags, readonly=True)
                    st2 = state_of(h2, r2, pkg)
                    if st2 == "PRE":
                        rep.add("- state after the failed B: PRE (B is a single transaction: one BEGIN, one COMMIT, nothing after COMMIT but SELECT; checked by the lint)")
                    else:
                        rep.add(f"- state after the failed B: {st2}. STATE TIDAK PRE: periksa manual (jangan jalankan apa pun lagi sebelum dicek).")
                except Stop:
                    rep.add("- state after the failed B could not be read. STATE TIDAK PRE: periksa manual.")
                raise e
            rep.add(f"- PASS B apply ({len(r)} result columns)")
            run_check("C", "C verification (compared with A)", baseline=base)
            ledger_precheck()
            h, r = psql(f("D"), env, vars_, tags=tags, effects=LEDGER_EFFECTS)
            fails, _ = evaluate(h, r, require_harus=True)
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
            ledger_precheck()
            h, r = psql(f("D"), env, vars_, tags=tags, effects=LEDGER_EFFECTS)
            fails, _ = evaluate(h, r, require_harus=True)
            if fails:
                raise Stop("D did not hold: " + "; ".join(fails))
            rep.add("- PASS D ledger recorded")
            ledger_check()
            run_check("F", "F final verification")
        elif a.mode == "rollback":
            if state not in ("APPLIED_UNRECORDED", "DONE"):
                raise Stop(f"rollback refused: state is {state}")
            h, r = psql(f("E"), env, timeouts=tmo, tags=tags, effects=derive_effects(_read(f("E")), pkg.get("rollback_allowed_statements", [])))
            # E must prove something: its own _harus_* result, or (packages with G) the G check that follows; never an empty pass
            fails, _ = evaluate(h, r, require_harus="G" not in pkg["files"])
            if fails:
                raise Stop("E result did not hold: " + "; ".join(fails))
            if "G" in pkg["files"]:
                run_check("G", "G state after rollback")
                h2, r2 = psql(f("S"), env, tags=tags, readonly=True)
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
