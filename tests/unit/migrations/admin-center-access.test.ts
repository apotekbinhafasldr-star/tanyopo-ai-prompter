import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf-8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ");

const up = strip(read("supabase/migrations/20261027110000_linoe_admin_center_access.sql"));
const down = strip(read("supabase/rollback/20261027110000_linoe_admin_center_access.down.sql"));

describe("admin center access migration — additive, scoped, no hard-coded identity", () => {
  it("only alters the new finance_platform_admins table and creates no table", () => {
    expect(up).not.toMatch(/create table/i);
    for (const m of up.matchAll(/alter table ([a-z_.]+)/g)) expect(m[1]).toBe("public.finance_platform_admins");
    expect(up).not.toMatch(/drop table|drop column|truncate|rename to|alter column/i);
  });

  it("never touches billing, tenants, cron or other products", () => {
    expect(up).not.toMatch(/prompter_|cron\.|pg_net|umkmpro|apotek|publoe|karyawan|auth\.users/i);
  });

  it("seeds nobody: no insert, no email address, no uuid literal", () => {
    expect(up).not.toMatch(/insert into|update public|@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(up).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("allows the four roles and an allow-list of permissions that excludes staff.manage", () => {
    expect(up).toContain("'SUPER_ADMIN', 'STAFF', 'FINANCE_ADMIN', 'FINANCE_VIEWER'");
    const list = /permissions <@ array\[(.*?)\]/.exec(up);
    expect(list).not.toBeNull();
    expect(list?.[1]).not.toContain("staff.manage");
    expect(list?.[1]).toContain("'refund.approve'");
    expect(list?.[1]).toContain("'bank.manage'");
  });

  it("protects the last active SUPER_ADMIN and grants nothing to anon/authenticated", () => {
    expect(up).toContain("the last active SUPER_ADMIN cannot be removed or weakened");
    expect(up).not.toMatch(/create policy/i);
    expect(up).not.toMatch(/grant [^;]* to/i);
    expect(up).toContain("revoke all on function public.fn_finance_admins_keep_super_admin() from public, anon, authenticated");
  });

  it("has a lock timeout", () => {
    expect(up).toContain("set local lock_timeout");
  });
});

describe("admin center access rollback — fails closed", () => {
  it("refuses while any SUPER_ADMIN/STAFF row or permission exists, before changing anything", () => {
    expect(down).toContain("rollback refused");
    expect(down.indexOf("rollback refused")).toBeLessThan(down.indexOf("drop trigger"));
    expect(down).toContain("role in ('SUPER_ADMIN', 'STAFF') or cardinality(permissions) > 0");
  });
});
