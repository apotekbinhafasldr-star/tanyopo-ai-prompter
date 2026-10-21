import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * In-memory stand-in for the service-role client, scoped to what the job queue uses. Unlike a call-shape mock
 * it APPLIES the filters it receives to real rows, so a query that forgets `tenant_id` or `status` changes
 * another tenant's row and the test fails. Also emulates prompter_claim_next_job (PENDING + due -> RUNNING,
 * attempts + 1). Rows hold inert placeholders only.
 */
export interface FakeJobRow {
  id: string;
  tenant_id: string;
  job_type: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  attempts: number;
  max_attempts: number;
  run_at: string;
  result?: unknown;
  error?: string | null;
  finished_at?: string | null;
  [k: string]: unknown;
}

export interface FakeQueryLog {
  op: "select" | "update";
  filters: Record<string, unknown>;
}

export function makeJob(over: Partial<FakeJobRow> & Pick<FakeJobRow, "id" | "tenant_id">): FakeJobRow {
  return {
    job_type: "EXTERNAL_API_RETRY",
    status: "RUNNING",
    attempts: 1,
    max_attempts: 5,
    run_at: new Date(Date.now() - 60_000).toISOString(),
    result: null,
    error: null,
    finished_at: null,
    ...over,
  };
}

export function fakeJobsAdmin(rows: FakeJobRow[]) {
  const queries: FakeQueryLog[] = [];
  const audit: Record<string, unknown>[] = [];

  function builder(op: "select" | "update", patch?: Record<string, unknown>) {
    const filters: Record<string, unknown> = {};
    let returning = false;
    const matches = () => rows.filter((r) => Object.entries(filters).every(([c, v]) => r[c] === v));
    const api = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return api;
      },
      select() {
        returning = true;
        return api;
      },
      async maybeSingle() {
        queries.push({ op, filters: { ...filters } });
        const first = matches()[0];
        if (op === "update") {
          if (first) Object.assign(first, patch);
          return { data: first ? { id: first.id } : null, error: null };
        }
        return { data: first ? { ...first } : null, error: null };
      },
      then(resolve: (v: { error: null }) => unknown) {
        queries.push({ op, filters: { ...filters } });
        if (op === "update") for (const r of matches()) Object.assign(r, patch);
        void returning;
        return resolve({ error: null });
      },
    };
    return api;
  }

  const client = {
    from(table: string) {
      if (table === "prompter_audit_logs") {
        return {
          insert: async (row: Record<string, unknown>) => {
            audit.push(row);
            return { error: null };
          },
        };
      }
      if (table !== "prompter_jobs") throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => builder("select"),
        update: (patch: Record<string, unknown>) => builder("update", patch),
      };
    },
    // prompter_claim_next_job: cross-tenant by design, oldest due PENDING first.
    async rpc(name: string) {
      if (name !== "prompter_claim_next_job") throw new Error(`Unexpected rpc: ${name}`);
      const due = rows
        .filter((r) => r.status === "PENDING" && Date.parse(r.run_at) <= Date.now())
        .sort((a, b) => Date.parse(a.run_at) - Date.parse(b.run_at))[0];
      if (!due) return { data: null, error: null };
      due.status = "RUNNING";
      due.attempts += 1;
      return { data: { ...due }, error: null };
    },
  };

  return { admin: client as unknown as SupabaseClient<Database>, rows, queries, audit };
}
