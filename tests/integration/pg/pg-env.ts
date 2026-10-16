/**
 * Isolation guard for the PostgreSQL concurrency tests (PR #38).
 *
 * These tests may only ever talk to a throw-away PostgreSQL on this machine
 * (the CI service container) whose database is exactly "linoe_pg_test".
 * Everything here is pure (no I/O) so it is unit-tested in the normal suite
 * (tests/unit/integration/pg-env-guard.test.ts).
 */

export const REQUIRED_DATABASE = "linoe_pg_test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Production credentials that must never be present while these tests run. */
const FORBIDDEN_ENV_KEYS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "META_APP_SECRET",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
];

/** The placeholder CI uses for the build is not a real project. */
const SUPABASE_HOST_PATTERN = /(?<!placeholder\.)supabase\.(co|com|in)\b/i;

export class PgIsolationError extends Error {
  constructor(message: string) {
    super(`PostgreSQL test isolation guard: ${message}`);
    this.name = "PgIsolationError";
  }
}

export interface PgConfig {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

type Env = Record<string, string | undefined>;

export function pgTestEnabled(env: Env = process.env): boolean {
  return env.LINOE_PG_TEST === "1";
}

export function pgTestRequired(env: Env = process.env): boolean {
  return env.LINOE_PG_REQUIRE === "1";
}

/**
 * Returns the connection settings, or throws PgIsolationError when anything
 * about the environment could point at a shared or production database.
 */
export function resolvePgConfig(env: Env = process.env): PgConfig {
  if (!pgTestEnabled(env)) {
    throw new PgIsolationError("LINOE_PG_TEST=1 is not set");
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (FORBIDDEN_ENV_KEYS.includes(key)) {
      throw new PgIsolationError(`production credential variable ${key} is present`);
    }
    if (SUPABASE_HOST_PATTERN.test(value)) {
      throw new PgIsolationError(`variable ${key} references a Supabase host`);
    }
  }

  const host = env.PGHOST ?? "";
  if (!(LOCAL_HOSTS.has(host) || host.startsWith("/"))) {
    throw new PgIsolationError(`PGHOST must be a local host or a unix socket directory (got "${host}")`);
  }

  const database = env.PGDATABASE ?? "";
  if (database !== REQUIRED_DATABASE) {
    throw new PgIsolationError(`PGDATABASE must be exactly "${REQUIRED_DATABASE}" (got "${database}")`);
  }

  const user = env.PGUSER ?? "";
  if (user.length === 0) {
    throw new PgIsolationError("PGUSER is not set");
  }

  return { host, port: env.PGPORT ?? "5432", user, password: env.PGPASSWORD ?? "", database };
}

/** Tables that exist in the shared production database; none may exist here. */
export const PRODUCTION_ONLY_TABLES = [
  "tenants",
  "user_profiles",
  "prompter_master_campaigns",
  "prompter_approvals",
  "prompter_connected_accounts",
  "prompter_oauth_credentials",
  "prompter_brand_profiles",
  "prompter_products",
] as const;
