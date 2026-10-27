# LINOE Admin Center (Phase B)

Internal management area inside the same Next.js app: `/admin`, `/admin/finance`, `/admin/finance/tax`, `/admin/staff`.
**Ships dark and on demo data.** Builds on PR #61 (finance foundation); it does not merge it.

## Access model
- Authority comes only from an active row in `finance_platform_admins` (PR #61), extended by
  `supabase/migrations/20261027110000_linoe_admin_center_access.sql` (not applied). No email address and no tenant `owner` role grants access.
- `SUPER_ADMIN` (Founder): all permissions, including staff management. `STAFF`: only permissions explicitly granted. `FINANCE_ADMIN` / `FINANCE_VIEWER`: PR #61 roles, fixed sets. Customers: nothing.
- Sensitive permissions (`bank.manage`, `tax.manage`, `tax.export`, `finance.settlement.import`) are never implied. `refund.approve` and `staff.manage` are Founder-only (Super Admin) at this stage and cannot be granted to staff.
- Staff-change rules (`lib/admin/permissions.ts`): only a Super Admin can change access; nobody can change their own; a new Super Admin cannot be created from the app; a Super Admin cannot be edited from the app; the last active Super Admin is protected (also by a DB trigger).
- Server gate: `services/platform-admin.ts`. Every page calls `requireAdminPage(<permission>)`; a customer, an employee without the permission, a signed-out visitor, a lookup error or a missing key all get a 404. `proxy.ts` is unchanged, so `/admin` stays behind the normal login redirect.
- Master switch: `ADMIN_CENTER_ENABLED` must be exactly `true`. While off, every `/admin` page is a 404, the "Admin Perusahaan" button is hidden and no admin lookup touches the database.
- Button: shown in the customer sidebar only when the server confirms an authorised admin (`canSeeAdminCenterLink`, never throws).

## Data
All screens use fixed fictional DEMO data (`lib/admin/demo-data.ts`) through the real `lib/finance` calculations, with a DEMO banner on every page. No database read, no production data. Export and refund approval are visible but disabled; there are no forms and no server actions.

## Before it can show real data
1. Approve and apply the PR #61 migration, then `20261027110000_linoe_admin_center_access.sql`.
2. Seed the first Super Admin with an explicitly approved statement (no email in code).
3. Ingestion job + Midtrans adapter feeding `lib/finance`; replace demo data with a service read behind `requireAdminPage`.
4. Turn on `ADMIN_CENTER_ENABLED=true`.

Screenshots (390px wide, rendered from the real component markup): `docs/admin-center/`.
