"""Unit tests for the production-package tools. No database. Run: python3 -m unittest discover -s supabase/prod-packages/tests"""
import copy
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import check_approval as ca  # noqa: E402
import run_package as rp  # noqa: E402

MANIFEST = rp.load_manifest(ROOT)
PROD_OK = dict(PGHOST="aws-0-ap-southeast-1.pooler.supabase.com", PGPORT="5432", PGSSLMODE="require",
               PGUSER="linoe_migrator." + MANIFEST["project_ref"], PGPASSWORD="x")


class Approval(unittest.TestCase):
    good = [{"state": "approved", "user": {"login": "Owner"}, "environments": [{"name": "production-migration"}]}]

    def test_empty_means_no_reviewer(self):
        self.assertFalse(ca.evaluate([], "owner", "production-migration")[0])

    def test_non_list(self):
        self.assertFalse(ca.evaluate({"message": "x"}, "owner", "production-migration")[0])

    def test_owner_approved(self):
        self.assertTrue(ca.evaluate(self.good, "owner", "production-migration")[0])

    def test_other_user_or_other_env_or_rejected(self):
        self.assertFalse(ca.evaluate(self.good, "someone", "production-migration")[0])
        self.assertFalse(ca.evaluate(self.good, "owner", "staging")[0])
        rej = copy.deepcopy(self.good)
        rej[0]["state"] = "rejected"
        self.assertFalse(ca.evaluate(rej, "owner", "production-migration")[0])
        both = self.good + rej
        self.assertFalse(ca.evaluate(both, "owner", "production-migration")[0])


class Expectations(unittest.TestCase):
    def test_harus_rules(self):
        h = ["a_harus_true", "b_harus_0", "c_harus_ge_1", "d_info", "e_catat", "v_harus_20261103170000"]
        self.assertEqual(rp.evaluate(h, ["t", "0", "3", "x", "y", "20261103170000"])[0], [])
        f = rp.evaluate(h, ["f", "1", "0", "x", "y", "2026"])[0]
        self.assertEqual(len(f), 4)

    def test_unknown_column_is_a_failure(self):
        self.assertEqual(len(rp.evaluate(["mystery"], ["1"])[0]), 1)

    def test_samakan_compares_with_baseline(self):
        base = (["x_md5_catat"], ["abc"])
        self.assertEqual(rp.evaluate(["x_md5_samakan_A"], ["abc"], base)[0], [])
        self.assertEqual(len(rp.evaluate(["x_md5_samakan_A"], ["abd"], base)[0]), 1)
        self.assertEqual(len(rp.evaluate(["y_md5_samakan_A"], ["abc"], base)[0]), 1)
        f, n = rp.evaluate(["x_md5_samakan_A"], ["abc"], None)
        self.assertEqual((f, len(n)), ([], 1))


class Connection(unittest.TestCase):
    def v(self, **kw):
        e = dict(PROD_OK)
        e.update(kw)
        return rp.validate_connection("production", e, MANIFEST)

    def test_ok(self):
        self.assertEqual(self.v(), [])

    def test_refusals(self):
        self.assertTrue(self.v(PGHOST="db." + MANIFEST["project_ref"] + ".supabase.co"))
        self.assertTrue(self.v(PGPORT="6543"))
        self.assertTrue(self.v(PGSSLMODE="disable"))
        self.assertTrue(self.v(PGUSER="postgres." + MANIFEST["project_ref"]))
        self.assertTrue(self.v(PGUSER="linoe_migrator.otherproject"))
        self.assertTrue(self.v(PGUSER="linoe_migrator"))
        self.assertTrue(self.v(PGUSER="service_role." + MANIFEST["project_ref"]))
        self.assertTrue(self.v(PGPASSWORD=""))

    def test_rehearsal_only_local(self):
        self.assertEqual(rp.validate_connection("rehearsal", {"PGHOST": "localhost"}, MANIFEST), [])
        self.assertEqual(rp.validate_connection("rehearsal", {"PGHOST": "/tmp"}, MANIFEST), [])
        self.assertTrue(rp.validate_connection("rehearsal", dict(PROD_OK), MANIFEST))


class Lint(unittest.TestCase):
    def test_forbidden(self):
        for bad in ["drop table public.x;", "create role r;", "select cron.schedule('a','b','c');", "delete from public.x;",
                    "set role postgres;", "select pg_sleep(1);", "alter system set x=1;", "select 1 from public.publoe_x;",
                    "create extension pgcrypto;", "truncate table public.x;"]:
            self.assertTrue(rp.lint_forbidden("t", bad), bad)
        self.assertEqual(rp.lint_forbidden("t", "-- drop table x\nselect 1;"), [])
        self.assertEqual(rp.lint_forbidden("t", "revoke insert, update, delete, truncate on public.t from anon;"), [])

    def test_readonly(self):
        self.assertEqual(rp.lint_readonly("t", "-- insert\nselect 1;"), [])
        self.assertTrue(rp.lint_readonly("t", "select 1;\ninsert into x values (1);"))


class Package(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        for d in ("supabase/prod-packages", "supabase/migrations", "supabase/rollback"):
            shutil.copytree(os.path.join(ROOT, d), os.path.join(self.tmp, d))
        self.mp = os.path.join(self.tmp, "supabase/prod-packages/manifest.json")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def verify(self):
        return rp.verify_package(self.tmp, rp.load_manifest(self.tmp), "p0-2")[1]

    def edit(self, rel, fn, refresh=True):
        p = os.path.join(self.tmp, rel)
        s = open(p).read()
        open(p, "w").write(fn(s))
        if refresh:  # an attacker who ALSO regenerates the checksum in the manifest
            m = json.load(open(self.mp))
            pk = m["packages"]["p0-2"]
            for e in [pk["migration"], pk["rollback"]] + list(pk["files"].values()):
                e["sha256"] = hashlib.sha256(open(os.path.join(self.tmp, e["path"]), "rb").read()).hexdigest()
            json.dump(m, open(self.mp, "w"), indent=2)

    def test_clean(self):
        self.assertEqual(self.verify(), [])

    def test_checksum_mismatch(self):
        self.edit("supabase/prod-packages/p0-2/A_p02_preflight_readonly.sql", lambda s: s + "\n-- x\n", refresh=False)
        self.assertTrue(any("SHA-256" in p for p in self.verify()))

    def test_unknown_package(self):
        self.assertTrue(rp.verify_package(self.tmp, rp.load_manifest(self.tmp), "nope")[1])

    def test_regenerated_checksum_still_fails_on_new_object(self):
        # the migration is changed to touch another table AND the manifest checksums are regenerated: lint/allow-lists still stop it
        mig = "supabase/migrations/20261103170000_prompter_p0_2_payment_invoices.sql"
        self.edit(mig, lambda s: s + "\nalter table public.prompter_subscriptions add column evil text;\n")
        self.edit("supabase/prod-packages/p0-2/B_p02_apply_sql_editor.sql",
                  lambda s: s.replace("-- ===== akhir isi migrasi", "alter table public.prompter_subscriptions add column evil text;\n-- ===== akhir isi migrasi"))
        pr = self.verify()
        self.assertTrue(any("DDL targets" in p or "verbatim" in p for p in pr), pr)

    def test_regenerated_checksum_still_fails_on_forbidden_token(self):
        self.edit("supabase/prod-packages/p0-2/A_p02_preflight_readonly.sql", lambda s: s + "\ninsert into public.prompter_invoices default values;\n")
        self.assertTrue(self.verify())
        self.edit("supabase/prod-packages/p0-2/E_p02_rollback_emergency.sql", lambda s: s.replace("commit;", "drop table public.prompter_invoices;\ncommit;", 1))
        self.assertTrue(any("file E" in p for p in self.verify()))

    def test_b_must_not_write_ledger_and_d_only_one_insert(self):
        self.edit("supabase/prod-packages/p0-2/B_p02_apply_sql_editor.sql",
                  lambda s: s.replace("commit;\nselect 'SELESAI", "insert into supabase_migrations.schema_migrations(version) values ('x');\ncommit;\nselect 'SELESAI"))
        self.assertTrue(any("ledger" in p for p in self.verify()))

    def test_d_extra_statement(self):
        self.edit("supabase/prod-packages/p0-2/D_p02_ledger_record.sql", lambda s: s.replace("commit;", "update public.prompter_invoices set status='VOID';\ncommit;", 1))
        self.assertTrue(any("file D" in p for p in self.verify()))


class State(unittest.TestCase):
    pkg = MANIFEST["packages"]["p0-2"]

    def st(self, fn, col, led):
        return rp.state_of(["fn_hash", "kolom_transaction_id", "ledger_p02"], [fn, col, led], self.pkg)

    def test_states(self):
        v2, v3 = self.pkg["pre_fn_hash"], self.pkg["post_fn_hash"]
        self.assertEqual(self.st(v2, "0", "0"), "PRE")
        self.assertEqual(self.st(v3, "1", "0"), "APPLIED_UNRECORDED")
        self.assertEqual(self.st(v3, "1", "1"), "DONE")
        for bad in [(v2, "1", "0"), (v3, "0", "0"), (v2, "0", "1"), ("none", "0", "0"), ("zzz", "1", "1")]:
            self.assertEqual(self.st(*bad), "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
