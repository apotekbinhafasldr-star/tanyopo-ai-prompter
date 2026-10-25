/**
 * Minimal stateful in-memory stand-in for the PostgREST calls used by the
 * approval / campaign status flows (H1 / PR #39). Each statement executes
 * ATOMICALLY when it is awaited (like a single PostgREST request), so tests
 * can interleave two server actions and observe real lost-update behaviour.
 * Supports: select / update / insert / delete, .eq(), .select(), .single(),
 * .maybeSingle(). Failure injection and a pre-execution hook (to model a
 * concurrent writer slipping in) are available.
 */
export type Row = Record<string, unknown>;

export interface LoggedStatement {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  payload?: Row;
  filters: Array<[string, unknown]>;
  matched: number;
}

export interface FakeDbOptions {
  /** Return an error message to make this statement fail. */
  failWhen?: (ctx: { table: string; op: string; payload?: Row }) => string | null;
  /** Runs right before a statement executes; may mutate `db.tables` (a concurrent writer). */
  beforeExec?: (ctx: { table: string; op: string; db: FakeDb }) => void;
  /** Throw (instead of returning an error) for this statement. */
  throwWhen?: (ctx: { table: string; op: string }) => boolean;
  /**
   * Models the `updated_at` trigger: on every UPDATE of these tables the column gets a new, unique value
   * (a counter), so a compare-and-swap on `updated_at` behaves like the real database.
   */
  touchOnUpdate?: Record<string, string>;
  /** Column defaults the real table would fill on INSERT (id, status, created_at...). `n` counts inserts per table. */
  insertDefaults?: Record<string, (n: number) => Row>;
}

export interface FakeDb {
  tables: Record<string, Row[]>;
  log: LoggedStatement[];
  from: (table: string) => unknown;
}

export function createFakeDb(seed: Record<string, Row[]>, options: FakeDbOptions = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const log: LoggedStatement[] = [];
  let touchCounter = 0;
  const insertCounts: Record<string, number> = {};
  const db: FakeDb = { tables, log, from: () => undefined };

  db.from = (table: string) => {
    let op: LoggedStatement["op"] = "select";
    let payload: Row | undefined;
    let returning = false;
    let single: "single" | "maybe" | null = null;
    const filters: Array<[string, unknown]> = [];
    const predicates: Array<(r: Row) => boolean> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitTo: number | null = null;

    const execute = () => {
      options.beforeExec?.({ table, op, db });
      if (options.throwWhen?.({ table, op })) throw new Error("injected throw");
      const failure = options.failWhen?.({ table, op, payload }) ?? null;
      const rows = (tables[table] ??= []);
      const matches = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v) && predicates.every((f) => f(r)));
      const entry: LoggedStatement = { table, op, payload, filters: [...filters], matched: 0 };
      log.push(entry);
      if (failure) return { data: null, error: { message: failure } };

      if (op === "insert") {
        const n = (insertCounts[table] = (insertCounts[table] ?? 0) + 1);
        rows.push({ ...(options.insertDefaults?.[table]?.(n) ?? {}), ...(payload as Row) });
        entry.matched = 1;
        return { data: null, error: null };
      }
      const hit = matches();
      entry.matched = hit.length;
      if (op === "update") {
        for (const r of hit) {
          Object.assign(r, payload);
          const touch = options.touchOnUpdate?.[table];
          if (touch) r[touch] = `ts-${++touchCounter}`;
        }
        return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (op === "delete") {
        tables[table] = rows.filter((r) => !hit.includes(r));
        return { data: null, error: null };
      }
      if (single) {
        if (hit.length === 1) return { data: { ...hit[0] }, error: null };
        if (hit.length === 0 && single === "maybe") return { data: null, error: null };
        return { data: null, error: { message: "not exactly one row" } };
      }
      let out = hit.map((r) => ({ ...r }));
      if (orderBy) {
        const { col, asc } = orderBy;
        out = out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limitTo !== null) out = out.slice(0, limitTo);
      return { data: out, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => {
        if (op === "update") returning = true;
        return builder;
      },
      update: (p: Row) => {
        op = "update";
        payload = p;
        return builder;
      },
      insert: (p: Row) => {
        op = "insert";
        payload = p;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return builder;
      },
      is: (c: string, v: unknown) => {
        predicates.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v));
        return builder;
      },
      in: (c: string, vs: unknown[]) => {
        predicates.push((r) => vs.includes(r[c]));
        return builder;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        orderBy = { col, asc: o?.ascending !== false };
        return builder;
      },
      limit: (n: number) => {
        limitTo = n;
        return builder;
      },
      single: () => {
        single = "single";
        return builder;
      },
      maybeSingle: () => {
        single = "maybe";
        return builder;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(execute()).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    };
    return builder;
  };
  return db;
}
