"""Unit tests for T1 = `function_body_pins` (production pipeline tool; NO package, NO pin entry in the real manifest).
A pin lifts exactly two lint rules (`pg_try_advisory_xact_lock` of a declared literal key, data-modifying CTEs into declared public tables)
for ONE function body in ONE package and ONE scope (migration or rollback), bound by sha256 of header + exact body bytes. Everything else still runs.
All fixtures are SYNTHETIC copies of tests/fixtures/fx-n built in a temp dir (nothing under supabase/migrations is read). No database.
Run: python3 -m unittest discover -s supabase/prod-packages/tests
These tests only ADD constraints: test_tools.py (p0-2) and test_tools_v2.py are unchanged and must keep passing.
Documented limit (tested, not hidden): an author who changes the body AND the pin together passes the lint (same class as the package
checksum); the controls are PR separation (tool vs package), the reviewer diff printed in the Summary, db_hash and independent QA."""
import copy
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import run_package as rp  # noqa: E402

FX = "supabase/prod-packages/tests/fixtures"
FX_DIR = FX + "/fx-n"
MIG = FX_DIR + "/migration/20990101000000_fixture_native_txn.sql"
DOWN = FX_DIR + "/rollback/20990101000000_fixture_native_txn.down.sql"
SIG = "public.fn_fx_sync(interval)"
KEY = "fx_alert_sync_lock"
TARGETS = ["public.fx_alert_actions", "public.fx_alert_evidence", "public.fx_alerts"]

FN = """create or replace function public.fn_fx_sync(p_lookback interval default interval '45 days')
returns table(skipped boolean, created integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
  v_ev integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('fx_alert_sync_lock', 0)) then
    return query select true, 0;
    return;
  end if;
  with a as (
    insert into public.fx_alerts (kind, transaction_id)
    select 'late', e.transaction_id from public.fx_evidence e
    where e.source_system = '@SRC@' and e.created_at > now() - p_lookback
    returning id
  ), ev as (
    insert into public.fx_alert_evidence (alert_id, note) select id, 'x' from a
    returning 1
  ), ac as (
    update public.fx_alert_actions set state = 'closed' where state = 'open' and created_at < now() - interval '400 days'
    returning 1
  )
  select (select count(*) from a), (select count(*) from ev) into v_n, v_ev;
  return query select false, v_n + v_ev;
end
$$;
"""
NEW_SRC, OLD_SRC = "midtrans' or e.source_system = 'doku", "midtrans"
FN_NEW = FN.replace("@SRC@", NEW_SRC)   # migration body: differs from the live (rollback) body in exactly one line
FN_OLD = FN.replace("@SRC@", OLD_SRC)


def body_of(text, nth=0):
    return re.findall(r"as \$\$(.*?)\$\$;", text, re.S)[nth]


def header_of(text, nth=0):
    """Normalised header tokens (before and after the body) of the nth CREATE statement: the same function the runner uses."""
    st = [x for x in rp.split_statements(rp.sig_tokens(rp.tokenize(text))) if rp.lw(x[0]) == "create"][nth]
    k = next(i for i, t in enumerate(st) if t.kind == "dq")
    return rp.pin_header(st[:k]) + " $body " + rp.pin_header(st[k + 1:])


def fn_stmt(text):
    a = text.index("create or replace function public.fn_fx_sync")
    return text[a:text.index("$$;", text.index("as $$", a)) + 3]


def pin(scope, fn_text, permit=("advisory_xact_lock", "dml_cte"), keys=(KEY,), targets=tuple(TARGETS), dbh=True, sig=SIG):
    body = body_of(fn_text)
    return {"scope": scope, "signature": sig, "fn_sha256": rp.fn_sha256(header_of(fn_text), body), "body_md5_ws": rp.body_md5_ws(body),
            "db_hash": ("post_fn_hash" if scope == "migration" else "pre_fn_hash") if dbh else None, "permit": list(permit),
            "advisory_keys": list(keys) if "advisory_xact_lock" in permit else [], "dml_targets": list(targets) if "dml_cte" in permit else [],
            "why": "fixture: advisory lock + data-modifying CTE in the body, definition only"}


class Pkg:
    """A throw-away copy of fx-n whose migration and rollback carry the synthetic function. Every edit re-hashes the manifest (the attacker model)."""

    def __init__(self, with_fn=True):
        self.tmp = tempfile.mkdtemp(prefix="t1_")
        shutil.copytree(os.path.join(ROOT, FX), os.path.join(self.tmp, FX))
        self.mp = os.path.join(self.tmp, FX, "manifest.json")
        with open(self.mp) as f:
            self.m = json.load(f)
        self.p = self.m["packages"]["fx-n"]
        if with_fn:
            self.edit(MIG, "\ncommit;", "\n" + FN_NEW + "\ncommit;")
            self.edit(DOWN, "\ncommit;", "\n" + FN_OLD + "\ncommit;")

    def path(self, rel):
        return os.path.join(self.tmp, rel)

    def read(self, rel):
        with open(self.path(rel), encoding="utf-8", newline="") as f:
            return f.read()

    def write(self, rel, text):
        with open(self.path(rel), "w", encoding="utf-8", newline="") as f:
            f.write(text)

    def edit(self, rel, old, new, count=1):
        t = self.read(rel)
        assert t.count(old) == count, (rel, old[:50], t.count(old))
        self.write(rel, t.replace(old, new))

    def pins_good(self, **kw):
        self.p["function_body_pins"] = [pin("migration", fn_stmt(self.read(MIG)), **kw), pin("rollback", fn_stmt(self.read(DOWN)), **kw)]
        self.p["post_fn_hash"] = rp.body_md5_ws(body_of(fn_stmt(self.read(MIG))))
        self.p["pre_fn_hash"] = rp.body_md5_ws(body_of(fn_stmt(self.read(DOWN))))
        return self

    def verify(self):
        """Re-hash like an attacker/author would (checksums, ledger digest in D, ddl_targets, refs), then run the real verifier."""
        k = self.p
        dpath = k["files"]["D"]["path"]
        self.write(dpath, re.sub(r"SHA-256 [0-9a-f]{64}", "SHA-256 " + rp.sha256(self.path(k["migration"]["path"])), self.read(dpath)))
        for e in [k["migration"], k["rollback"]] + list(k["files"].values()):
            e["sha256"] = rp.sha256(self.path(e["path"]))
        mig = self.read(k["migration"]["path"])
        k["ddl_targets"], k["allowed_public_refs"], k["allowed_foreign_refs"] = sorted(rp.ddl_targets(mig)), sorted(rp.public_refs(mig)), sorted(rp.foreign_refs(mig))
        with open(self.mp, "w") as f:
            json.dump(self.m, f, indent=2)
        return rp.verify_package(self.tmp, rp.load_manifest(self.tmp, self.mp), "fx-n")[1]

    def done(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def run(prep=None, pins=True, **kw):
    k = Pkg()
    try:
        if prep:
            prep(k)
        if pins:
            k.pins_good(**kw)
        return k.verify()
    finally:
        k.done()


def stale(pr):
    return any("pg_try_advisory_xact_lock" in x for x in pr) and any("stale or unused" in x for x in pr)


class Positive(unittest.TestCase):
    def test_without_pin_the_function_is_rejected_exactly_as_before(self):
        pr = run(pins=False)
        self.assertTrue(any("pg_try_advisory_xact_lock" in x for x in pr), pr)
        self.assertTrue(any("insert" in x.lower() or "update" in x.lower() for x in pr), pr)

    def test_with_pins_all_four_lint_surfaces_pass(self):
        # migration, rollback, B (= migration) and E (= rollback) all carry the pinned function
        self.assertEqual(run(), [])

    def test_a_package_without_pins_is_unchanged(self):
        k = Pkg(with_fn=False)
        try:
            self.assertEqual(k.verify(), [])
        finally:
            k.done()

    def test_pin_needs_both_scopes_when_both_files_carry_the_body(self):
        k = Pkg()
        try:
            k.pins_good()
            k.p["function_body_pins"] = k.p["function_body_pins"][:1]
            self.assertTrue(any("rollback" in x or "file E" in x for x in k.verify()))
        finally:
            k.done()

    def test_summary_reports_the_reviewer_diff_new_vs_live_body(self):
        k = Pkg()
        try:
            k.pins_good()
            self.assertEqual(k.verify(), [])
            rep = "\n".join(rp.PIN_REPORT)
            self.assertIn("2 changed line(s)", rep)
            self.assertIn(OLD_SRC, rep)
            self.assertIn("doku", rep)
        finally:
            k.done()


class BodyBinding(unittest.TestCase):
    def test_one_byte_changed_is_rejected_and_the_pin_is_reported_stale(self):
        k = Pkg()
        try:
            k.pins_good()
            k.edit(MIG, "interval '400 days'", "interval '401 days'")
            self.assertTrue(stale(k.verify()))
        finally:
            k.done()

    def test_comment_or_whitespace_only_change_is_rejected(self):
        for old, new in (("declare\n  v_n integer", "declare -- x\n  v_n integer"), ("begin\n  if not", "begin\n\n  if not")):
            with self.subTest(new):
                k = Pkg()
                try:
                    k.pins_good()
                    k.edit(MIG, old, new)
                    self.assertTrue(k.verify())
                finally:
                    k.done()

    def test_body_and_pin_changed_together_passes_documented_limit(self):
        """Pin = checksum pattern. PR separation (tool vs package), the Summary diff, db_hash and QA are the controls, not the lint."""
        def f(k):
            k.edit(MIG, "interval '400 days'", "interval '401 days'")
        self.assertEqual(run(f), [])

    def test_other_signature_is_rejected(self):
        self.assertTrue(run(sig="public.fn_other(interval)"))
        k = Pkg()
        try:
            k.pins_good()
            k.edit(MIG, "fn_fx_sync(p_lookback interval default interval '45 days')", "fn_fx_sync(p_lookback interval, p_x int default 1)")
            self.assertTrue(k.verify())
        finally:
            k.done()

    def test_pinned_body_copied_to_a_second_function_is_rejected(self):
        def f(k):
            c = fn_stmt(k.read(MIG)).replace("fn_fx_sync", "fn_fx_sync_copy")
            k.edit(MIG, "\ncommit;", "\n" + c + "\ncommit;")
        self.assertTrue(run(f))

    def test_pinned_function_defined_twice_is_rejected(self):
        k = Pkg()
        try:
            k.pins_good()
            k.edit(MIG, "\ncommit;", "\n" + fn_stmt(k.read(MIG)) + "\ncommit;")
            self.assertTrue(any("matched 2 time(s)" in x for x in k.verify()))
        finally:
            k.done()


class HeaderBinding(unittest.TestCase):
    def test_header_changes_unbind_the_pin(self):
        for name, old, new in (("search_path order", "set search_path = public, pg_temp\nas $$\ndeclare\n  v_n", "set search_path = pg_temp, public\nas $$\ndeclare\n  v_n"),
                               ("security invoker", "security definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_n", "security invoker\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_n"),
                               ("default value", "interval '45 days')", "interval '46 days')")):
            with self.subTest(name):
                k = Pkg()
                try:
                    k.pins_good()
                    k.edit(MIG, old, new)
                    self.assertTrue(stale(k.verify()))
                finally:
                    k.done()

    def test_clauses_after_the_body_are_bound_too(self):
        k = Pkg()
        try:
            k.pins_good()
            k.edit(MIG, "end\n$$;\n\ncommit;", "end\n$$ set search_path = pg_temp, public;\n\ncommit;")
            self.assertTrue(stale(k.verify()))
        finally:
            k.done()

    def test_comment_inside_the_header_does_not_change_the_pin(self):
        k = Pkg()
        try:
            k.pins_good()
            k.edit(MIG, "language plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_n", "language plpgsql -- c\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_n")
            self.assertEqual(k.verify(), [])
        finally:
            k.done()


class UsedExactlyOnce(unittest.TestCase):
    def test_declared_but_unused_capability_is_rejected(self):
        for kw in (dict(targets=tuple(sorted(TARGETS + ["public.fx_never_written"]))), dict(keys=(KEY, "another_unused_lock_key"))):
            with self.subTest(list(kw)):
                k = Pkg()
                try:
                    k.pins_good(**kw)
                    k.edit(MIG, "\ncommit;", "\ncreate table if not exists public.fx_never_written (id int);\ncommit;") if "targets" in kw else None
                    self.assertTrue(any("declares capabilities its body does not use" in x or "function_body_pins" in x for x in k.verify()))
                finally:
                    k.done()

    def test_unused_pin_in_a_package_that_does_not_define_the_function_is_stale(self):
        k = Pkg(with_fn=False)
        try:
            k.p["function_body_pins"] = [pin("migration", FN_NEW), pin("rollback", FN_OLD)]
            k.p["post_fn_hash"], k.p["pre_fn_hash"] = rp.body_md5_ws(body_of(FN_NEW)), rp.body_md5_ws(body_of(FN_OLD))
            self.assertTrue(k.verify())
        finally:
            k.done()


class WhereItApplies(unittest.TestCase):
    def test_not_in_a_do_block_nor_top_level_nor_an_unpinned_function(self):
        lock = "pg_try_advisory_xact_lock(hashtextextended('fx_alert_sync_lock', 0))"
        for name, extra in (("do block", f"do $$ begin if {lock} then null; end if; end $$;"),
                            ("top level", f"select {lock};"),
                            ("unpinned function", f"create or replace function public.fn_fx_other(a int, b int) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$ begin return {lock}; end $$;")):
            with self.subTest(name):
                def f(k, extra=extra):
                    k.edit(MIG, "\ncommit;", "\n" + extra + "\ncommit;")
                self.assertTrue(run(f))

    def test_not_in_read_only_or_ledger_files(self):
        for key in ("A", "C", "D", "F", "S", "G"):
            with self.subTest(key):
                k = Pkg()
                try:
                    k.pins_good()
                    rel = k.p["files"][key]["path"]
                    k.write(rel, k.read(rel) + "\n" + fn_stmt(k.read(MIG)))
                    self.assertTrue(any(f"file {key}" in x for x in k.verify()))
                finally:
                    k.done()

    def test_migration_scope_pin_does_not_cover_the_rollback_file(self):
        k = Pkg()
        try:
            k.pins_good()
            k.edit(DOWN, fn_stmt(k.read(DOWN)), fn_stmt(k.read(MIG)))   # rollback now carries the NEW body; only a migration-scope pin matches it
            pr = k.verify()
            self.assertTrue(any("rollback" in x or "file E" in x for x in pr), pr)
        finally:
            k.done()

    def test_pins_of_one_package_do_not_apply_to_another(self):
        k = Pkg()
        try:
            k.pins_good()
            k.verify()
            with open(k.mp) as f:
                m = json.load(f)
            m["packages"]["other"] = copy.deepcopy(m["packages"]["fx-n"])
            del m["packages"]["other"]["function_body_pins"]
            with open(k.mp, "w") as f:
                json.dump(m, f, indent=2)
            pr = rp.verify_package(k.tmp, rp.load_manifest(k.tmp, k.mp), "other")[1]
            self.assertTrue(any("pg_try_advisory_xact_lock" in x for x in pr), pr)
        finally:
            k.done()

    def test_real_manifest_p0_2_has_no_pin_and_still_passes_a_foreign_pin_is_stale(self):
        m = rp.load_manifest(ROOT, os.path.join(ROOT, "supabase/prod-packages/manifest.json"))
        self.assertEqual(rp.verify_package(ROOT, m, "p0-2")[1], [])
        self.assertNotIn("function_body_pins", m["packages"]["p0-2"])
        m = copy.deepcopy(m)
        m["packages"]["p0-2"]["function_body_pins"] = [{"scope": "migration", "signature": "public.fn_apply_verified_payment(uuid,text,text,numeric,text)", "fn_sha256": "0" * 64, "body_md5_ws": "0" * 32,
                                                          "db_hash": None, "permit": ["dml_cte"], "advisory_keys": [], "dml_targets": ["public.prompter_invoices"], "why": "foreign pin must be refused here"}]
        self.assertTrue(rp.verify_package(ROOT, m, "p0-2")[1])


class DoesNotLiftOtherRules(unittest.TestCase):
    """The attacker recomputes body AND pin (worst case). Every other lint rule still refuses the body."""

    def _inject(self, snippet, anchor="  v_n integer := 0;\n"):
        def f(k):
            k.edit(MIG, anchor, anchor + snippet)
        return run(f)

    def test_other_effects_in_a_pinned_body_are_refused(self):
        cases = {
            "set_config": "  perform set_config('x.y','1',true);\n", "nextval": "  perform nextval('public.s');\n", "setval": "  perform setval('public.s', 1);\n",
            "dblink": "  perform dblink('x','select 1');\n", "pg_sleep": "  perform pg_sleep(10);\n", "notify": "  perform pg_notify('c','p');\n",
            "session advisory": "  perform pg_advisory_lock(1);\n", "try session advisory": "  perform pg_try_advisory_lock(1);\n",
            "other xact advisory": "  perform pg_advisory_xact_lock(1);\n", "other product": "  perform 1 from public.publoe_x;\n",
            "dynamic execute": "  execute 'select 1';\n", "delete": "  delete from public.fx_alerts;\n", "truncate": "  truncate public.fx_alerts;\n",
            "ddl": "  drop table public.fx_alerts;\n", "alter": "  alter table public.fx_alerts disable trigger all;\n",
            "grant": "  grant all on public.fx_alerts to anon;\n", "copy": "  copy public.fx_alerts to program 'id';\n", "role switch": "  set role postgres;\n",
        }
        for name, sn in cases.items():
            with self.subTest(name):
                self.assertTrue(self._inject(sn), name)

    def test_cte_writes_outside_the_declared_set_are_refused(self):
        for name, snippet in {
            "auth.users": "  with x as (insert into auth.users (id) select gen_random_uuid() returning 1) select count(*) into v_n from x;\n",
            "public.undeclared": "  with x as (update public.fx_subscriptions set status = 'x' returning 1) select count(*) into v_n from x;\n",
            "main-level insert after with": "  with x as (select 1 as a) insert into public.fx_alerts (kind) select 'a' from x;\n",
            "main-level update after with": "  with x as (select 1 as a) update public.fx_alerts set state = 'x' from x;\n",
            "cte delete": "  with x as (delete from public.fx_alerts returning 1) select count(*) into v_n from x;\n",
            "upsert do update": "  with x as (insert into public.fx_alerts (kind) values ('x') on conflict (transaction_id, kind) do update set state = 'x' returning 1) select count(*) into v_n from x;\n",
        }.items():
            with self.subTest(name):
                self.assertTrue(self._inject(snippet), name)

    def test_a_declared_cte_to_a_declared_table_is_the_only_accepted_form(self):
        self.assertEqual(self._inject("  with x as (insert into public.fx_alerts (kind) values ('x') returning 1) select count(*) into v_n from x;\n"), [])

    def test_advisory_key_must_be_the_declared_literal(self):
        for name, sn in {"other key": "  if not pg_try_advisory_xact_lock(hashtextextended('some_other_product_job', 0)) then return; end if;\n",
                         "numeric key": "  if not pg_try_advisory_xact_lock(42) then return; end if;\n",
                         "qualified": "  if not public.pg_try_advisory_xact_lock(hashtextextended('fx_alert_sync_lock', 0)) then return; end if;\n",
                         "non-zero seed": "  if not pg_try_advisory_xact_lock(hashtextextended('fx_alert_sync_lock', 1)) then return; end if;\n"}.items():
            with self.subTest(name):
                self.assertTrue(self._inject(sn), name)

    def test_permit_classes_are_independent(self):
        self.assertTrue(run(permit=("advisory_xact_lock",)))
        self.assertTrue(run(permit=("dml_cte",)))


class PinSchema(unittest.TestCase):
    def test_malformed_pins_are_refused_before_any_lint(self):
        muts = {
            "extra key": lambda p: p[0].update(x=1), "missing key": lambda p: p[0].pop("why"), "bad scope": lambda p: p[0].update(scope="both"),
            "bad hash": lambda p: p[0].update(fn_sha256="ABC"), "unknown permit": lambda p: p[0].update(permit=["all"]),
            "wildcard target": lambda p: p[0].update(dml_targets=["public.*"]),
            "target outside allowed_public_refs": lambda p: p[0].update(dml_targets=sorted(TARGETS + ["public.fx_subscriptions"])),
            "unsorted": lambda p: p[0].update(dml_targets=list(reversed(TARGETS))),
            "function not in ddl_targets": lambda p: p[0].update(signature="public.fn_zzz(interval)"),
            "db_hash mismatch": lambda p: p[0].update(db_hash="pre_fn_hash"),
            "duplicate": lambda p: p.append(copy.deepcopy(p[0])),
            "too many": lambda p: p.extend(copy.deepcopy(p) * 3),
            "keys without permit": lambda p: p[0].update(permit=["dml_cte"]),
            "why too short": lambda p: p[0].update(why="x"),
        }
        for n, mu in muts.items():
            with self.subTest(n):
                k = Pkg()
                try:
                    k.pins_good()
                    mu(k.p["function_body_pins"])
                    pr = k.verify()
                    self.assertTrue(pr and any("function_body_pins" in x for x in pr), (n, pr[:3]))
                finally:
                    k.done()


class Frozen(unittest.TestCase):
    """The tokenizer stays frozen and the global ban lists are untouched: T1 only adds a per-function, per-package exception."""

    def test_global_ban_still_refuses_advisory_everywhere_without_a_pin(self):
        for sql in ("select pg_try_advisory_xact_lock(1);", "select pg_advisory_lock(1);",
                    "create or replace function public.f() returns void language sql as $$ select pg_try_advisory_xact_lock(hashtextextended('k', 0)) $$;"):
            self.assertTrue(rp.lint_forbidden("t", sql, None, set()), sql)

    def test_tokenizer_code_knows_nothing_about_pins(self):
        import inspect
        for fn in (rp.tokenize, rp.split_statements, rp.norm_text):
            self.assertNotIn("pin", inspect.getsource(fn).lower().replace("pinned_", "").replace("spin", ""), fn.__name__)


if __name__ == "__main__":
    unittest.main(verbosity=2)
