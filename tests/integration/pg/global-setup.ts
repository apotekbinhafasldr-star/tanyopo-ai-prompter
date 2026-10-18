import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PsqlSession } from "./psql-session";
import {
  PRODUCTION_ONLY_TABLES,
  PgIsolationError,
  REQUIRED_DATABASE,
  pgTestEnabled,
  pgTestRequired,
  resolvePgConfig,
} from "./pg-env";

/**
 * Runs once before the PostgreSQL tests. It (1) refuses to continue unless the
 * target is provably the throw-away "linoe_pg_test" database, (2) loads the
 * ephemeral fixture schema. Nothing here can reach Supabase: the guard rejects
 * every non-local host, every Supabase hostname and every production credential.
 */
export default async function setup(): Promise<void> {
  if (!pgTestEnabled()) {
    if (pgTestRequired()) {
      throw new PgIsolationError("LINOE_PG_REQUIRE=1 but LINOE_PG_TEST is not 1 (refusing a vacuous pass)");
    }
    console.warn("[pg-tests] skipped: LINOE_PG_TEST is not 1");
    return;
  }

  const cfg = resolvePgConfig();
  const session = await PsqlSession.open(cfg, "setup");
  try {
    const db = await session.exec("select current_database();");
    if (db.rows[0] !== REQUIRED_DATABASE) {
      throw new PgIsolationError(`connected database is "${db.rows[0]}", expected "${REQUIRED_DATABASE}"`);
    }

    const version = await session.exec("show server_version_num;");
    if (Number(version.rows[0]) < 160000) {
      throw new Error(`PostgreSQL 16 or newer is required (server_version_num=${version.rows[0]})`);
    }

    const names = PRODUCTION_ONLY_TABLES.map((t) => `'${t}'`).join(", ");
    const prod = await session.exec(
      `select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema') and table_name in (${names});`,
    );
    if (Number(prod.rows[0]) !== 0) {
      throw new PgIsolationError("production tables exist in this database; refusing to run");
    }

    const schema = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");
    const loaded = await session.exec(schema, 60_000);
    if (loaded.error) throw new Error(`fixture schema failed to load: ${loaded.error}`);
  } finally {
    await session.close();
  }
}
