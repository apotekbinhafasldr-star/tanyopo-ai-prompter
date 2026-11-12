// CI-ONLY fixture: a tiny fake Supabase (auth + PostgREST) listening on 127.0.0.1:54321 on the GitHub runner.
// The app under test runs its REAL code against it (NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321), so the app
// itself contains no test bypass and cannot be "opened" in production. Answers are fixtures; every write is a no-op echo.
import http from "node:http";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
export const USERS = {
  complete: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "qa-complete@example.test", tenant: T1 },
  newbie: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "qa-new@example.test", tenant: T2 },
};
const now = new Date();
const in14 = new Date(now.getTime() + 14 * 864e5).toISOString();
const FIX = {
  user_profiles: [
    { id: USERS.complete.id, nama: "QA Pengguna", role: "owner", tenant_id: T1 },
    { id: USERS.newbie.id, nama: "QA Baru", role: "owner", tenant_id: T2 },
  ],
  tenants: [{ id: T1, nama_usaha: "Toko QA" }, { id: T2, nama_usaha: "Toko Baru" }],
  prompter_brand_profiles: [
    { tenant_id: T1, brand_name: "Toko QA", onboarding_completed: true, default_language: "id", default_currency: "IDR", country_code: "ID" },
    { tenant_id: T2, brand_name: null, onboarding_completed: false, default_language: "id", default_currency: "IDR", country_code: "ID" },
  ],
  prompter_subscriptions: [
    { tenant_id: T1, plan: "FREE", status: "TRIALING", current_period_start: now.toISOString(), current_period_end: in14, cancel_at_period_end: false, created_at: now.toISOString(), updated_at: now.toISOString() },
  ],
};
const jwtSub = (req) => {
  try { return JSON.parse(Buffer.from((req.headers.authorization ?? "").split(" ")[1].split(".")[1], "base64url").toString()).sub; } catch { return null; }
};
const log = [];
let delayMs = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    log.push(`${req.method} ${url.pathname}${url.search.slice(0, 80)}`);
    if (url.pathname === "/__log") return send(200, log.slice(-200));
    if (url.pathname === "/__delay") { delayMs = Number(url.searchParams.get("ms") ?? 0); return send(200, { delayMs }); }
    if (delayMs && url.pathname.startsWith("/rest/v1/") && !["user_profiles", "tenants", "prompter_brand_profiles"].includes(url.pathname.slice(9))) return void setTimeout(() => handle(), delayMs);
    handle();
    function handle() {
    if (url.pathname === "/auth/v1/user") {
      const sub = jwtSub(req);
      const u = Object.values(USERS).find((x) => x.id === sub);
      if (!u) return send(401, { code: 401, msg: "invalid JWT" });
      return send(200, { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: now.toISOString(), app_metadata: {}, user_metadata: {}, created_at: now.toISOString() });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) return send(200, null);
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE" || req.method === "PUT") {
        let body = null; try { body = JSON.parse(raw); } catch {}
        return send(req.method === "DELETE" ? 204 : 201, Array.isArray(body) ? body : body ? [body] : []);
      }
      let rows = FIX[table] ?? [];
      for (const [k, v] of url.searchParams) {
        if (typeof v === "string" && v.startsWith("eq.")) rows = rows.filter((r) => !(k in r) || String(r[k]) === v.slice(3));
      }
      if (req.method === "HEAD" || /count=/.test(req.headers.prefer ?? "")) {
        return send(200, req.method === "HEAD" ? undefined : rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
      }
      if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
        return rows.length === 1 ? send(200, rows[0]) : send(406, { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" });
      }
      return send(200, rows);
    }
    send(404, { error: "not found" });
    }
  });
});
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) server.listen(54321, () => console.log("mock supabase on 54321"));
