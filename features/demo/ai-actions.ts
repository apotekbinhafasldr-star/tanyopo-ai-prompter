"use server";

import { routeStructuredGeneration } from "@/lib/ai/router";
import { getDemoSession } from "@/lib/demo/is-demo-request";
import { checkAndConsumeDemoAiUsage } from "@/lib/demo/ai-usage";
import { DemoBlueprintSchema, DemoContentSchema } from "@/lib/demo/schemas";
import { DEMO_BLUEPRINT_FALLBACK, DEMO_CONTENT_FALLBACK, DEMO_PRODUCTS } from "@/lib/demo/dataset";

/**
 * HYBRID AI for the demo (Founder requirement #3): most of the demo runs
 * on pre-generated data (lib/demo/dataset.ts). These two actions are the
 * only place a demo session can reach a real, live AI provider call —
 * and even then only after a demo session is verified and the hard
 * cap/rate-limit in lib/demo/ai-usage.ts allows it.
 *
 * Deliberately calls lib/ai/router.ts#routeStructuredGeneration directly
 * instead of services/ai-jobs.ts#runAiJob: runAiJob is the tenant-scoped
 * entitlement/bookkeeping chokepoint (writes a prompter_ai_jobs row tied
 * to a real tenant_id via the FROZEN fn_create_ai_job_if_entitled RPC) —
 * a demo session has no tenant_id and must never be able to consume or
 * touch a real tenant's AI allowance. Nothing here is left unmetered as a
 * result: lib/demo/ai-usage.ts is the demo's own, separate metering path.
 *
 * Every return value is a plain object carrying a `simulated` marker so
 * the UI can render the required "Data Simulasi" badge (Founder
 * requirement #7) — `simulated: false` only on a genuine, successful live
 * model response.
 */

export interface DemoBlueprintResult {
  summary: string;
  usp: string;
  benefits: string[];
  targetPersona: string;
  recommendedChannel: "INSTAGRAM" | "TIKTOK";
  simulated: boolean;
}

export async function generateDemoBlueprintAction(productId: string): Promise<DemoBlueprintResult> {
  const product = DEMO_PRODUCTS.find((p) => p.id === productId) ?? DEMO_PRODUCTS[0];
  const session = await getDemoSession();

  if (!session) {
    return { ...DEMO_BLUEPRINT_FALLBACK, simulated: true };
  }

  const usage = await checkAndConsumeDemoAiUsage(session.sessionId);
  if (!usage.allowed) {
    return { ...DEMO_BLUEPRINT_FALLBACK, simulated: true };
  }

  try {
    const result = await routeStructuredGeneration("STRATEGY", DemoBlueprintSchema, {
      system:
        "Anda adalah asisten strategi marketing untuk demo produk LINOE. Tulis singkat dan praktis dalam Bahasa Indonesia. Ini adalah data demo, jangan mengarang klaim medis, statistik palsu, atau janji hasil finansial.",
      prompt: `Buatkan ringkasan strategi marketing singkat untuk produk berikut:\nNama: ${product.name}\nKategori: ${product.category}\nHarga: Rp${product.price.toLocaleString("id-ID")}\nDeskripsi: ${product.description}`,
    });

    return { ...result.data, simulated: false };
  } catch {
    // AIRoutingNotConfiguredError (no provider key) or any live-call
    // failure both fail safe to the canned response — a demo visitor
    // never sees a stack trace or a broken step.
    return { ...DEMO_BLUEPRINT_FALLBACK, simulated: true };
  }
}

export interface DemoContentResult {
  caption: string;
  hashtags: string[];
  simulated: boolean;
}

export async function generateDemoContentAction(productId: string): Promise<DemoContentResult> {
  const product = DEMO_PRODUCTS.find((p) => p.id === productId) ?? DEMO_PRODUCTS[0];
  const session = await getDemoSession();

  if (!session) {
    return { ...DEMO_CONTENT_FALLBACK.body, simulated: true };
  }

  const usage = await checkAndConsumeDemoAiUsage(session.sessionId);
  if (!usage.allowed) {
    return { ...DEMO_CONTENT_FALLBACK.body, simulated: true };
  }

  try {
    const result = await routeStructuredGeneration("STANDARD", DemoContentSchema, {
      system:
        "Anda adalah copywriter media sosial untuk demo produk LINOE. Tulis dalam Bahasa Indonesia yang natural dan singkat. Ini adalah data demo, jangan mengarang testimoni palsu atau urgensi yang tidak benar.",
      prompt: `Buatkan satu caption Instagram singkat untuk produk: ${product.name} - ${product.description}`,
    });

    return { ...result.data, simulated: false };
  } catch {
    return { ...DEMO_CONTENT_FALLBACK.body, simulated: true };
  }
}
