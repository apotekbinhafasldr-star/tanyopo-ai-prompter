#!/usr/bin/env python3
"""Regenerate fixtures/manifest.json (fixture package fx-n) after any edit to its files: run from anywhere.
   python3 supabase/prod-packages/tests/fixtures/rehash.py
It embeds the migration SHA-256 into D, recomputes every checksum and derives ddl_targets / allowed refs from the SQL itself.
The fixture is SYNTHETIC (rehearsal only). It is NOT in supabase/prod-packages/manifest.json and the workflow cannot run it."""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(ROOT, "supabase", "prod-packages", "tools"))
import run_package as rp  # noqa: E402

FX = "supabase/prod-packages/tests/fixtures/fx-n"
MIG = f"{FX}/migration/20990101000000_fixture_native_txn.sql"
DOWN = f"{FX}/rollback/20990101000000_fixture_native_txn.down.sql"
FILES = {"A": "A_preflight_readonly.sql", "C": "C_verify_readonly.sql", "D": "D_ledger_record.sql", "F": "F_final_verify.sql",
         "G": "G_after_rollback_readonly.sql", "S": "S_state_readonly.sql"}
ALLOW = [
    {"kind": "drop_policy", "schema": "storage", "table": "objects", "names": ["FX tenant all"]},
    {"kind": "create_policy", "schema": "storage", "table": "objects", "names": ["FX tenant select", "FX tenant insert", "FX tenant update", "FX tenant delete"]},
    {"kind": "update_rows", "schema": "storage", "table": "buckets", "columns": ["public"]},
    {"kind": "create_trigger", "schema": "public", "table": "fx_audit_logs", "names": ["trg_fx_audit_no_update"], "functions": ["fn_fx_block_audit_change"]},
    {"kind": "revoke", "schema": "storage", "objects": ["objects"], "privileges": ["truncate"], "roles": ["anon", "authenticated"]},
    {"kind": "delete_from", "schema": "public", "table": "fx_evidence", "in_function": "fn_fx_evidence_purge"},
]
ROLLBACK_ALLOW = [
    {"kind": "drop_policy", "schema": "storage", "table": "objects", "names": ["FX tenant select", "FX tenant insert", "FX tenant update", "FX tenant delete"]},
    {"kind": "update_rows", "schema": "storage", "table": "buckets", "columns": ["public"]},
    {"kind": "create_policy", "schema": "storage", "table": "objects", "names": ["FX tenant all"]},
    {"kind": "drop_trigger", "schema": "public", "table": "fx_audit_logs", "names": ["trg_fx_audit_no_update"]},
    {"kind": "drop_function", "schema": "public", "signatures": ["fn_fx_block_audit_change()", "fn_fx_evidence_purge(timestamptz)"]},
    {"kind": "grant", "schema": "storage", "objects": ["objects"], "privileges": ["truncate"], "roles": ["anon", "authenticated"]},
]
# keys of the catalog snapshots (catalog_snapshot.sql + catalog_snapshot_ext.sql) that apply must change: nothing else may differ
EXPECTED_EFFECTS = json.load(open(os.path.join(HERE, "fx-n", "expected_effects.json"))) if os.path.exists(os.path.join(HERE, "fx-n", "expected_effects.json")) else []


def sha(path):
    return hashlib.sha256(open(os.path.join(ROOT, path), "rb").read()).hexdigest()


def main():
    mig_sha = sha(MIG)
    dp = os.path.join(ROOT, FX, FILES["D"])
    d = open(dp).read()
    d2 = re.sub(r"SHA-256 [0-9a-f]{64}", f"SHA-256 {mig_sha}", d)
    if d2 != d:
        open(dp, "w").write(d2)
    mig = open(os.path.join(ROOT, MIG)).read()
    entry = lambda p: {"path": p, "sha256": sha(p)}
    pkg = {
        "title": "FIXTURE sintetis fx-n (gladi bersih: pola L1 + Paket 3, bentuk N). BUKAN migrasi nyata.",
        "fixture": True, "shape": "native-txn", "version": "20990101000000", "name": "fixture_native_txn", "ledger_verify": True,
        "timeouts": {"lock_ms": 3000, "statement_ms": 30000},
        "guard_tags": ["FX GUARD GAGAL", "FX AUDIT TERKUNCI", "DIBATALKAN"],
        "probes": {"schemas": ["public"], "ledger_insert": True},
        "migration": entry(MIG), "rollback": entry(DOWN),
        "files": {"B": entry(MIG), "E": entry(DOWN), **{k: entry(f"{FX}/{v}") for k, v in FILES.items()}},
        "allow": ALLOW, "rollback_allow": ROLLBACK_ALLOW,
        "ddl_targets": sorted(rp.ddl_targets(mig)),
        "allowed_public_refs": sorted(rp.public_refs(mig)),
        "allowed_foreign_refs": sorted(rp.foreign_refs(mig)),
        "expected_effects": sorted(EXPECTED_EFFECTS),
    }
    m = {"schema": 1, "project_ref": "wjjyqovhmwenbcvbnkgx", "migration_role": "linoe_migrator", "approved_privileged_role": False,
         "packages": {"fx-n": pkg}}
    with open(os.path.join(HERE, "manifest.json"), "w") as f:
        json.dump(m, f, indent=2)
        f.write("\n")
    print("manifest.json written; migration sha256", mig_sha)


if __name__ == "__main__":
    main()
