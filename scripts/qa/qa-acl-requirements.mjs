// QA-2: daftar kebutuhan ACL (grant) yang diperiksa verifikasi akhir dan mode `diagnose`.
//
// Node murni, tanpa dependensi, tanpa koneksi. Sumber tunggal untuk:
//   * kueri diagnosis baca-saja (apply-schema-bundle.mjs, mode diagnose): satu baris per sub-syarat;
//   * tes yang mencocokkan daftar ini dengan Q_VERIFY dan dengan qa/qa2-grants.sql.
// Tiap entri: indicator = nama indikator di Q_VERIFY yang memuat sub-syarat itu.
export const ACL_REQUIREMENTS = Object.freeze([
  // authenticated_access (dipenuhi shim qa/qa2-shim.sql)
  { indicator: "authenticated_access", kind: "table", role: "authenticated", object: "public.tenants", priv: "select" },
  { indicator: "authenticated_access", kind: "table", role: "authenticated", object: "public.user_profiles", priv: "select" },
  { indicator: "authenticated_access", kind: "function", role: "authenticated", object: "public.fn_current_tenant_id()", priv: "execute" },
  { indicator: "authenticated_access", kind: "function", role: "authenticated", object: "public.fn_current_role()", priv: "execute" },
  // service_role_access
  { indicator: "service_role_access", kind: "table", role: "service_role", object: "public.tenants", priv: "select" },
  { indicator: "service_role_access", kind: "table", role: "service_role", object: "public.user_profiles", priv: "select" },
  { indicator: "service_role_access", kind: "table", role: "service_role", object: "public.prompter_subscriptions", priv: "select" },
  // app_table_grants
  { indicator: "app_table_grants", kind: "table", role: "authenticated", object: "public.prompter_brand_profiles", priv: "insert" },
  { indicator: "app_table_grants", kind: "table", role: "authenticated", object: "public.prompter_audit_logs", priv: "insert" },
  { indicator: "app_table_grants", kind: "table", role: "authenticated", object: "public.prompter_subscriptions", priv: "insert" },
  { indicator: "app_table_grants", kind: "table", role: "authenticated", object: "public.prompter_subscriptions", priv: "select" },
  { indicator: "app_table_grants", kind: "table", role: "authenticated", object: "public.prompter_analytics_insights", priv: "select" },
]);

/**
 * Kebutuhan tambahan DARI KODE (bukan dari Q_VERIFY): reset identitas QA (scripts/qa/qa-admin-client.mjs, removeIdentity)
 * memakai service_role untuk DELETE prompter_subscriptions dan tenants. Hanya dilaporkan diagnose; tidak ikut Q_VERIFY.
 */
export const ACL_APP_NEEDS = Object.freeze([
  { indicator: "kode_reset_identitas", kind: "table", role: "service_role", object: "public.prompter_subscriptions", priv: "delete" },
  { indicator: "kode_reset_identitas", kind: "table", role: "service_role", object: "public.tenants", priv: "delete" },
]);

/**
 * PRIVILEGE YANG TIDAK BOLEH ADA (kunci keamanan migrasi P0 di prompter_subscriptions). Diagnose melaporkan bila ada.
 * Nilai ok = false berarti privilege tidak ada (benar).
 */
export const ACL_FORBIDDEN = Object.freeze([
  { indicator: "terlarang", kind: "table", role: "authenticated", object: "public.prompter_subscriptions", priv: "update" },
  { indicator: "terlarang", kind: "table", role: "authenticated", object: "public.prompter_subscriptions", priv: "delete" },
  { indicator: "terlarang", kind: "table", role: "anon", object: "public.prompter_subscriptions", priv: "insert" },
  { indicator: "terlarang", kind: "table", role: "anon", object: "public.prompter_subscriptions", priv: "delete" },
]);

const IDENT = /^[a-z_][a-z0-9_.()]*$/;
const lit = (s) => {
  if (!IDENT.test(s)) throw new Error(`identifier tidak aman: ${s}`);
  return `'${s}'`;
};

/** Ekspresi SQL satu sub-syarat: null bila objek tidak ada; selain itu boolean has_*_privilege. */
export function privilegeExpr(r) {
  const fn = r.kind === "function" ? "has_function_privilege" : "has_table_privilege";
  const reg = r.kind === "function" ? `to_regprocedure(${lit(r.object)})` : `to_regclass(${lit(r.object)})`;
  return `case when ${reg} is null then null else ${fn}(${lit(r.role)}, ${lit(r.object)}, ${lit(r.priv)}) end`;
}

/**
 * Kueri diagnosis baca-saja: satu baris `acl|<indikator>|<role>|<objek>|<priv>|<t|f|MISSING>` per sub-syarat.
 * Hanya SELECT dari VALUES; lolos assertReadOnly. Literal berasal dari daftar tetap di atas (bukan input pengguna).
 */
export function buildAclQuery(list = [...ACL_REQUIREMENTS, ...ACL_APP_NEEDS, ...ACL_FORBIDDEN]) {
  const rows = list.map((r) => `(${lit(r.indicator)}, ${lit(r.role)}, ${lit(r.object)}, ${lit(r.priv)}, ${privilegeExpr(r)})`);
  return (
    "select 'acl|' || v.i || '|' || v.r || '|' || v.o || '|' || v.p || '|' || case when v.ok is null then 'MISSING' when v.ok then 't' else 'f' end " +
    `from (values ${rows.join(", ")}) as v(i, r, o, p, ok);`
  );
}

/** ACL mentah relasi prompter_* (pemilik, RLS, relacl) untuk ditampilkan; tidak memuat data baris. */
export const Q_DIAG_RELACL =
  "select 'relacl|' || c.relname || '|owner=' || pg_get_userbyid(c.relowner) || '|rls=' || c.relrowsecurity::text || '|' || coalesce(c.relacl::text, 'NULL') " +
  "from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
  "where n.nspname = 'public' and c.relkind = 'r' and (c.relname like 'prompter%' or c.relname in ('tenants', 'user_profiles')) order by c.relname;";

export const Q_DIAG_DEFACL =
  "select 'defacl|' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclobjtype::text || '|' || coalesce(d.defaclnamespace::regnamespace::text, 'global') || '|' || d.defaclacl::text " +
  "from pg_default_acl d order by 1;";

export const Q_DIAG_ROLES =
  "select 'role|' || r.rolname || '|bypassrls=' || r.rolbypassrls::text || '|super=' || r.rolsuper::text || '|schema_usage=' || has_schema_privilege(r.rolname, 'public', 'usage')::text " +
  "from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by r.rolname;";
