"""Unit tests for production pipeline v2 (PR-1): per-package ALLOW-LIST, shape N, privilege probes, public-log safety, ledger,
state/rollback. No database. Run: python3 -m unittest discover -s supabase/prod-packages/tests
These tests only ADD constraints. The existing test_tools.py (p0-2) is unchanged and must keep passing."""
import ast
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

FX_MANIFEST = os.path.join(HERE, "fixtures", "manifest.json")
FX_DIR = "supabase/prod-packages/tests/fixtures/fx-n"
STORAGE_ALLOW = [
    {"kind": "drop_policy", "schema": "storage", "table": "objects", "names": ["FX tenant all"]},
    {"kind": "create_policy", "schema": "storage", "table": "objects", "names": ["FX tenant select"]},
    {"kind": "drop_trigger", "schema": "public", "table": "fx_audit_logs", "names": ["trg_fx"]},
    {"kind": "create_trigger", "schema": "public", "table": "fx_audit_logs", "names": ["trg_fx"], "functions": ["fn_fx"]},
    {"kind": "drop_function", "schema": "public", "signatures": ["fn_fx()"]},
    {"kind": "update_rows", "schema": "storage", "table": "buckets", "columns": ["public"]},
    {"kind": "delete_from", "schema": "public", "table": "fx_evidence", "in_function": "fn_fx_purge"},
    {"kind": "revoke", "schema": "storage", "objects": ["objects"], "privileges": ["truncate"], "roles": ["anon", "authenticated"]},
    {"kind": "grant", "schema": "public", "objects": ["fx_audit_logs"], "privileges": ["select"], "roles": ["authenticated"]},
]


def lint(sql, allow=None):
    used = set()
    return rp.lint_forbidden("t", sql, allow, used), used


class AllowlistIsNotGlobal(unittest.TestCase):
    """Without an allow-list every gated operation is rejected exactly as before; with one, ONLY the listed literal statement passes."""
    GATED_SQL = [
        'drop policy if exists "FX tenant all" on storage.objects;',
        'create policy "FX tenant select" on storage.objects for select using (true);',
        "drop trigger if exists trg_fx on public.fx_audit_logs;",
        "create trigger trg_fx before update on public.fx_audit_logs for each row execute function public.fn_fx();",
        "drop function public.fn_fx();",
        "update storage.buckets set public = false where id = 'x';",
        "delete from public.fx_evidence where id = 1;",
        "revoke truncate on storage.objects from anon, authenticated;",
        "grant select on public.fx_audit_logs to authenticated;",
    ]

    def test_every_gated_statement_is_rejected_without_allowlist(self):
        for sql in self.GATED_SQL:
            self.assertTrue(lint(sql)[0], sql)

    def test_each_is_accepted_with_exactly_its_entry(self):
        sqls = list(self.GATED_SQL)
        sqls[6] = ("create function public.fn_fx_purge() returns void language plpgsql as $$ begin "
                   "delete from public.fx_evidence where id = 1; end $$;")
        for sql in sqls:
            v, used = lint(sql, STORAGE_ALLOW)
            self.assertEqual(v, [], (sql, v))
            self.assertEqual(len(used), 1, sql)

    def test_validate_allow_accepts_the_test_list(self):
        self.assertEqual(rp.validate_allow(STORAGE_ALLOW), [])

    def test_name_outside_the_list_is_rejected(self):
        for sql in ['drop policy if exists "Other policy" on storage.objects;', 'drop policy "FX tenant all2" on storage.objects;',
                    'create policy "FX tenant delete" on storage.objects for delete using (true);']:
            self.assertTrue(lint(sql, STORAGE_ALLOW)[0], sql)

    def test_other_schema_or_table_is_rejected(self):
        for sql in ['drop policy "FX tenant all" on public.objects;', 'drop policy "FX tenant all" on storage.buckets;',
                    'drop policy "FX tenant all" on auth.objects;', "update storage.objects set public = false where id = 'x';",
                    "update auth.users set email = null where id = 'x';", "revoke truncate on storage.buckets from anon;",
                    "delete from storage.objects where id = 1;", "drop function storage.fn_fx();"]:
            self.assertTrue(lint(sql, STORAGE_ALLOW)[0], sql)

    def test_wildcards_and_unnamed_drops_are_rejected(self):
        for sql in ['drop policy "FX%" on storage.objects;', 'drop policy "*" on storage.objects;', "drop policy on storage.objects;",
                    "drop policy if exists on storage.objects;", "drop policy x on objects;", "drop function public.fn_fx;",
                    "drop trigger on public.fx_audit_logs;", 'drop policy "FX tenant all" on storage.objects cascade;',
                    "drop function public.fn_fx() cascade;"]:
            self.assertTrue(lint(sql, STORAGE_ALLOW)[0], sql)
        bad = [{"kind": "drop_policy", "schema": "storage", "table": "objects", "names": [n]} for n in ("*", "FX%", "a?b", "")]
        for e in bad:
            self.assertTrue(rp.validate_allow([e]), e)

    def test_allow_entry_validation(self):
        for e in [{"kind": "drop_policy", "schema": "auth", "table": "users", "names": ["x"]},
                  {"kind": "drop_policy", "schema": "storage", "table": "objects", "names": ["x"], "extra": 1},
                  {"kind": "nope", "schema": "storage"},
                  {"kind": "drop_policy", "schema": "storage", "table": "objects", "names": []},
                  {"kind": "drop_policy", "schema": "storage", "table": "Obj%", "names": ["x"]},
                  {"kind": "grant", "schema": "public", "objects": ["t"], "privileges": ["all"], "roles": ["anon"]},
                  {"kind": "revoke", "schema": "storage", "objects": ["objects"], "privileges": ["drop"], "roles": ["anon"]}]:
            self.assertTrue(rp.validate_allow([e]), e)
        self.assertTrue(rp.validate_allow({"kind": "x"}))

    def test_dynamic_execute_is_never_allowed(self):
        for sql in ["do $$ begin execute 'drop policy x on storage.objects'; end $$;",
                    "do $$ begin execute format('drop policy %I on storage.objects', 'x'); end $$;",
                    "create function public.f() returns void language plpgsql as $$ begin execute 'select 1'; end $$;"]:
            self.assertTrue(any("dynamic EXECUTE" in x for x in lint(sql, STORAGE_ALLOW)[0]), sql)
        for ok in ["grant execute on function public.fn_x(uuid) to service_role;", "revoke execute on function public.fn_x(uuid) from public;",
                   "create trigger t before update on public.a for each row execute function public.f();",
                   "select has_function_privilege('anon', 'f()', 'EXECUTE');", "raise exception 'tidak boleh execute ini';"]:
            self.assertFalse(any("dynamic EXECUTE" in x for x in lint(ok)[0]), ok)

    def test_ownership_role_and_session_tricks_are_never_allowed(self):
        for sql in ["alter table public.x owner to postgres;", "alter function public.f() owner to postgres;", "alter schema storage owner to x;",
                    "reassign owned by a to b;", "drop owned by linoe_migrator;", "set role postgres;", "set local role postgres;",
                    "set session authorization postgres;", "set session_replication_role = replica;", "set local session_replication_role to replica;",
                    "select set_config('session_replication_role', 'replica', true);", "select set_config('role', 'postgres', true);",
                    "select pg_advisory_lock(1);", "select pg_try_advisory_xact_lock(1);", "copy t from program 'curl x';",
                    "copy t to program 'cat';", "copy t from '/etc/passwd';", "select pg_read_file('/etc/passwd');",
                    "alter default privileges in schema public grant all on tables to anon;",
                    "grant select on all tables in schema public to anon;", "revoke all on all functions in schema storage from anon;",
                    "grant postgres to linoe_migrator;", "grant supabase_admin, postgres to someone;", "alter table public.t disable trigger all;",
                    "alter table public.t disable row level security;", "alter role linoe_migrator superuser;", "create role evil;"]:
            self.assertTrue(lint(sql, STORAGE_ALLOW)[0], sql)

    def test_psql_meta_commands_and_escape_strings(self):
        for sql in ["select 1;\n\\! id", "select 1 \\g", "\\i /etc/x.sql", "select 1;\n\\copy t to '/tmp/x'"]:
            self.assertTrue(rp.lint_psql_meta("t", sql), sql)
        self.assertEqual(rp.lint_psql_meta("t", "select regexp_replace(a, '\\s+', '', 'g'), $$ \\d $$;"), [])
        self.assertTrue(any("escape-string" in x for x in lint("select e'\\n';")[0]))
        self.assertFalse(any("escape-string" in x for x in lint("select 1 where d.deptype='e';")[0]))

    def test_truncate_in_every_form(self):
        for sql in ["truncate storage.objects;", "truncate table public.a, public.b;", "truncate only public.a cascade;", "TRUNCATE public.x"]:
            self.assertTrue(lint(sql, STORAGE_ALLOW)[0], sql)
        self.assertEqual(lint("revoke insert, update, delete, truncate on public.t from anon;")[0], [])

    def test_delete_needs_where_and_the_named_function(self):
        self.assertTrue(lint("create function public.fn_fx_purge() returns void language plpgsql as $$ begin delete from public.fx_evidence; end $$;", STORAGE_ALLOW)[0])
        self.assertTrue(lint("create function public.fn_other() returns void language plpgsql as $$ begin delete from public.fx_evidence where id = 1; end $$;", STORAGE_ALLOW)[0])
        self.assertTrue(lint("delete from public.fx_evidence where id = 1;", STORAGE_ALLOW)[0])
        self.assertEqual(lint("create function public.fn_fx_purge() returns void language plpgsql as $$ begin delete from public.fx_evidence where id = 1; end $$;", STORAGE_ALLOW)[0], [])

    def test_update_columns_and_where(self):
        self.assertTrue(lint("update storage.buckets set public = false;", STORAGE_ALLOW)[0])
        self.assertTrue(lint("update storage.buckets set owner = null where id = 'x';", STORAGE_ALLOW)[0])
        self.assertTrue(lint("update storage.buckets set public = false, file_size_limit = 1 where id = 'x';", STORAGE_ALLOW)[0])
        self.assertEqual(lint("update storage.buckets b set public = false where b.id = 'x';", STORAGE_ALLOW)[0], [])
        # v2.1 (QA P1-2): an UPDATE of a PUBLIC table is gated too (only a function BODY that is merely defined may update public tables)
        self.assertTrue(lint("update public.t set a = 1 where b = 2;")[0])
        pub = STORAGE_ALLOW + [{"kind": "update_rows", "schema": "public", "table": "t", "columns": ["a"]}]
        self.assertEqual(lint("update public.t set a = 1 where b = 2;", pub)[0], [])

    def test_sensitive_grants_and_grant_option(self):
        self.assertTrue(lint("grant select on public.t to anon;", STORAGE_ALLOW)[0])
        self.assertTrue(lint("grant select on public.fx_audit_logs to authenticated with grant option;", STORAGE_ALLOW)[0])
        self.assertTrue(lint("grant select on public.fx_audit_logs to authenticated, anon;", STORAGE_ALLOW)[0])
        self.assertEqual(lint("grant execute on function public.fn_x(uuid) to service_role;")[0], [])  # non-sensitive public grant, as before

    def test_unused_entry_is_an_error(self):
        v, used = lint('drop policy if exists "FX tenant all" on storage.objects;', STORAGE_ALLOW)
        self.assertEqual(v, [])
        self.assertEqual(len(rp.check_unused(STORAGE_ALLOW, used, "allow")), len(STORAGE_ALLOW) - 1)

    def test_comments_do_not_count_and_hidden_statement_after_comment_does(self):
        self.assertEqual(lint('-- drop policy "x" on storage.objects;\nselect 1;')[0], [])
        self.assertTrue(lint('/* c */ drop policy "x" on storage.objects;')[0])

    def test_real_l1_files_need_an_allowlist_and_pass_with_exactly_one(self):
        """The REAL L1 migration/rollback in this repo are rejected by default (as the plan measured) and expressible as a literal allow-list."""
        mp = os.path.join(ROOT, "supabase/migrations/20261126100000_prompter_storage_bucket_l1.sql")
        dp = os.path.join(ROOT, "supabase/rollback/20261126100000_prompter_storage_bucket_l1.down.sql")
        if not (os.path.exists(mp) and os.path.exists(dp)):
            self.skipTest("L1 files not present")
        mig, down = open(mp).read(), open(dp).read()
        self.assertTrue(rp.lint_forbidden("l1", mig))
        self.assertTrue(rp.lint_forbidden("l1.down", down))
        pol = ["Tenant baca file marketing miliknya sendiri", "Tenant unggah file product-media miliknya sendiri",
               "Tenant ubah file product-media miliknya sendiri", "Tenant hapus file product-media miliknya sendiri"]
        old = "Tenant kelola file marketing miliknya sendiri"
        up_allow = [{"kind": "drop_policy", "schema": "storage", "table": "objects", "names": [old] + pol},
                    {"kind": "create_policy", "schema": "storage", "table": "objects", "names": pol},
                    {"kind": "update_rows", "schema": "storage", "table": "buckets", "columns": ["public"]}]
        down_allow = [{"kind": "drop_policy", "schema": "storage", "table": "objects", "names": [old] + pol},
                      {"kind": "create_policy", "schema": "storage", "table": "objects", "names": [old]},
                      {"kind": "update_rows", "schema": "storage", "table": "buckets", "columns": ["public"]}]
        u1, u2 = set(), set()
        self.assertEqual(rp.lint_forbidden("l1", mig, up_allow, u1, txn="wrap"), [])
        self.assertEqual(rp.lint_forbidden("l1.down", down, down_allow, u2, txn="wrap"), [])
        self.assertEqual(rp.check_unused(up_allow, u1, "a"), [])
        self.assertEqual(rp.check_unused(down_allow, u2, "a"), [])
        self.assertEqual(rp.check_native_txn("l1", mig), [])
        self.assertEqual(rp.check_native_txn("l1.down", down), [])
        # drop one name from the list -> the same real file is rejected again
        weaker = copy.deepcopy(up_allow)
        weaker[1]["names"] = pol[:3]
        self.assertTrue(rp.lint_forbidden("l1", mig, weaker, set(), txn="wrap"))

    def test_p02_files_are_untouched_by_the_new_gates(self):
        m = rp.load_manifest(ROOT)
        self.assertEqual(list(m["packages"]), ["p0-2"])
        self.assertEqual(rp.verify_package(ROOT, m, "p0-2")[1], [])
        pkg = m["packages"]["p0-2"]
        self.assertNotIn("allow", pkg)
        self.assertNotIn("shape", pkg)
        self.assertIsNone(rp.derive_probe_spec(pkg))  # no probe is run for p0-2: its behaviour does not change
        canon = hashlib.sha256(json.dumps(pkg, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(canon, "dea14f3c671727745ac1240fdd0b5cf86c33bd00048c39fd0fb02a002d98753c", "the p0-2 manifest entry must not change in PR-1")


class NativeShape(unittest.TestCase):
    def test_native_txn_checks(self):
        ok = "-- c\nbegin;\nset local lock_timeout = '3s';\ndo $$ begin commit_x(); end $$;\ncreate table public.t(a int);\ncommit;\n"
        self.assertEqual(rp.check_native_txn("n", ok), [])
        self.assertTrue(rp.check_native_txn("n", "create table public.t(a int);\ncommit;"))
        self.assertTrue(rp.check_native_txn("n", "begin;\ncreate table public.t(a int);"))
        self.assertTrue(rp.check_native_txn("n", "begin;\ncreate table public.t(a int);\ncommit;\nbegin;\ncommit;"))
        self.assertTrue(rp.check_native_txn("n", "begin;\nselect 1;\ncommit;\nselect 2;\ncommit;"))
        self.assertTrue(rp.check_native_txn("n", "begin;\nsavepoint a;\nselect 1;\ncommit;"))
        self.assertTrue(rp.check_native_txn("n", "begin;\nrollback;\ncommit;"))
        # a COMMIT inside a string / dollar body is not transaction control
        self.assertEqual(rp.check_native_txn("n", "begin;\nselect 'commit;';\ndo $$ begin raise notice 'commit;'; end $$;\ncommit;"), [])

    def test_wrapped_shape_forbids_own_transaction(self):
        self.assertTrue(rp.has_txn_control("begin;\nselect 1;\ncommit;"))
        self.assertEqual(rp.has_txn_control("do $$ begin null; end $$;\nselect 1;"), [])


class FixturePackage(unittest.TestCase):
    """Mutate a COPY of the synthetic fixture package, regenerate every checksum (the attacker's best case) and check the lint still stops it."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        shutil.copytree(os.path.join(ROOT, "supabase/prod-packages/tests/fixtures"), os.path.join(self.tmp, "supabase/prod-packages/tests/fixtures"))
        self.mp = os.path.join(self.tmp, "supabase/prod-packages/tests/fixtures/manifest.json")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def pkg(self):
        return json.load(open(self.mp))["packages"]["fx-n"]

    def verify(self):
        return rp.verify_package(self.tmp, rp.load_manifest(self.tmp, self.mp), "fx-n")[1]

    def rehash(self, retarget=True):
        m = json.load(open(self.mp))
        k = m["packages"]["fx-n"]
        for e in [k["migration"], k["rollback"]] + list(k["files"].values()):
            e["sha256"] = hashlib.sha256(open(os.path.join(self.tmp, e["path"]), "rb").read()).hexdigest()
        if retarget:
            mig = open(os.path.join(self.tmp, k["migration"]["path"])).read()
            k["ddl_targets"] = sorted(rp.ddl_targets(mig))
            k["allowed_public_refs"] = sorted(rp.public_refs(mig))
            k["allowed_foreign_refs"] = sorted(rp.foreign_refs(mig))
        json.dump(m, open(self.mp, "w"), indent=2)

    def edit(self, rel, fn, **kw):
        p = os.path.join(self.tmp, rel)
        s = open(p).read()
        open(p, "w").write(fn(s))
        self.rehash(**kw)

    MIG = FX_DIR + "/migration/20990101000000_fixture_native_txn.sql"
    DOWN = FX_DIR + "/rollback/20990101000000_fixture_native_txn.down.sql"

    def test_clean_fixture_passes(self):
        self.assertEqual(self.verify(), [])

    def test_extra_statement_outside_allowlist_is_stopped_even_with_regenerated_checksums_and_targets(self):
        for extra in ['drop policy if exists "CANARY_OTHER_POLICY" on storage.objects;', 'drop policy if exists "FX tenant select" on storage.objects;',
                      "delete from public.fx_audit_logs where id = 1;", "update storage.buckets set owner = null where id = 'x';",
                      "revoke select on storage.buckets from anon;", 'create policy "Other" on storage.objects for all using (true);',
                      "drop trigger if exists trg_other on public.fx_audit_logs;", "alter table public.fx_audit_logs owner to postgres;",
                      "truncate public.fx_evidence;", "select pg_advisory_lock(1);"]:
            self.tearDown()
            self.setUp()
            self.edit(self.MIG, lambda s: s.replace("\ncommit;", "\n" + extra + "\ncommit;"))
            self.assertTrue(self.verify(), extra)

    def test_allowlist_extended_by_the_attacker_to_cover_a_new_statement_is_still_caught_by_ddl_targets_only_if_not_regenerated(self):
        # widening the manifest allow-list + regenerating hashes is a manifest change the reviewer sees; the lint itself accepts it,
        # but the stale-entry rule and ddl_targets keep every allowed statement explicit (documented limit: review is the last gate)
        m = json.load(open(self.mp))
        m["packages"]["fx-n"]["allow"].append({"kind": "drop_policy", "schema": "storage", "table": "objects", "names": ["Never used"]})
        json.dump(m, open(self.mp, "w"), indent=2)
        self.assertTrue(any("stale allow-list entry" in p for p in self.verify()))

    def test_manifest_with_wildcard_entry_is_refused(self):
        m = json.load(open(self.mp))
        m["packages"]["fx-n"]["allow"][0]["names"] = ["FX tenant %"]
        json.dump(m, open(self.mp, "w"), indent=2)
        self.assertTrue(self.verify())

    def test_b_must_be_the_migration_itself(self):
        m = json.load(open(self.mp))
        k = m["packages"]["fx-n"]
        shutil.copy(os.path.join(self.tmp, k["migration"]["path"]), os.path.join(self.tmp, FX_DIR, "B_copy.sql"))
        k["files"]["B"] = {"path": FX_DIR + "/B_copy.sql", "sha256": k["migration"]["sha256"]}
        json.dump(m, open(self.mp, "w"), indent=2)
        self.assertTrue(any("file B must be the migration file itself" in p for p in self.verify()))

    def test_transaction_control_in_the_middle_is_refused(self):
        self.edit(self.MIG, lambda s: s.replace("drop policy if exists", "commit;\nbegin;\ndrop policy if exists", 1))
        self.assertTrue(any("exactly one BEGIN and one COMMIT" in p for p in self.verify()))

    def test_missing_begin_is_refused(self):
        self.edit(self.MIG, lambda s: s.replace("\nbegin;\n", "\n", 1))
        self.assertTrue(any("must start with BEGIN" in p for p in self.verify()))

    def test_rollback_outside_its_allowlist_is_refused(self):
        self.edit(self.DOWN, lambda s: s.replace("\ncommit;", '\ndrop policy if exists "CANARY_OTHER_POLICY" on storage.objects;\ncommit;'))
        self.assertTrue(self.verify())

    def test_foreign_ref_outside_allowed_foreign_refs(self):
        self.edit(self.MIG, lambda s: s.replace("\ncommit;", "\nselect count(*) from storage.migrations;\ncommit;"), retarget=False)
        self.assertTrue(any("allowed_foreign_refs" in p for p in self.verify()))

    def test_crlf_is_refused(self):
        self.edit(self.MIG, lambda s: s.replace("\n", "\r\n"))
        self.assertTrue(any("CRLF" in p for p in self.verify()))

    def test_read_only_files_cannot_write_even_with_regenerated_checksums(self):
        for f in ("A_preflight_readonly.sql", "C_verify_readonly.sql", "F_final_verify.sql", "G_after_rollback_readonly.sql", "S_state_readonly.sql"):
            self.tearDown()
            self.setUp()
            self.edit(FX_DIR + "/" + f, lambda s: s + "\nupdate public.fx_evidence set id = id;\n")
            self.assertTrue(any("read-only file" in p for p in self.verify()), f)

    def test_ledger_verify_requires_the_migration_sha_in_d(self):
        self.edit(FX_DIR + "/D_ledger_record.sql", lambda s: re.sub(r"SHA-256 [0-9a-f]{64}", "SHA-256 " + "0" * 64, s))
        self.assertTrue(any("ledger_verify" in p for p in self.verify()))

    def test_timeouts_and_tags_are_bounded(self):
        for field, val in (("timeouts", {"lock_ms": 600000}), ("timeouts", {"statement_ms": 9999999}), ("guard_tags", ["lowercase tag"]), ("guard_tags", [])):
            m = json.load(open(self.mp))
            m["packages"]["fx-n"][field] = val
            json.dump(m, open(self.mp, "w"), indent=2)
            self.assertTrue(self.verify(), (field, val))
            self.tearDown()
            self.setUp()

    def test_check_only_through_main(self):
        self.assertEqual(rp.main(["--package", "fx-n", "--mode", "check-only", "--root", self.tmp, "--manifest", self.mp]), 0)


class Probes(unittest.TestCase):
    def test_spec_is_derived_from_the_allowlist(self):
        pkg = rp.load_manifest(ROOT, FX_MANIFEST)["packages"]["fx-n"]
        spec = rp.derive_probe_spec(pkg)
        need = {t["table"]: set(t["need"]) for t in spec["tables"]}
        self.assertEqual(need["storage.objects"], {"owner"})
        self.assertEqual(need["storage.buckets"], {"select", "update"})
        self.assertEqual(need["public.fx_audit_logs"], {"owner", "trigger"})
        self.assertEqual(need["public.fx_evidence"], {"select", "delete"})
        self.assertTrue(spec["ledger_insert"])
        self.assertEqual(spec["schemas"], ["public"])
        self.assertEqual(rp.validate_probes(pkg["probes"]), [])

    def test_probe_spec_validation(self):
        for bad in [{"tables": [{"table": "auth.users", "need": ["owner"]}]}, {"tables": [{"table": "public.t", "need": ["drop"]}]},
                    {"functions": ["public.f; drop"]}, {"schemas": ["auth"]}, {"unknown": 1}, {"tables": [{"table": "public.t", "need": []}]}]:
            self.assertTrue(rp.validate_probes(bad), bad)

    def test_tool_sql_files_are_read_only(self):
        for f in ("privilege_probe_readonly.sql", "ledger_verify_readonly.sql", "catalog_snapshot_ext.sql", "catalog_snapshot.sql", "owner_audit_readonly.sql"):
            sql = open(os.path.join(ROOT, "supabase/prod-packages/tools", f)).read()
            self.assertEqual(rp.lint_readonly(f, sql, allow_pvar="any"), [], f)
            self.assertEqual(rp.lint_sql(f, sql, "write", allow_pvar="any"), [], f)
            self.assertEqual(rp.lint_psql_meta(f, sql), [], f)

    def test_probe_output_is_validated_before_printing(self):
        out = []

        class R:
            def add(self, line):
                out.append(line)

        orig = rp.psql
        try:
            rp.psql = lambda *a, **k: (["probe", "status", "info"], [["tbl1.owner", "BLOCK", ""], ["acl_tbl1", "INFO", "a" * 32],
                                                                      ["CANARY NAME", "PASS", ""], ["tbl2.owner", "PASS", "CANARY_text"], ["x"]])
            npass, nblock, nunk = rp.run_probes({"tables": []}, {}, R())
        finally:
            rp.psql = orig
        self.assertEqual((npass, nblock, nunk), (0, 1, 3))
        self.assertFalse(any("CANARY" in x for x in out), out)


class LogSafety(unittest.TestCase):
    CANARY = "CANARY_OTHER_POLICY_zq81"

    def test_pg_errors_are_reduced_to_sqlstate(self):
        samples = [
            f'psql:/x/B.sql:12: ERROR:  42501: must be owner of table {self.CANARY}\nLOCATION:  aclcheck_error, aclchk.c:2000',
            f'psql:/x/B.sql:12: ERROR:  P0001: FX GUARD GAGAL: policy pihak lain {self.CANARY} menyebut bucket cadangan.\nCONTEXT: PL/pgSQL function inline_code_block',
            f'psql:/x/B.sql:12: ERROR:  23505: duplicate key value violates unique constraint "{self.CANARY}"\nDETAIL:  Key (id)=({self.CANARY}) already exists.',
            f'psql:/x/B.sql:3: ERROR:  42P01: relation "{self.CANARY}" does not exist',
        ]
        for s in samples:
            msg = rp.safe_error(s, {}, ("FX GUARD GAGAL",))
            self.assertNotIn(self.CANARY, msg)
            self.assertNotIn("LOCATION", msg)
            self.assertIn("SQLSTATE", msg)
        self.assertIn("insufficient privilege", rp.safe_error(samples[0], {}))
        self.assertIn("[FX GUARD GAGAL]", rp.safe_error(samples[1], {}, ("FX GUARD GAGAL",)))
        self.assertIn("[untagged]", rp.safe_error(samples[1], {}, ("OTHER TAG",)))

    def test_non_sqlstate_errors_and_password(self):
        pw = {"PGPASSWORD": "CANARY_pw_9f3"}
        for s in ['psql: error: connection to server at "db.x.supabase.co" failed: FATAL:  password authentication failed for user "linoe_migrator.x" CANARY_pw_9f3',
                  'psql: error: connection to server on socket "/tmp/s" failed: No such file or directory CANARY_pw_9f3',
                  'psql: error: FATAL:  database "CANARY_db" does not exist', 'psql: error: FATAL:  role "CANARY_role" does not exist', "weird CANARY_pw_9f3"]:
            msg = rp.safe_error(s, pw)
            self.assertNotIn("CANARY", msg)
        self.assertIn("authentication", rp.safe_error('FATAL: password authentication failed for user "x"', {}))

    def test_cells(self):
        for ok in ("t", "f", "0", "-3", "123456789012345678", "9223372036854775807", "-9223372036854775808", "a" * 32, "b" * 64, "", "2026-11-27 10:00:00+00", "2026-11-27T10:00:00.123456Z"):
            self.assertEqual(rp.check_log_safe(["c"], [ok]), [], ok)
        for bad in ("storage.objects", "CANARY_OTHER_POLICY_zq81", "FX tenant all", "a" * 31, "12345678901234567890", "t,f", "x" * 100):
            self.assertTrue(rp.check_log_safe(["c"], [bad]), bad)
        self.assertEqual(rp.safe_cell("CANARY_x"), "<withheld len=8>")
        self.assertEqual(rp.safe_cell("t"), "'t'")
        self.assertEqual(rp.safe_col("bad col name!", 3), "<col3>")

    def test_evaluate_never_echoes_free_text(self):
        fails, _ = rp.evaluate(["x_harus_true", "bad col!_harus_0"], ["CANARY_OTHER_POLICY_zq81", "CANARY_2"])
        self.assertEqual(len(fails), 2)
        self.assertFalse(any("CANARY" in x for x in fails), fails)

    def test_owner_audit_values(self):
        self.assertEqual(rp.safe_audit_value("true"), "true")
        self.assertEqual(rp.safe_audit_value("postgres"), "postgres")
        self.assertEqual(rp.safe_audit_value("postgres=12, supabase_admin=3"), "postgres=12, supabase_admin=3")
        self.assertTrue(rp.safe_audit_value("postgres=12, CANARY_role=3").startswith("<withheld"))
        self.assertTrue(rp.safe_audit_value("some_role").startswith("<withheld"))

    def test_runner_source_never_prints_raw_results(self):
        """AST walk: no log line (rep.add / Stop) may interpolate a raw-result variable or an stdout/stderr attribute."""
        src = open(os.path.join(ROOT, "supabase/prod-packages/tools/run_package.py")).read()
        tree = ast.parse(src)
        deny_names = {"r", "row", "h", "hdr", "header", "rows", "out", "stdout", "stderr", "kv", "d", "r2", "h2", "text", "msg", "val", "v", "label_raw"}
        offenders = []

        def names_in(node):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and (node.func.id.startswith("safe_") or node.func.id in ("len", "state_of")):
                return  # sanctioned sanitizers (or a length)
            if isinstance(node, ast.Name) and node.id in deny_names:
                yield node.id
            if isinstance(node, ast.Attribute) and node.attr in ("stdout", "stderr"):
                yield node.attr
            for ch in ast.iter_child_nodes(node):
                yield from names_in(ch)

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                is_log = (isinstance(fn, ast.Attribute) and fn.attr == "add" and isinstance(fn.value, ast.Name) and fn.value.id == "rep") or \
                         (isinstance(fn, ast.Name) and fn.id == "Stop")
                if is_log:
                    for a in node.args:
                        offenders += [(node.lineno, n) for n in names_in(a)]
        self.assertEqual(offenders, [], "raw result interpolated into a public log line")
        # print() only exists inside Report.add
        prints = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "print"]
        add_lines = [n for c in ast.walk(tree) if isinstance(c, ast.ClassDef) and c.name == "Report" for n in range(c.lineno, c.end_lineno + 1)]
        self.assertTrue(all(p in add_lines for p in prints), prints)

    def test_ast_lint_catches_a_violation(self):
        bad = "def f(rep, r):\n    rep.add(f'x {r[0]}')\n"
        tree = ast.parse(bad)
        found = [n for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id == "r"]
        self.assertTrue(found)


class QaRegressions(unittest.TestCase):
    """Independent QA of PR #188 (c3188cf): each trick that made the v2.0 regex lint blind, plus variants. All must stay rejected."""
    ALLOW = STORAGE_ALLOW + [{"kind": "update_rows", "schema": "public", "table": "t", "columns": ["a"]}]

    def bad(self, sql, txn="none", allow=None, role="write"):
        out = rp.lint_sql("t", sql, role, self.ALLOW if allow is None else allow, set(), txn)
        self.assertTrue(out, sql)
        return out

    # ---- P1-1: comment openers hidden in literals / identifiers --------------------------------------------------------
    def test_fake_comment_in_string_does_not_hide_a_psql_meta_command(self):
        for q in ["select '/*';\n\\! echo pwned\nselect '*/';", "select $$/*$$;\n\\! id\nselect $$*/$$;", "select $a$/*$a$;\n\\! id\nselect $a$*/$a$;",
                  'select "/*" from t;\n\\! id\nselect "*/" from t;', "select '/*' as a, '--' as b;\n\\! id\nselect '*/';",
                  "select 1;\n/* a /* b */ still comment */ \\! id\n"]:
            sql = q.replace("\\n", "\n")
            self.assertTrue(any("psql meta-command" in x for x in self.bad(sql)), sql)
            self.assertTrue(rp.lint_psql_meta("t", sql), sql)

    def test_fake_comment_in_string_does_not_hide_drop_policy_outside_the_allowlist(self):
        for lit in ("'/*'", "$$/*$$", '"/*"', "$x$/*$x$"):
            end = lit.replace("/*", "*/")
            sql = f'select {lit} as a;\ndrop policy "CANARY other" on storage.objects;\nselect {end} as b;'
            self.assertTrue(any("allow-list" in x for x in self.bad(sql)), sql)

    def test_fake_comment_does_not_hide_an_early_commit(self):
        sql = "begin;\nselect '/*';\ncommit;\ncreate table public.x(a int);\nselect '*/';\ncommit;"
        self.assertTrue(any("COMMIT" in x for x in self.bad(sql, txn="wrap")), sql)
        for sql in ["begin;\nselect 1;\ncommit;\nupdate public.t set a = 1 where b = 2;", "begin;\nselect 1;\ncommit;\ncommit;",
                    "begin;\nselect 1;\nrollback;\ncommit;", "begin;\nsavepoint a;\ncommit;", "begin;\nselect 1;\nend;\ncommit;", "begin;\nabort;\ncommit;",
                    "begin;\nbegin;\nselect 1;\ncommit;", "select 1;\nbegin;\ncommit;", "begin;\nselect 1;"]:
            self.bad(sql, txn="wrap")
        # wrapped-shape migration/rollback files carry no transaction control at all
        for kw in ("commit", "begin", "rollback", "savepoint a", "end", "abort", "release a", "start transaction", "prepare transaction 'x'"):
            self.assertTrue(any("transaction control" in x for x in self.bad(f"select 1;\n{kw};", txn="none")), kw)
        self.assertEqual(rp.lint_sql("t", "begin;\nselect 1;\ncommit;\nselect 2;", "write", [], set(), "wrap"), [])

    def test_unterminated_or_odd_tokens_fail_closed(self):
        for sql in ["select 1; /* open", "select 'x", 'select "x', "select $a$ x", "/* a /* b */ \\! id", "select E'\\'; \\! id\nselect E'\\'"]:
            self.bad(sql)

    def test_escape_strings_and_unicode_escapes_are_rejected(self):
        for sql in ["select E'\\'';\n\\! id\nselect E'\\'';", "select e'a';", "select U&'\\0041';", 'select U&"\\0041" from t;']:
            self.bad(sql)

    def test_backslash_and_psql_variables_inside_literals_are_data(self):
        self.assertEqual(rp.lint_sql("t", "select '\\! id', $$ \\! id $$, \"a\\b\" from t;", "readonly"), [])
        self.assertEqual(rp.lint_psql_meta("t", "-- \\! in a comment\nselect 1; /* \\! */"), [])
        for sql in ["select :x;", "select :'x';", 'select :"x";', "select 1 \\gset", "select 1 \\g", "\\i x.sql", "select 1;\n\\copy t to 'x'"]:
            self.bad(sql)
        self.assertEqual(rp.lint_sql("t", "select a::text, b[1:2] from t;", "readonly"), [])

    def test_copy_program_and_server_files(self):
        for sql in ["copy t from program 'id';", "copy (select 1) to program 'id';", "select pg_read_file('x');", "select lo_import('x');"]:
            self.bad(sql)

    # ---- P1-2: default-deny per statement -------------------------------------------------------------------------------
    NEGATIVE = [
        "insert into storage.buckets (id) values ('x');", "insert into public.unlisted (a) values (1);", "insert into public.t values (1);",
        "update storage.objects set name = 'x' where id = 1;", "update public.unlisted set a = 1 where b = 2;", "delete from storage.objects where id = 1;",
        'alter policy "x" on storage.objects using (true);', "alter table storage.objects add column x int;", "alter table public.t owner to postgres;",
        "alter table public.t disable row level security;", "alter table public.t drop column a;", "alter table public.t rename to u;",
        "alter table public.t alter column a type text;", "alter table public.t set schema storage;",
        "create function storage.f() returns void language sql as $$ select 1 $$;", "create function public.f() returns void language plpythonu as $$ x $$;",
        "create function f() returns void language sql as $$ select 1 $$;", "create function public.f() returns void language sql as $$ select 1 $$ set role postgres;",
        "comment on table storage.objects is 'x';", "comment on policy x on storage.objects is 'x';", "create index i on storage.objects (id);",
        "create index concurrently i on public.t (a);", "create index i on t (a);", "copy public.t to stdout;", "lock table public.t;", "vacuum public.t;",
        "alter function public.f() security invoker;", "alter schema storage rename to x;", "alter function storage.f() owner to x;",
        "do $$ begin execute 'select 1'; end $$;", "do language plpython3u $$ x $$;", "do $$ begin delete from storage.objects where id = 1; end $$;",
        "do $$ begin update storage.objects set name = 'x' where id = 1; end $$;", "do $$ begin insert into storage.buckets (id) values ('x'); end $$;",
        "do $$ begin perform set_config('x', 'y', false); end $$;", "do $$ begin create table public.zz (a int); end $$;",
        "do $$ begin commit; end $$;", "do $$ begin drop policy x on storage.objects; end $$;", "do $$ begin grant select on storage.objects to anon; end $$;",
        "create table storage.t (a int);", "create table public.t as select 1;", "create table public.t (like storage.objects);" if False else "create table public.t2 as select 1;",
        "create view public.v as select 1;", "create sequence public.s;", "create schema x;", "create extension x;", "create type public.t as enum ('a');",
        "refresh materialized view public.m;", "reindex table public.t;", "cluster public.t;", "analyze public.t;", "listen x;", "notify x;", "prepare p as select 1;",
        "declare c cursor for select 1;", "explain select 1;", "show all;", "reset all;", "set search_path = public;", "set statement_timeout = 0;",
        "select 1 into public.copy1;", "select * into public.copy1 from public.t;", "with d as (delete from public.t where a = 1 returning *) select * from d;",
        "select nextval('x');", "select public.fn_x();", "select storage.fn();", "select 1 for update;", "values (1);" if False else "call public.p();",
        "grant select on public.t to anon;", "grant select on public.t to authenticated;", "grant select on public.t to public;",
        "grant select on storage.objects to service_role;", "grant select on schema public to x;", "grant usage on schema public to x;",
        "grant all on all tables in schema public to x;", "grant postgres to x;", "revoke select (a) on public.t from anon;",
        "drop table public.t;", "drop index public.i;", "truncate public.t;", "drop function public.fn_unlisted();", "drop function storage.fn_fx();",
    ]

    def test_default_deny_rejects_every_unlisted_statement_class(self):
        for sql in self.NEGATIVE:
            if sql in ("select 1 for update;",):
                continue
            self.bad(sql)

    def test_all_gated_classes_are_exact_not_prefix(self):
        for sql in ['drop policy "FX tenant all" on storage.objects cascade;', 'drop policy "FX tenant all" on storage.objects, storage.buckets;',
                    'drop policy a on t1, t2;', 'drop policy "FX tenant all" on storage.objects restrict;', 'drop policy if exists on storage.objects;',
                    "drop function public.fn_fx(uuid);", "drop function public.fn_fx;", "drop function public.fn_fx() cascade;",
                    "drop function public.fn_fx(), public.fn_other();",
                    "create trigger trg_fx before update on public.fx_audit_logs for each row execute function public.fn_other();",
                    "create trigger trg_fx before update on public.fx_audit_logs for each row execute function auth.fn_fx();"]:
            self.bad(sql)

    def test_drop_function_matches_the_signature_not_just_the_name(self):
        ok = [{"kind": "drop_function", "schema": "public", "signatures": ["fn_fx(uuid,text)"]}]
        self.assertEqual(rp.lint_sql("t", "drop function public.fn_fx(uuid, text);", "write", ok, set()), [])
        self.assertEqual(rp.lint_sql("t", "drop function public.fn_fx(p_a uuid, text);", "write", ok, set())[:0], [])
        for sql in ["drop function public.fn_fx();", "drop function public.fn_fx(uuid);", "drop function public.fn_fx(text, uuid);", "drop function public.fn_fx(uuid, text, int);"]:
            self.bad(sql, allow=ok)
        self.assertTrue(rp.validate_allow([{"kind": "drop_function", "schema": "public", "names": ["fn_fx"]}]))
        self.assertTrue(rp.validate_allow([{"kind": "drop_function", "schema": "public", "signatures": ["fn_fx(uuid, text)"]}]))

    # ---- P1-3: quoted identifiers are normalised before every guard -----------------------------------------------------
    def test_quoted_identifiers_are_normalised_before_the_guards(self):
        for sql in ['select 1 from public."publoe_x";', 'select 1 from "public"."mitapeng_x";', 'select 1 from "public" . "publoe_x";',
                    'select 1 from public . /* c */ publoe_x;', 'select 1 from "public".umkmpro_x;', 'select "umkmpro_x" from t;',
                    'select 1 from "cron"."job";', 'select storage."fn"();', 'select "storage"."fn"();', 'select "set_config"(\'a\', \'b\', true);',
                    'select pg_catalog."set_config"(\'a\', \'b\', true);', 'select "pg_advisory_lock"(1);', 'select dblink_exec(\'x\', \'y\');']:
            self.bad(sql)
        # the same names as plain text are rejected the same way
        self.assertEqual(rp.public_refs('select 1 from public."x_t", "public"."y_t", public . z_t;'), {"x_t", "y_t", "z_t"})
        self.assertEqual(rp.foreign_refs('select 1 from "storage"."objects", storage . buckets;'), {"storage.objects", "storage.buckets"})
        self.assertIn("Foo", rp.public_refs('select 1 from public."Foo";'))  # mixed case is kept as written -> never in an allow-list

    def test_quoted_names_in_gated_statements_are_normalised_or_rejected(self):
        allow = [{"kind": "drop_policy", "schema": "storage", "table": "objects", "names": ["x"]}]
        for sql in ['drop policy x on "storage"."objects";', 'drop policy "x" on storage."objects";', 'DROP POLICY X ON STORAGE.OBJECTS;']:
            self.assertEqual(rp.lint_sql("t", sql, "write", allow, set()), [], sql)
        for sql in ['drop policy x on "Storage"."objects";', 'drop policy x on storage."Objects";', 'drop policy x on "storage"."obj ects";',
                    'drop policy x on storage."objects""";', 'drop policy "X" on storage.objects;']:
            self.bad(sql, allow=allow)
        self.assertEqual(rp.ddl_targets('create function "public"."fn_q"() returns void language sql as $$ select 1 $$;'), {"function:fn_q"})
        self.assertEqual(rp.ddl_targets('alter table public."t_q" add column a int;'), {"table:t_q"})

    # ---- P2: UPDATE gating ----------------------------------------------------------------------------------------------
    def test_update_gating(self):
        al = [{"kind": "update_rows", "schema": "storage", "table": "buckets", "columns": ["public"]}]
        good = "update storage.buckets set public = false where id = 'x';"
        self.assertEqual(rp.lint_sql("t", good, "write", al, set()), [])
        for sql in ["update storage.buckets set public = false where true;", "update storage.buckets set public = false where 1 = 1;",
                    "update storage.buckets set public = false where (true);", "update storage.buckets set public = false where id = 'x' or true;",
                    "update storage.buckets set public = false;", "update storage.buckets set public = false from storage.objects;",
                    "update buckets set public = false where id = 'x';", "update storage.buckets set (public, owner) = (false, null) where id = 'x';",
                    "update storage.buckets set public = false, owner = null where id = 'x';",
                    "update storage.buckets set public = (select 1 as owner), owner = 'x' where id = 'x';",
                    "update storage.buckets set public = false where id = 'x'; update storage.buckets set owner = null where id = 'x';",
                    "update storage.objects set public = false where id = 'x';", "update only storage.buckets set owner = 'a' where id = 'x';",
                    "update storage.buckets set public = false where null;"]:
            self.bad(sql, allow=al)
        self.assertEqual(rp.lint_sql("t", "update storage.buckets b set public = (select true) where b.id = 'x' and b.public is distinct from true;", "write", al, set()), [])

    def test_search_path_cannot_make_an_update_unqualified(self):
        self.bad("set search_path = storage;\nupdate buckets set public = false where id = 'x';")
        self.bad("set local search_path = storage;")

    def test_set_config_is_refused_everywhere_even_when_concatenated(self):
        for sql in ["select set_config('ro' || 'le', 'postgres', true);", "do $$ begin perform set_config('ro' || 'le', 'postgres', true); end $$;",
                    "create function public.f() returns void language plpgsql as $$ begin perform set_config('a', 'b', true); end $$;",
                    "select set_config(c, 'postgres', true) from (select 'role' as c) q;"]:
            self.assertTrue(any("set_config" in x for x in self.bad(sql)), sql)

    def test_read_only_files_are_select_only(self):
        for sql in ["select 1; insert into x values (1);", "select 1; set local lock_timeout = '1s';", "begin; select 1; commit;", "do $$ begin null; end $$;",
                    "select 1 into public.x from t;", "with d as (delete from t returning *) select * from d;", "select '/*'; \\! id\nselect '*/';",
                    "select set_config('a', 'b', true);", "select public.f();"]:
            self.assertTrue(rp.lint_sql("t", sql.replace("\\\\", "\\"), "readonly"), sql)
        self.assertEqual(rp.lint_sql("t", "-- c\nwith a as (select 1 as x) select x from a;", "readonly"), [])

    # ---- through verify_package: the attacker regenerates every checksum and target ------------------------------------
    def test_whole_package_with_the_tricks_is_rejected_even_with_regenerated_checksums(self):
        fp = FixturePackage("test_clean_fixture_passes")
        for trick in ["select '/*';\n\\! echo $MIGRATION_DB_PASSWORD\nselect '*/';",
                      "select '/*';\ndrop policy \"CANARY_OTHER_POLICY\" on storage.objects;\nselect '*/';",
                      "select '/*';\ncommit;\nselect '*/';", "select $$/*$$;\n\\! id\nselect $$*/$$;"]:
            fp.setUp()
            try:
                fp.edit(fp.MIG, lambda s: s.replace("\ncommit;", "\n" + trick + "\ncommit;"))
                self.assertTrue(fp.verify(), trick)
                fp.tearDown()
                fp.setUp()
                fp.edit(fp.DOWN, lambda s: s.replace("\ncommit;", "\n" + trick + "\ncommit;"))
                self.assertTrue(fp.verify(), trick)
            finally:
                fp.tearDown()

    def test_b_with_an_early_commit_is_refused_for_the_wrapped_p02_shape(self):
        m = rp.load_manifest(ROOT)
        pkg = m["packages"]["p0-2"]
        tmp = tempfile.mkdtemp()
        try:
            for d in ("supabase/prod-packages", "supabase/migrations", "supabase/rollback"):
                shutil.copytree(os.path.join(ROOT, d), os.path.join(tmp, d))
            bp = os.path.join(tmp, pkg["files"]["B"]["path"])
            txt = open(bp).read()
            open(bp, "w").write(txt.replace("create temp table", "select '/*';\ncommit;\nbegin;\nselect '*/';\ncreate temp table", 1))
            mp = os.path.join(tmp, "supabase/prod-packages/manifest.json")
            mm = json.load(open(mp))
            mm["packages"]["p0-2"]["files"]["B"]["sha256"] = hashlib.sha256(open(bp, "rb").read()).hexdigest()
            json.dump(mm, open(mp, "w"), indent=2)
            probs = rp.verify_package(tmp, rp.load_manifest(tmp), "p0-2")[1]
            self.assertTrue(any("COMMIT" in x or "transaction control" in x or "BEGIN" in x for x in probs), probs)
        finally:
            shutil.rmtree(tmp)

    # ---- P2/P3 runner behaviour --------------------------------------------------------------------------------------------
    def test_evaluate_requires_an_expectation_column(self):
        for h, r in (([], []), (["a_info"], ["1"]), (["x_catat"], ["1"])):
            self.assertTrue(rp.evaluate(h, r, require_harus=True)[0], h)
        self.assertEqual(rp.evaluate(["x_harus_1"], ["1"], require_harus=True)[0], [])

    def test_p02_a_c_f_values_with_realistic_magnitudes(self):
        big = "9223372036854775807"
        ts = "2026-11-27 10:11:12.123456+00"
        for v in (big, "-" + big, ts, "2026-11-27T10:11:12Z", "d41d8cd98f00b204e9800998ecf8427e", "t", "f", "0", ""):
            self.assertEqual(rp.check_log_safe(["c_info"], [v]), [], v)
        self.assertEqual(rp.evaluate(["a_harus_1", "b_harus_ge_1", "c_info"], ["1", big, ts], require_harus=True)[0], [])

    def test_probe_owner_uses_usage_not_member(self):
        sql = open(os.path.join(ROOT, "supabase/prod-packages/tools/privilege_probe_readonly.sql")).read()
        body = "\n".join(x for x in sql.splitlines() if not x.lstrip().startswith("--"))
        self.assertNotIn("'MEMBER') then 'PASS'", body)
        self.assertGreaterEqual(len(re.findall(r"'USAGE'\) then 'PASS'", body)), 3)

    def test_probe_spec_covers_drop_function_and_replaced_functions_and_rollback(self):
        m = rp.load_manifest(ROOT)
        pkg = m["packages"]["p0-2"]
        texts = [open(os.path.join(ROOT, pkg[k]["path"])).read() for k in ("migration", "rollback")]
        spec = rp.derive_probe_spec(pkg, texts)
        self.assertIn("public.fn_apply_verified_payment(uuid,text,text,numeric,text)", spec["replaces"])
        self.assertEqual({t["table"] for t in spec["tables"]}, {"public.prompter_invoices"})
        self.assertEqual(rp.validate_probes(spec), [])
        fx = rp.load_manifest(ROOT, FX_MANIFEST)["packages"]["fx-n"]
        ftexts = [open(os.path.join(ROOT, fx[k]["path"])).read() for k in ("migration", "rollback")]
        fs = rp.derive_probe_spec(fx, ftexts)
        self.assertIn("public.fn_fx_evidence_purge(timestamptz)", fs["replaces"])  # created by the migration: nothing to own before apply
        self.assertEqual(fs["functions"], [])  # ... and the rollback's DROP FUNCTION needs no pre-existing owner either
        self.assertEqual(rp.validate_probes(fs), [])
        # a rollback that replaces/drops an EXISTING function needs its owner
        n = rp.derive_needs("create or replace function public.f(a int, text) returns void language sql as $$ select 1 $$;", "drop function public.g(uuid);")
        self.assertEqual(n["replaces"], {"public.f(int,text)"})
        self.assertEqual(n["functions"], {"public.g(uuid)"})


class StateAndModes(unittest.TestCase):
    def test_keadaan_vocabulary_is_closed(self):
        pkg = {}
        for k in ("PRE", "APPLIED_UNRECORDED", "DONE", "ROLLED_BACK", "UNKNOWN"):
            self.assertEqual(rp.state_of(["keadaan"], [k], pkg), k)
        for bad in ("storage.objects", "pre", "", "DONE; drop"):
            self.assertEqual(rp.state_of(["keadaan"], [bad], pkg), "UNKNOWN")

    def test_pg_options_carry_both_timeouts(self):
        o = rp.pg_options()
        self.assertIn("lock_timeout=3000", o)
        self.assertIn("statement_timeout=120000", o)
        self.assertIn("lock_timeout=2000", rp.pg_options({"lock_ms": 2000}))

    def test_fixture_is_not_in_the_production_manifest_or_workflow(self):
        m = rp.load_manifest(ROOT)
        self.assertNotIn("fx-n", m["packages"])
        wf = open(os.path.join(ROOT, ".github/workflows/production-migration.yml")).read()
        self.assertNotIn("fx-n", wf)
        self.assertNotIn("fixtures", wf)

class QaRegressions2(unittest.TestCase):
    """QA #188 re-review (444a7c4): P2-A function-call default-deny, P2-B quoted identifiers, P3 timeouts / CR / product names."""

    def bad(self, sql, txn="none", role="write"):
        out = rp.lint_sql("t", sql, role, [], set(), txn)
        self.assertTrue(out, sql)
        return out

    def ok(self, sql, txn="none"):
        self.assertEqual(rp.lint_sql("t", sql, "write", [], set(), txn), [], sql)

    def test_p2a_schema_less_user_function_calls_are_refused_everywhere(self):
        for sql in ["select fn_other_writer();", "select * from fn_x();", "select (select fn_x());", "select coalesce(fn_x(), 1);",
                    "select fn_x ();", "select fn_x /* c */ ();", 'select "fn_x"();', 'select "Now"();',
                    "do $$ begin perform fn_apply_verified_payment('a'); end $$;",
                    "do $$ declare x timestamptz; begin x := fn_fx_evidence_purge(now()); end $$;",
                    "do $$ begin if fn_x() then null; end if; end $$;",
                    "do $$ begin for r in select fn_x() loop null; end loop; end $$;",
                    "do $$ begin assert fn_x(); end $$;",
                    "do $$ begin raise notice '%', fn_x(); end $$;",
                    "do $$ begin perform public.fn_x(); end $$;", "select public.fn_x();", "select pg_catalog.fn_x();",
                    "select pg_catalog.pg_promote();", "select pg_create_restore_point('x');", "select pg_stat_reset();",
                    "select pg_rotate_logfile();", "select txid_current();", "select pg_drop_replication_slot('s');"]:
            self.bad(sql)
        self.bad("begin;\nselect 1;\ncommit;\nselect fn_x();", txn="wrap")
        self.bad("begin;\nselect 1;\ncommit;\nselect pg_catalog.pg_promote();", txn="wrap")

    def test_p2a_dml_expression_calls_are_refused_too(self):
        self.bad("update public.t set a = fn_x() where b = 1;")
        self.bad("insert into public.t (a) values (fn_x());")
        self.bad("do $$ begin update public.t set a = fn_x() where b = 1; end $$;")

    def test_p2a_pure_builtins_still_pass(self):
        for sql in ["select now(), count(*), md5('a'), coalesce(1, 2), to_regclass('public.t');",
                    "select (select count(*) from (values ('a'), ('b')) r(n) where r.n in ('a')) as x;",
                    "select string_agg(a, ',' order by a) from (select 'x' as a) q;",
                    "select pg_catalog.now(), pg_get_functiondef(1), has_function_privilege('postgres', 'x()', 'EXECUTE');",
                    "do $$ begin if not exists (select 1 where now() is not null) then raise exception 'x'; end if; end $$;"]:
            self.ok(sql)

    def test_p2b_quoted_and_assigned_sequence_functions_are_refused(self):
        for sql in ["""select "nextval"('s');""", "select nextval('s');", """select "NEXTVAL"('s');""", "select currval('s');", "select lastval();",
                    """select pg_catalog."nextval"('s');""", """select "setval"('s', 1);""", """select "pg_sleep"(1);""", """select "dblink"('x');""",
                    """select "lo_import"('/etc/passwd');""", """select "pg_read_file"('x');""", """select "set_config"('a', 'b', false);""",
                    "do $$ declare x bigint; begin x := nextval('s'); end $$;", """do $$ declare x bigint; begin x := "nextval"('s'); end $$;"""]:
            self.bad(sql)

    def test_p3_timeouts_zero_and_large_values_are_refused(self):
        for v in ("0", "'0'", "'0s'", "'0ms'", "'1h'", "'11s'", "'121s'", "'2min'", "1000000", "'-1'", "'abc'"):
            self.bad(f"set local lock_timeout = {v};")
        self.bad("set local statement_timeout = 0;")
        self.bad("set local statement_timeout = '3min';")
        for sql in ["set local lock_timeout = '3s';", "set local lock_timeout = '10s';", "set local statement_timeout = '120s';",
                    "set local statement_timeout to 5000;", "set local lock_timeout = '500ms';"]:
            self.ok(sql)

    def test_p3_carriage_return_is_refused_by_the_tokenizer_itself(self):
        with self.assertRaises(rp.LintError):
            rp.tokenize("select 1; -- c\r\\! id\nselect 2;")
        self.assertTrue(rp.lint_sql("t", "select 1; -- c\r\\! id\nselect 2;", "write", [], set(), "none"))

    def test_p3_other_product_names_in_identifiers_and_literals(self):
        for sql in ["select 'publoe-media';", "select 'mitapeng_x';", "select 'x' from \"kagura_tbl\";", "select 1 from public.apotek_x;",
                    "select 'umkmpro-media';", "select 1 from umkmpro_orders;", "select 1 from \"PUBLOE_x\";"]:
            self.bad(sql)
        self.ok("select 'bukan umkmpro-ai, dibatalkan';")

    def test_p3_probe_log_has_no_acl_fingerprints(self):
        sql = open(os.path.join(ROOT, "supabase/prod-packages/tools/privilege_probe_readonly.sql")).read()
        self.assertNotIn("relacl", sql)
        self.assertNotIn("aclexplode", sql)
        self.assertNotRegex(sql, r"md5\(")


if __name__ == "__main__":
    unittest.main()
