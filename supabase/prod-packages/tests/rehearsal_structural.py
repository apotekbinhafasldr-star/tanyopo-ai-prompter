#!/usr/bin/env python3
"""Structural controls of the runner proven against a REAL (throw-away, local) PostgreSQL. Used by rehearsal.sh (part 9) and on its own.
Each line printed is 'PASS: ...' or 'FAIL: ...'. Never touches anything but the throw-away database it creates and drops."""
import os, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "supabase/prod-packages/tools"))
import run_package as rp  # noqa: E402

ENV = dict(os.environ)
ENV.pop("PGOPTIONS", None)
DB = f"linoe_struct_{os.getpid()}"
fails = 0


def ok(cond, msg):
    global fails
    print(("PASS: " if cond else "FAIL: ") + msg)
    fails += 0 if cond else 1


def psql(sql, db=DB, at=True):
    r = subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql], env=ENV, capture_output=True, text=True)
    return r.stdout.strip(), r.returncode, r.stderr


def run(text, **kw):
    e = dict(ENV, PGDATABASE=DB)
    try:
        rp.run_sql(text, e, **kw)
        return None
    except rp.Stop as x:
        return str(x)


psql(f"drop database if exists {DB}", "postgres")
psql(f"create database {DB}", "postgres")
try:
    psql("""create table public.other_log(w text); create table public.mine(a int); create table public.other_t(a int);
create function public.md5(int) returns text language plpgsql as $$ begin insert into public.other_log values ('md5'); return 'x'; end $$;
create function public."first"(int) returns int language plpgsql as $$ begin insert into public.other_log values ('first'); return 1; end $$;
create function public."substring"(anyelement) returns int language plpgsql as $$ begin insert into public.other_log values ('substring'); return 1; end $$;
create function public.fn_w(public.mine) returns int language plpgsql as $$ begin insert into public.other_log values ('attr'); return 1; end $$;
insert into public.mine values (1); create sequence public.fz_seq;""")
    count = lambda: psql("select count(*) from public.other_log")[0]
    declared_for_priv = (["public.mine"], ["mine"], ["mine_"])

    # control: with the default search_path the shadowing functions DO run (so the next checks mean something)
    for q in ("select md5(1)", "select 1 where first(1) = 1", "select substring(1)", "select t.fn_w from public.mine t"):
        psql(q)
    ok(int(count()) == 4, "control: with the default search_path the four shadowing paths (md5(1), first(1), substring(1), t.fn) really execute user functions")
    psql("truncate public.other_log")

    for label, q in (("md5(1)", "select md5(1)"), ("first(1)", "select 1 where first(1) = 1"), ("substring(1)", "select substring(1)"),
                     ("attribute t.fn", "select t.fn_w from public.mine t"), ("DO perform first(1)", "do $$ begin perform first(1); end $$")):
        err = run(q, mode="ro")
        ok(err is not None and int(count()) == 0, f"search_path=pg_catalog: {label} executes nothing ({(err or '')[:90]})")
    ok(int(count()) == 0, "search_path=pg_catalog: the user-function log stayed empty")
    ok(rp.SESSION_SQL.startswith("set search_path = pg_catalog, pg_temp"), "the session setup is the first item the runner sends")
    # schema-qualified calls are NOT closed by search_path (documented): the lint and the effects check are the controls
    psql("select public.md5(1)")
    ok(int(count()) == 1, "documented limit: a schema-qualified call (public.md5(1)) still executes under any search_path")
    psql("truncate public.other_log")

    # privilege: a minimum role is NOT a boundary against a SECURITY DEFINER function of "another product" that has EXECUTE for PUBLIC (default)
    psql("""do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'fz_other_owner') then create role fz_other_owner nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'fz_min') then create role fz_min nologin; end if; end $$;
        create schema fz_other authorization fz_other_owner;
        create table fz_other.t(a int); alter table fz_other.t owner to fz_other_owner; grant usage on schema fz_other to public;
        create function fz_other.fn_writer() returns int language plpgsql security definer set search_path = pg_catalog as $$ begin insert into fz_other.t values (1); return 1; end $$;
        alter function fz_other.fn_writer() owner to fz_other_owner;
        create function fz_other.fn_closed() returns int language plpgsql security definer set search_path = pg_catalog as $$ begin insert into fz_other.t values (2); return 1; end $$;
        alter function fz_other.fn_closed() owner to fz_other_owner; revoke execute on function fz_other.fn_closed() from public;
        grant usage on schema public to fz_min; grant select on public.mine to fz_min;""")
    o, rc, er = psql("set role fz_min; insert into fz_other.t values (9)")
    ok(rc != 0 and "permission denied" in er, "privilege: the minimum role cannot write the other product's table directly")
    o, rc, er = psql("set role fz_min; select fz_other.fn_closed()")
    ok(rc != 0 and "permission denied" in er, "privilege: a definer function whose OWNER revoked PUBLIC execute is closed to the minimum role (only its owner can do this)")
    o, rc, er = psql("set role fz_min; select fz_other.fn_writer()")
    ok(rc == 0 and psql("select count(*) from fz_other.t")[0] == "1", "privilege: a definer function with the default PUBLIC execute WRITES for the minimum role (a privilege limit is not a boundary against it)")
    psql("truncate fz_other.t")
    o, rc, er = psql("set role fz_min; set search_path = pg_catalog, pg_temp; select fn_writer()")
    ok(rc != 0, "search_path: the same function called WITHOUT its schema does not resolve")
    err = run("begin;\nselect fz_other.fn_writer();\ncommit;\nselect 1;\n", mode="w", effects=declared_for_priv)
    ok(err is not None and "EFEK DI LUAR DAFTAR" in err and psql("select count(*) from fz_other.t")[0] == "0",
       "effects: the qualified call of the other product's definer function is rolled back before COMMIT (the table written is not in the package list)")

    # check phase: BEGIN READ ONLY + snapshot
    err = run("set transaction read write; create table public.zz(a int);", mode="ro")
    ok(err is not None and psql("select to_regclass('public.zz')")[0] == "", "check phase: SET TRANSACTION READ WRITE is refused after the snapshot (the default_transaction_read_only GUC alone is reversible)")
    err = run("select nextval('public.fz_seq')", mode="ro")
    ok(err is not None and "SQLSTATE 25006" in err, "check phase: a write through nextval is refused by the server (read-only transaction, SQLSTATE 25006)")

    # psql does not interpret meta-commands or variables in -c text
    marker = f"/tmp/linoe_pwn_{os.getpid()}"
    run(f"select 1; \\! touch {marker}", mode="ro")
    run(f"select 1 -- c\r\n\\! touch {marker}\nselect 2", mode="ro")
    ok(not os.path.exists(marker), "-c text: a backslash meta-command (also after a CR in a comment) is never executed")
    ok(run("select :'x'", mode="ro") is not None, "-c text: psql variable syntax is not interpolated")
    for bad_text in ("select :x", 'select :"x"', "select :{?x}"):
        try:
            rp.subst_pvars(bad_text, {"x": "1"})
            ok(False, f"subst_pvars accepted {bad_text}")
        except rp.Stop:
            ok(True, f"subst_pvars refuses the form {bad_text}")
    out = rp.run_sql("select :'v' as v", dict(ENV, PGDATABASE=DB), {"v": "o'x\\y"}, mode="ro")
    ok("o'x\\y" in out, "subst_pvars: a quote and a backslash survive as a literal")

    # apply phase: effects checked by the server before COMMIT
    base = "begin;\n{}\ncommit;\nselect count(*) from public.mine;\n"
    declared = (["public.mine"], ["mine"], ["mine_"])
    err = run(base.format("insert into public.mine values (2);"), mode="w", effects=declared)
    ok(err is None and psql("select count(*) from public.mine")[0] == "2", "effects: a declared write commits")
    err = run(base.format("insert into public.other_t values (9);"), mode="w", effects=declared)
    ok(err is not None and "EFEK DI LUAR DAFTAR" in err and psql("select count(*) from public.other_t")[0] == "0",
       "effects: a write to a table outside the package list is rolled back and the run stops (writes through any path: function, attribute, trigger)")
    err = run(base.format("select public.fn_w(m) from public.mine m limit 1;"), mode="w", effects=declared)
    ok(err is not None and int(count()) == 0, "effects: a user function reached through a qualified call writes to another table -> rolled back")
    err = run(base.format("create function public.fn_new() returns int language sql as $$ select 1 $$;"), mode="w", effects=declared)
    ok(err is not None and psql("select to_regprocedure('public.fn_new()')")[0] == "", "effects: an undeclared function in public is rolled back")
    err = run(base.format("create function public.fn_new() returns int language sql as $$ select 1 $$;"), mode="w", effects=(["public.mine"], ["mine", "fn_new"], []))
    ok(err is None and psql("select to_regprocedure('public.fn_new()')")[0] != "", "effects: the same function declared by name commits")
    err = run(base.format("create schema zz_other;"), mode="w", effects=declared)
    ok(err is not None and psql("select count(*) from pg_namespace where nspname = 'zz_other'")[0] == "0", "effects: a new schema (global catalog fact) is rolled back")
    err = run(base.format("create operator public.=== (leftarg = int, rightarg = int, function = int4eq);"), mode="w", effects=declared)
    ok(err is not None, "effects: a user operator is rolled back")
    for early in ("begin;\ninsert into public.mine values (3);\ncommit;\ncommit;\nselect 1;\n", "insert into public.mine values (3);\n"):
        try:
            rp.split_txn(early)
            ok(False, "split_txn accepted a file without exactly one BEGIN first and one COMMIT")
        except rp.Stop:
            ok(True, "effects: a file with an early/extra COMMIT or no BEGIN is refused before anything runs")
    ok(psql("select count(*) from public.mine")[0] == "2", "effects: none of the refused files changed the declared table")
finally:
    psql(f"drop database if exists {DB}", "postgres")
print("STRUCTURAL " + ("OK" if not fails else f"FAILED ({fails})"))
sys.exit(1 if fails else 0)
