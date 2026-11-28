#!/usr/bin/env python3
"""Differential fuzz with a REAL PostgreSQL as the oracle (throw-away local database only).

For every statement the lint ACCEPTS we run it twice on the real server and watch whether a USER function was called (the decoy
functions raise NOTICE 'HIT:<n>'): once in a plain session (control: how often the lint alone would have let user code run) and once in the
runner's session (search_path = pg_catalog, pg_temp). Pass criterion: 0 hits in the runner session for unqualified names.
Corpus: (a) every candidate name x every statement form (exhaustive), (b) FUZZ_N random compositions from a fixed seed.
What this does NOT prove: absence of other bypasses (a fuzz shows presence, not absence); one server version; a corpus written by us;
schema-qualified calls (the lint refuses them; search_path does not close them); effects of operators/casts/views."""
import os, random, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "supabase/prod-packages/tools"))
import run_package as rp  # noqa: E402

SEED = int(os.environ.get("FUZZ_SEED", "20261127"))
N = int(os.environ.get("FUZZ_N", "4000"))
ENV = {k: v for k, v in os.environ.items() if k != "PGOPTIONS"}
DB = f"linoe_fuzz_{os.getpid()}"


def psql(args, sql=None, db=DB):
    r = subprocess.run(["psql", "-X", "-q", "-At", "-d", db] + args, env=ENV, input=sql, capture_output=True, text=True)
    return r


def words_from_server():
    out = psql(["-c", "select word || '|' || catcode::text from pg_get_keywords()"], db="postgres").stdout.split()
    ws = [x.split("|")[0] for x in out if x.endswith(("|U", "|T"))]
    return sorted(set(ws + ["md5", "now", "count", "length", "lower", "format", "version", "left", "right", "replace", "current_schema",
                            "substring", "overlay", "coalesce", "trim", "position"]))


FORMS = [
    "select {w}(1);", "select 1 where {w}(1) = 1;", "select 1 from public.fz_t where a = {w}(1);", "select * from {w}(1);",
    "select 1 from public.fz_t x join public.fz_t y on {w}(1) = 1;", "select a from public.fz_t order by {w}(1);",
    "select count(*) from public.fz_t group by {w}(1);", "select 1 from public.fz_t group by a having {w}(1) = 1;", "select a, {w}(1) from public.fz_t;",
    "select not {w}(1) = 1;", "select case when {w}(1) = 1 then 1 else {w}(1) end;", "select case when true then {w}(1) end;",
    "select case when 1 = 1 then 1 else {w}(1) end;", "select 1 where 1 in ({w}(1));", "select (select {w}(1));", "select coalesce({w}(1), 1);",
    "select 1 where 1 = 1 and {w}(1) = 1;", "select 1 where 1 = 2 or {w}(1) = 1;", "select 1 union select {w}(1);",
    "select sum(a) filter (where {w}(1) = 1) from public.fz_t;", "select a::int, {w}(1)::int from public.fz_t;", "select 1 limit {w}(1);",
    "with q as (select {w}(1)) select * from q;", "with q as materialized (select {w}(1)) select * from q;",
    "select t.{w} from public.fz_t t;", "select (t).{w} from public.fz_t t;",
    "do $$ begin perform {w}(1); end $$;", "do $$ declare x int; begin x := {w}(1); end $$;", "do $$ begin if {w}(1) = 1 then null; end if; end $$;",
    "do $$ begin raise notice '%', {w}(1); end $$;", "do $$ begin assert {w}(1) = 1; end $$;", "do $$ begin perform case when true then {w}(1) end; end $$;",
    "do $$ begin for r in select {w}(1) loop null; end loop; end $$;", "do $$ begin while {w}(1) = 0 loop null; end loop; end $$;",
    "do $$ begin if false then null; elsif {w}(1) = 1 then null; end if; end $$;", "do $$ declare x int; begin x := 1 + {w}(1); end $$;",
    "update public.fz_t set a = {w}(1) where a = 1;", "update public.fz_t set a = 1 where a = {w}(1);", "insert into public.fz_t (a) values ({w}(1));",
    "insert into public.fz_t (a) values (1) on conflict (a) do update set a = {w}(1);", "delete from public.fz_t where a = {w}(1);",
    "alter table public.fz_t add column b int default {w}(1);", "alter table public.fz_t add column b int default (now() at time zone {w}(1)::text);",
    "alter table public.fz_t add column b text default ('a' like {w}(1)::text);", "alter table public.fz_t add column b text default ('a' not like {w}(1)::text);",
    "alter table public.fz_t add column b text default ('a' ilike {w}(1)::text);", "alter table public.fz_t add constraint c1 check ({w}(a) = 1);",
    "create index fz_i on public.fz_t (({w}(a)));", "alter table public.fz_t add column b int generated always as ({w}(a)) stored;",
    "alter table public.fz_t add column b timestamptz(3) default now();",
]
SPELL = ["{w}", "{w} ", "{w}/**/", '"{w}"', "{w}\n", "{W}", "{w}--c\n"]  # how the name is written before "("
WRAP = ["{s}", "select (select 1 where exists ({q}));", "do $$ begin perform 1; {s} end $$;"]


def spelled(form, w, rnd):
    sp = rnd.choice(SPELL)
    name = sp.replace("{w}", w).replace("{W}", w.upper())
    return re.sub(r"(?<![A-Za-z_.\"])" + r"\{w\}", name, form) if "{w}" in form and not form.startswith("select t.") and "(t)." not in form else form.replace("{w}", w)


def main():
    rnd = random.Random(SEED)
    psql([], f"drop database if exists {DB}", db="postgres")
    psql([], f"create database {DB}", db="postgres")
    words = words_from_server()
    setup = ("create table public.fz_t(a int primary key); insert into public.fz_t values (1);\n"
             "create table public.fz_log(w text);\n")
    for w in words:
        for sig in ("int", "public.fz_t", "anyelement"):
            setup += f'create function public."{w}"({sig}) returns int language plpgsql as $$ begin raise notice \'HIT:%\', current_setting(\'linoe.i\', true); return 1; end $$;\n'
    r = psql([], setup)
    corpus = [f.replace("{w}", w) for w in words for f in FORMS]
    for _ in range(N):
        w, f = rnd.choice(words), rnd.choice(FORMS)
        corpus.append(spelled(f, w, rnd))
    corpus = sorted(set(corpus))
    accepted, refused = [], 0
    for sql in corpus:
        try:
            v = rp.lint_sql("t", sql, "write", [{"kind": "update_rows", "schema": "public", "table": "fz_t", "columns": ["a"]},
                                                  {"kind": "insert_rows", "schema": "public", "table": "fz_t", "columns": ["a"]},
                                                  {"kind": "delete_from", "schema": "public", "table": "fz_t"}], set(), "none")
        except Exception:
            v = ["x"]
        if v:
            refused += 1
        else:
            accepted.append(sql)

    def run(prefix):
        script = prefix + "\n"
        for i, sql in enumerate(accepted):
            script += f"select set_config('linoe.i', '{i}', false);\nbegin;\n{sql}\nrollback;\n"
        o = psql(["-v", "ON_ERROR_STOP=0", "-c", "set client_min_messages = notice"], None) if False else None
        r = subprocess.run(["psql", "-X", "-q", "-At", "-d", DB, "-v", "ON_ERROR_STOP=0"], env=ENV, input="set client_min_messages = notice;\n" + script,
                           capture_output=True, text=True)
        return {int(m) for m in re.findall(r"HIT:(\d+)", r.stdout + r.stderr)}
    hit_default = run("")
    hit_runner = run(rp.SESSION_SQL + ";")
    print(f"seed={SEED} random={N} names={len(words)} forms={len(FORMS)} corpus={len(corpus)} lint-refused={refused} lint-accepted={len(accepted)}")
    print(f"control (plain session): accepted statements that executed a user function = {len(hit_default)}")
    print(f"runner session (search_path = pg_catalog, pg_temp): accepted statements that executed a user function = {len(hit_runner)}")
    for i in sorted(hit_runner)[:20]:
        print("BYPASS:", repr(accepted[i]))
    psql([], f"drop database if exists {DB}", db="postgres")
    ok = not hit_runner and len(hit_default) > 0
    print("FUZZ " + ("OK" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
