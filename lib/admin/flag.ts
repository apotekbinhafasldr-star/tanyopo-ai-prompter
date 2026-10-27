/**
 * Master switch for the Admin Center. OFF unless ADMIN_CENTER_ENABLED is exactly
 * "true". While off: every /admin page is a 404, the "Admin Perusahaan" button is
 * hidden, and no admin lookup touches the database. This is a rollout guard on top
 * of authorisation, never a substitute for it.
 */
export function isAdminCenterEnabled(): boolean {
  return process.env.ADMIN_CENTER_ENABLED === "true";
}
