import { KOPI_ROBUSTA_IMPROVED } from "@/tests/fixtures/ai/kopi-robusta-aceh-simulasi";
import { buildCopySnapshot } from "@/lib/campaigns/copy-guard";

/**
 * A stored proposal that passes the FULL copy guard (schema-valid, nothing blocking), and the fingerprint an
 * approval records for its copy. Launch tests use these so that the copy guard (FIX-195-LAUNCH-GUARD) lets them
 * through to the guard they actually test.
 */
export const LAUNCHABLE_PROPOSAL = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED)) as Record<string, unknown>;
export const LAUNCHABLE_COPY_SNAPSHOT = buildCopySnapshot(LAUNCHABLE_PROPOSAL) as NonNullable<ReturnType<typeof buildCopySnapshot>>;
