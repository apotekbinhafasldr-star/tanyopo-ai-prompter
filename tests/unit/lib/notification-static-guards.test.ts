// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIG = "supabase/migrations/20261101100000_prompter_b4_2_alert_notifications.sql";
const B41 = "supabase/migrations/20261031100000_prompter_b4_payment_alerts.sql";
const SENDER = ["netlify/lib/notifier-core.ts", "netlify/functions/payment-alert-notify.ts"];

describe("Billing B4.2 — static guards", () => {
  it("the sender holds no secret, no API key literal and no hard-coded e-mail address", () => {
    for (const f of SENDER) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/re_[A-Za-z0-9]{8,}|sb_secret_|eyJ[A-Za-z0-9_-]{10,}|service_role/);
      expect(src, f).not.toMatch(/[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9.-]+\.[a-z]{2,}(?![A-Za-z])/);
      expect(src, f).not.toMatch(/tanyopo/i);
    }
  });

  it("is OFF by default: only the exact string 'true' enables it, and the schedule file only calls the core", () => {
    const core = strip(read(SENDER[0]));
    expect(core).toMatch(/ALERT_EMAIL_ENABLED[\s\S]{0,40}!==\s*"true"/);
    const fn = strip(read(SENDER[1]));
    expect(fn).toMatch(/schedule:\s*"\*\/5 \* \* \* \*"/);
    expect(fn).toMatch(/runNotifier\(/);
    expect(fn).not.toMatch(/fetch\(|resend|createClient/i);
  });

  it("is self-contained for the Netlify bundler: relative imports only, no alias, no server-only, no enums / parameter properties", () => {
    for (const f of SENDER) {
      const src = strip(read(f));
      for (const m of src.matchAll(/from\s+"([^"]+)"/g)) expect(m[1], f).toMatch(/^\.\.?\//);
      expect(src, f).not.toMatch(/server-only|@\//);
      expect(src, f).not.toMatch(/\benum\s+\w+/);
    }
  });

  it("never logs a response body, an error message or an address", () => {
    const src = strip(read(SENDER[0]));
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/log\([^)]*(\.message|\.stack|\bto\b|res\.text|JSON\.stringify\(\s*r\.json)/);
  });

  it("the migration is additive: B4.2 never replaces, alters or drops a B4.1 / PUBLOE / UMKMpro object", () => {
    const sql = strip(read(MIG)).toLowerCase();
    for (const fn of ["fn_record_payment_alarm", "fn_sync_payment_alerts", "fn_ack_payment_alert", "fn_resolve_payment_alert", "fn_is_payment_operator", "fn_note_payment_alert_sync_failure"]) {
      expect(sql, fn).not.toMatch(new RegExp(`(create or replace function|drop function|alter function)[^;]*public\\.${fn}\\b`));
    }
    for (const a of sql.matchAll(/\balter table (?:if exists )?(?:only )?(?:public\.)?(\w+)/g)) expect(a[1]).toMatch(/^prompter_payment_alert_(notif|notify)/);
    expect(sql).not.toMatch(/\bdrop table\b/);
    expect(sql).not.toMatch(/\b(cron\.schedule|net\.http_post|create extension|create policy|create role|grant (all|insert|update|delete)[^;]*to (anon|authenticated|public))/);
    for (const t of sql.matchAll(/create table if not exists public\.(\w+)/g)) expect(t[1]).toMatch(/^prompter_payment_alert_/);
    for (const t of sql.matchAll(/create or replace function public\.(\w+)/g)) expect(t[1]).toMatch(/^fn_(prompter_)?payment_notification|^fn_(claim|complete|fail|preview)_payment_notification/);
  });

  it("every B4.2 table is RLS-protected and service_role only; every definer function pins its search_path", () => {
    const sql = strip(read(MIG));
    const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(tables).toHaveLength(4);
    for (const t of tables) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated, service_role;`));
    }
    for (const body of sql.split(/create or replace function /).slice(1)) {
      if (/security definer/.test(body)) expect(body.split(/\$\$/)[0]).toMatch(/set search_path = public, pg_temp/);
    }
  });

  it("B4.2 is the migration right after B4.1 and nothing newer exists", () => {
    const migrations = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    const newer = migrations.filter((m) => m.slice(0, 14) > "20261031100000");
    expect(newer).toEqual(["20261101100000_prompter_b4_2_alert_notifications.sql"]);
    expect(read(B41)).not.toMatch(/prompter_payment_alert_notif/);
  });

  it("the env template carries placeholders only and the e-mail feature defaults to disabled", () => {
    const env = read(".env.example");
    expect(env).toMatch(/^ALERT_EMAIL_ENABLED=false$/m);
    expect(env).toMatch(/^RESEND_ALERT_API_KEY=$/m);
    expect(env).toMatch(/^ALERT_EMAIL_FROM=$/m);
    expect(env).not.toMatch(/re_[A-Za-z0-9]{8,}/);
  });
});
