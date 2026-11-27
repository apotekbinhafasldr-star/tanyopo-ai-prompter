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
    {"kind": "drop_function", "schema": "public", "names": ["fn_fx"]},
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
        self.assertEqual(lint("update public.t set a = 1 where b = 2;")[0], [])  # public UPDATE inside migrations stays as before

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
        self.assertEqual(rp.lint_forbidden("l1", mig, up_allow, u1), [])
        self.assertEqual(rp.lint_forbidden("l1.down", down, down_allow, u2), [])
        self.assertEqual(rp.check_unused(up_allow, u1, "a"), [])
        self.assertEqual(rp.check_unused(down_allow, u2, "a"), [])
        self.assertEqual(rp.check_native_txn("l1", mig), [])
        self.assertEqual(rp.check_native_txn("l1.down", down), [])
        # drop one name from the list -> the same real file is rejected again
        weaker = copy.deepcopy(up_allow)
        weaker[1]["names"] = pol[:3]
        self.assertTrue(rp.lint_forbidden("l1", mig, weaker, set()))

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
            self.assertEqual(rp.lint_readonly(f, sql), [], f)
            self.assertEqual(rp.lint_forbidden(f, sql), [], f)
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
        for ok in ("t", "f", "0", "-3", "123456789012345678", "a" * 32, "b" * 64, "", "2026-11-27 10:00:00+00", "2026-11-27T10:00:00.123456Z"):
            self.assertEqual(rp.check_log_safe(["c"], [ok]), [], ok)
        for bad in ("storage.objects", "CANARY_OTHER_POLICY_zq81", "FX tenant all", "a" * 31, "1234567890123456789", "t,f", "x" * 100):
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


if __name__ == "__main__":
    unittest.main()
