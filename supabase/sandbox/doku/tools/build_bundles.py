#!/usr/bin/env python3
"""Bangun bundel migrasi sandbox dari supabase/migrations/*.sql (ISI MIGRASI TIDAK DIUBAH, hanya dibungkus).

Keluaran (di folder supabase/sandbox/doku): 10_migrations_part_N.sql dan MANIFEST.json.
Hanya membaca repo + menulis file lokal. Tidak ada akses jaringan/database.
Gunakan:  python3 tools/build_bundles.py
"""
import hashlib, json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent.parent
MIG = HERE.parent.parent / "migrations"
MAX_BYTES = 60_000  # batas isi migrasi per bundel (nyaman disalin dari HP)
FINGERPRINT = ("products", "product_batches", "warehouses", "warehouse_stock", "inventory_movements",
               "purchase_orders", "transactions", "transaction_items", "online_orders", "pesanan_meja",
               "receivables", "employees", "attendance", "payroll_notes", "kontrak_karyawan", "leave_requests")

files = sorted(MIG.glob("*.sql"))
items = []
for f in files:
    raw = f.read_bytes()
    items.append({"version": f.name.split("_", 1)[0], "file": f.name, "bytes": len(raw),
                  "sha256": hashlib.sha256(raw).hexdigest(), "text": raw.decode("utf-8")})

parts, cur, cur_bytes = [], [], 0
for it in items:
    if cur and cur_bytes + it["bytes"] > MAX_BYTES:
        parts.append(cur); cur, cur_bytes = [], 0
    cur.append(it); cur_bytes += it["bytes"]
if cur:
    parts.append(cur)

fp_sql = ", ".join(f"'{t}'" for t in FINGERPRINT)
for old in HERE.glob("10_migrations_part_*.sql"):
    old.unlink()

manifest = {"baseline_main_sha": "a07942ed27d72e041f91e9c50c504869218fa6c3", "migration_count": len(items), "parts": []}
done = 0
for n, part in enumerate(parts, 1):
    name = f"10_migrations_part_{n}.sql"
    first, last = part[0]["file"], part[-1]["file"]
    out = [f"""-- ============================================================================
-- {name}  (bagian {n} dari {len(parts)})  -- SANDBOX DOKU SAJA
-- Migrasi {done + 1} s/d {done + len(part)} dari {len(items)}:  {first}  ...  {last}
-- PROJECT YANG BENAR: linoe-doku-sandbox, ref eskqngzhtndkfqjoxxou (cocokkan dengan URL dashboard). Bukan umkmpro-ai, bukan linoe-otp-test.
-- File ini DIBANGUN OTOMATIS oleh tools/build_bundles.py; isi migrasi disalin apa adanya.
-- Jalankan HANYA di project sandbox (cek ref di URL dashboard), SETELAH 00 PASS dan 01 sukses,
-- dan berurutan (bagian {n} butuh {done} migrasi sudah tercatat). Satu transaksi: gagal = tidak ada yang terpasang.
-- ============================================================================
begin;
do $guard$
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: marker sandbox tidak ada. Bukan project sandbox / 01_shim belum dijalankan.';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ({fp_sql})) then
    raise exception 'ABORT: tabel UMKMpro terdeteksi -> kemungkinan project PRODUCTION. Berhenti.';
  end if;
  if (select count(*) from public._linoe_sandbox_applied) <> {done} then
    raise exception 'ABORT: urutan salah. Harus ada {done} migrasi tercatat sebelum bagian ini.';
  end if;
end $guard$;
"""]
    entry = {"bundle": name, "from": first, "to": last, "count": len(part), "expected_before": done, "migrations": []}
    for it in part:
        out.append(f"\n-- >>> {it['file']}  sha256={it['sha256']}\n")
        out.append(it["text"] if it["text"].endswith("\n") else it["text"] + "\n")
        out.append(f"insert into public._linoe_sandbox_applied (version, sha256) values ('{it['version']}', '{it['sha256']}');\n")
        entry["migrations"].append({k: it[k] for k in ("version", "file", "bytes", "sha256")})
    out.append("\ncommit;\n")
    (HERE / name).write_text("".join(out), encoding="utf-8")
    entry["bundle_bytes"] = (HERE / name).stat().st_size
    entry["bundle_sha256"] = hashlib.sha256((HERE / name).read_bytes()).hexdigest()
    manifest["parts"].append(entry)
    done += len(part)

(HERE / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{len(items)} migrasi -> {len(parts)} bundel:", ", ".join(f"{p['bundle']}({p['count']},{p['bundle_bytes']//1024}KB)" for p in manifest["parts"]))
