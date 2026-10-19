import { describe, expect, it } from "vitest";
import {
  PRODUCTION_ONLY_TABLES,
  PgIsolationError,
  REQUIRED_DATABASE,
  pgTestEnabled,
  pgTestRequired,
  resolvePgConfig,
} from "../../integration/pg/pg-env";

const good = {
  LINOE_PG_TEST: "1",
  PGHOST: "localhost",
  PGPORT: "5432",
  PGUSER: "postgres",
  PGPASSWORD: "pw",
  PGDATABASE: "linoe_pg_test",
};

describe("PostgreSQL test isolation guard", () => {
  it("accepts a local throw-away database", () => {
    expect(resolvePgConfig(good)).toEqual({
      host: "localhost",
      port: "5432",
      user: "postgres",
      password: "pw",
      database: REQUIRED_DATABASE,
    });
  });

  it("accepts 127.0.0.1, ::1 and a unix socket directory", () => {
    for (const host of ["127.0.0.1", "::1", "/var/run/postgresql"]) {
      expect(resolvePgConfig({ ...good, PGHOST: host }).host).toBe(host);
    }
  });

  it("is off unless LINOE_PG_TEST=1", () => {
    expect(pgTestEnabled({})).toBe(false);
    expect(pgTestEnabled({ LINOE_PG_TEST: "true" })).toBe(false);
    expect(() => resolvePgConfig({ ...good, LINOE_PG_TEST: "0" })).toThrow(PgIsolationError);
    expect(pgTestRequired({ LINOE_PG_REQUIRE: "1" })).toBe(true);
    expect(pgTestRequired({})).toBe(false);
  });

  it("rejects any database other than linoe_pg_test", () => {
    for (const db of ["postgres", "linoe_pg_test2", "LINOE_PG_TEST", "", "prod"]) {
      expect(() => resolvePgConfig({ ...good, PGDATABASE: db })).toThrow(PgIsolationError);
    }
    expect(() => resolvePgConfig({ ...good, PGDATABASE: undefined })).toThrow(PgIsolationError);
  });

  it("rejects remote hosts, including Supabase hosts", () => {
    for (const host of [
      "db.wjjyqovhmwenbcvbnkgx.supabase.co",
      "aws-0-ap-southeast-1.pooler.supabase.com",
      "10.0.0.5",
      "example.com",
      "",
      "localhost.evil.com",
    ]) {
      expect(() => resolvePgConfig({ ...good, PGHOST: host })).toThrow(PgIsolationError);
    }
    expect(() => resolvePgConfig({ ...good, PGHOST: undefined })).toThrow(PgIsolationError);
  });

  it("rejects production credentials in the environment", () => {
    for (const key of [
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "TOKEN_ENCRYPTION_KEY",
      "META_APP_SECRET",
      "DATABASE_URL",
      "POSTGRES_URL",
      "POSTGRES_PRISMA_URL",
    ]) {
      expect(() => resolvePgConfig({ ...good, [key]: "something" })).toThrow(PgIsolationError);
    }
  });

  it("rejects any variable that points at a Supabase project, but allows the CI build placeholder", () => {
    expect(() => resolvePgConfig({ ...good, SOME_URL: "https://wjjyqovhmwenbcvbnkgx.supabase.co" })).toThrow(PgIsolationError);
    expect(() => resolvePgConfig({ ...good, SOME_URL: "postgres://u:p@db.x.supabase.com:5432/postgres" })).toThrow(PgIsolationError);
    expect(resolvePgConfig({ ...good, NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co" }).database).toBe(REQUIRED_DATABASE);
  });

  it("requires a user", () => {
    expect(() => resolvePgConfig({ ...good, PGUSER: "" })).toThrow(PgIsolationError);
  });

  it("lists the production-only tables that must be absent from the test database", () => {
    expect(PRODUCTION_ONLY_TABLES).toContain("tenants");
    expect(PRODUCTION_ONLY_TABLES).toContain("prompter_master_campaigns");
    expect(PRODUCTION_ONLY_TABLES).not.toContain("prompter_channel_campaigns");
  });
});
