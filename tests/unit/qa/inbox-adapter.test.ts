import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED_DOMAINS, QA_SENDER_DOMAIN, createInboxAdapter } from "../../../scripts/qa/inbox-adapter.mjs";

// Semua nilai PALSU. Tidak ada jaringan: fetch disuntik.
const TOKEN = "FAKE-INBOX-TOKEN-987";
const ADDR = "qa-inbox@qa.tanyopo.com";

type Row = { id: string; to: string[]; subject: string; created_at: string; html?: string; headers?: Record<string, string> };

function makeFetch(store: { rows: Row[] }, calls: { url: string; init: RequestInit }[] = []) {
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const u = new URL(url);
    if (u.pathname === "/emails/receiving") {
      return { ok: true, status: 200, json: async () => ({ object: "list", has_more: false, data: store.rows.map(({ html, headers, ...r }) => r) }) };
    }
    const id = u.pathname.split("/").pop();
    const row = store.rows.find((r) => r.id === id);
    if (!row) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ ...row }) };
  };
  return fn as unknown as typeof fetch;
}

function setup(store: { rows: Row[] }, extra: Record<string, unknown> = {}) {
  let t = 0;
  const sleeps: number[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const adapter = createInboxAdapter("resend", {
    fetch: makeFetch(store, calls),
    token: TOKEN,
    address: ADDR,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    ...extra,
  });
  return { adapter, sleeps, calls };
}

const OLD: Row = { id: "old1", to: [ADDR], subject: "Konfirmasi lama", created_at: "2026-11-14T00:00:00.000Z" };
const NEW: Row = {
  id: "new1",
  to: [`QA <${ADDR}>`],
  subject: "Konfirmasi email Anda",
  created_at: "2026-11-14T01:00:00.000Z",
  html: "<p>halo</p>",
  headers: { "Authentication-Results": "spf=pass dkim=pass", "Received-SPF": "pass", "DKIM-Signature": "v=1; d=x" },
};

describe("inbox adapter (Resend Receiving, fetch palsu)", () => {
  it("sukses: mengembalikan pesan baru setelah clear beserta header", async () => {
    const store = { rows: [OLD] };
    const { adapter, calls } = setup(store);
    await adapter.clear();
    store.rows.push(NEW);
    const msg = await adapter.waitForMessage({ subjectIncludes: "konfirmasi email", timeoutMs: 30000 });
    expect(msg.subject).toBe("Konfirmasi email Anda");
    expect(msg.html).toBe("<p>halo</p>");
    expect(msg.headers["authentication-results"]).toBe("spf=pass dkim=pass");
    expect(msg.headers["received-spf"]).toBe("pass");
    expect(msg.headers["dkim-signature"]).toBe("v=1; d=x");
    for (const c of calls) {
      expect(c.url.startsWith("https://api.resend.com/")).toBe(true);
      expect(c.init.method).toBe("GET");
      expect(c.init.redirect).toBe("error");
    }
  });

  it("pesan lama (sebelum clear) diabaikan lalu timeout", async () => {
    const store = { rows: [{ ...OLD, subject: "Konfirmasi email Anda" }] };
    const { adapter } = setup(store);
    await adapter.clear();
    await expect(adapter.waitForMessage({ subjectIncludes: "Konfirmasi", timeoutMs: 5000 })).rejects.toThrow("INBOX_TIMEOUT");
  });

  it("waitForMessage sebelum clear ditolak", async () => {
    const { adapter } = setup({ rows: [OLD] });
    await expect(adapter.waitForMessage({ subjectIncludes: "x", timeoutMs: 1000 })).rejects.toThrow("INBOX_NOT_CLEARED");
  });

  it("pesan untuk alamat lain diabaikan", async () => {
    const store = { rows: [] as Row[] };
    const { adapter } = setup(store);
    await adapter.clear();
    store.rows.push({ ...NEW, id: "other1", to: ["orang@qa.tanyopo.com"] });
    await expect(adapter.waitForMessage({ subjectIncludes: "Konfirmasi", timeoutMs: 3000 })).rejects.toThrow("INBOX_TIMEOUT");
  });

  it("timeout memakai backoff eksponensial tanpa busy loop", async () => {
    const { adapter, sleeps } = setup({ rows: [] }, { initialDelayMs: 100, maxDelayMs: 400 });
    await adapter.clear();
    await expect(adapter.waitForMessage({ subjectIncludes: "x", timeoutMs: 1500 })).rejects.toThrow("INBOX_TIMEOUT");
    expect(sleeps.length > 0).toBe(true);
    expect(sleeps.slice(0, 3)).toEqual([100, 200, 400]);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(400);
  });

  it("batas percobaan membatasi jumlah request daftar", async () => {
    const { adapter, calls } = setup({ rows: [] }, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 });
    await adapter.clear();
    const before = calls.length;
    await expect(adapter.waitForMessage({ subjectIncludes: "x", timeoutMs: 600000 })).rejects.toThrow("INBOX_TIMEOUT");
    expect(calls.length - before).toBe(3);
  });

  it("alamat non-qa ditolak: domain lain, subdomain, plus-address, homoglyph, display-name", async () => {
    const f = makeFetch({ rows: [] });
    const bad = [
      "orang@gmail.com",
      "a@tanyopo.com",
      "a@evil.qa.tanyopo.com",
      "a@qa.tanyopo.com.evil.com",
      "a@abc.resend.app",
      "a+tag@qa.tanyopo.com",
      "a%b@qa.tanyopo.com",
      "QA <a@qa.tanyopo.com>",
      "a@qa.tanyopo.com, b@qa.tanyopo.com",
      "a@qa.tanyopo.com\r\nbcc:x@y.com",
      "\u212A@qa.tanyopo.com", // Kelvin sign
      "a@qa.tanyopo.com\u212A",
    ];
    for (const address of bad) {
      expect(() => createInboxAdapter("resend", { fetch: f, token: TOKEN, address })).toThrow("INBOX_REFUSED");
    }
    const { adapter } = setup({ rows: [] });
    await expect(adapter.clear({ address: "orang@gmail.com" })).rejects.toThrow("INBOX_REFUSED");
    await expect(adapter.clear({ address: "lain@qa.tanyopo.com" })).rejects.toThrow("INBOX_REFUSED");
    await expect(adapter.clear({ address: "qa-inbox+x@qa.tanyopo.com" })).rejects.toThrow("INBOX_REFUSED");
  });

  it("domain tidak dapat diperluas lewat deps (allowedDomains diabaikan)", () => {
    const f = makeFetch({ rows: [] });
    const extra = { fetch: f, token: TOKEN, address: "a@abc.resend.app", allowedDomains: ["abc.resend.app"] } as never;
    expect(() => createInboxAdapter("resend", extra)).toThrow("INBOX_REFUSED");
    expect(DEFAULT_ALLOWED_DOMAINS).toEqual(["qa.tanyopo.com"]);
    expect(QA_SENDER_DOMAIN).toBe("qa.tanyopo.com");
  });

  it("konstanta domain sama dengan sender-lock #151 (git show atau berkas guard lokal bila sudah merge)", () => {
    const root = path.resolve(__dirname, "../../..");
    let src: string | null = null;
    try {
      src = execFileSync("git", ["show", "origin/qa-2/sender-lock:scripts/qa/real-e2e-guard.mjs"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      src = null;
    }
    if (src === null || !/QA_SENDER_DOMAIN\s*=/.test(src)) {
      try {
        src = readFileSync(path.join(root, "scripts/qa/real-e2e-guard.mjs"), "utf8");
      } catch {
        src = null;
      }
    }
    if (src === null || !/QA_SENDER_DOMAIN\s*=/.test(src)) return; // #151 tidak terbaca di lingkungan ini (mis. checkout dangkal)
    const m = /QA_SENDER_DOMAIN\s*=\s*"([^"]+)"/.exec(src);
    expect(m?.[1]).toBe(QA_SENDER_DOMAIN);
  });

  it("token tidak bocor di pesan error (auth gagal, fetch melempar token, parameter kosong)", async () => {
    const f401 = (async () => ({ ok: false, status: 401, json: async () => ({ echo: TOKEN }) })) as unknown as typeof fetch;
    const a1 = createInboxAdapter("resend", { fetch: f401, token: TOKEN, address: ADDR });
    const e1 = await a1.clear().catch((e: Error) => e);
    expect(String((e1 as Error).message)).toContain("INBOX_AUTH_FAILED");
    expect(String((e1 as Error).message)).not.toContain(TOKEN);

    const fThrow = (async () => {
      throw new Error(`gagal koneksi Authorization: Bearer ${TOKEN}`);
    }) as unknown as typeof fetch;
    const a2 = createInboxAdapter("resend", { fetch: fThrow, token: TOKEN, address: ADDR });
    const e2 = await a2.clear().catch((e: Error) => e);
    expect(String((e2 as Error).message)).not.toContain(TOKEN);

    const e3 = (() => {
      try {
        createInboxAdapter("resend", { fetch: f401, token: "", address: ADDR });
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(String(e3?.message)).toContain("INBOX_MISCONFIGURED");
    expect(String(e3?.message)).not.toContain(TOKEN);
  });

  it("jenis tidak dikenal atau tanpa deps: fail-closed", () => {
    expect(() => createInboxAdapter("imap")).toThrow("NOT_IMPLEMENTED: provider not chosen");
    expect(() => createInboxAdapter("unset")).toThrow("NOT_IMPLEMENTED: provider not chosen");
    expect(() => createInboxAdapter(undefined as unknown as string)).toThrow("NOT_IMPLEMENTED");
    expect(() => createInboxAdapter("resend")).toThrow("INBOX_MISCONFIGURED");
  });

  it("opsi waitForMessage tidak valid ditolak", async () => {
    const { adapter } = setup({ rows: [] });
    await adapter.clear();
    await expect(adapter.waitForMessage({ subjectIncludes: "", timeoutMs: 1000 })).rejects.toThrow("INBOX_BAD_OPTIONS");
    await expect(adapter.waitForMessage({ subjectIncludes: "x", timeoutMs: 0 })).rejects.toThrow("INBOX_BAD_OPTIONS");
  });
});
