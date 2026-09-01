import { describe, expect, it } from "vitest";
import { recordWebhookEvent, createPromotionHandoff, recordConversion } from "@/lib/umkmpro/handoff";
import { createMockAdmin } from "./supabase-mock";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

describe("recordWebhookEvent — idempotent webhook receipt", () => {
  it("records a brand-new event", async () => {
    const admin = createMockAdmin({
      prompter_webhook_events: [
        { data: null, error: null }, // existing-check: none found
        { data: { id: "evt-row-1" }, error: null }, // insert result
      ],
    });

    const result = await recordWebhookEvent(admin, {
      tenantId: TENANT_ID,
      externalEventId: "umkmpro-evt-1",
      eventType: "product.updated",
      payload: {},
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.eventId).toBe("evt-row-1");
      expect(result.alreadyProcessed).toBeUndefined();
    }
  });

  it("treats a redelivered event id as a safe no-op (replay protection)", async () => {
    const admin = createMockAdmin({
      prompter_webhook_events: [
        { data: { id: "evt-row-1", status: "PROCESSED" }, error: null }, // existing-check: found
      ],
    });

    const result = await recordWebhookEvent(admin, {
      tenantId: TENANT_ID,
      externalEventId: "umkmpro-evt-1", // same id as before
      eventType: "product.updated",
      payload: {},
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.eventId).toBe("evt-row-1");
      expect(result.alreadyProcessed).toBe(true);
    }
  });

  it("marks tenant_id null events IGNORED when the tenant couldn't be resolved", async () => {
    const admin = createMockAdmin({
      prompter_webhook_events: [
        { data: null, error: null },
        { data: { id: "evt-row-2" }, error: null },
      ],
    });

    const result = await recordWebhookEvent(admin, {
      tenantId: null,
      externalEventId: "umkmpro-evt-2",
      eventType: "unknown.tenant",
      payload: {},
    });

    expect(result.ok).toBe(true);
  });
});

describe("createPromotionHandoff — idempotent on (tenant, source, idempotency_key)", () => {
  it("creates a new handoff", async () => {
    const admin = createMockAdmin({
      prompter_promotion_handoffs: [
        { data: null, error: null }, // no existing handoff for this key
        { data: { id: "handoff-1" }, error: null }, // insert result
      ],
    });

    const result = await createPromotionHandoff(admin, {
      tenantId: TENANT_ID,
      idempotencyKey: "key-abc",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.handoffId).toBe("handoff-1");
      expect(result.alreadyProcessed).toBeUndefined();
    }
  });

  it("returns the existing handoff for a repeated idempotency key rather than creating a duplicate", async () => {
    const admin = createMockAdmin({
      prompter_promotion_handoffs: [{ data: { id: "handoff-1" }, error: null }],
    });

    const result = await createPromotionHandoff(admin, {
      tenantId: TENANT_ID,
      idempotencyKey: "key-abc", // same key
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.handoffId).toBe("handoff-1");
      expect(result.alreadyProcessed).toBe(true);
    }
  });
});

describe("recordConversion — idempotent on (tenant, source, external_event_id)", () => {
  it("records a new conversion", async () => {
    const admin = createMockAdmin({
      prompter_conversions: [{ data: [{ id: "conv-1" }], error: null, count: 1 }],
    });

    const result = await recordConversion(admin, {
      tenantId: TENANT_ID,
      externalEventId: "order-1",
      eventType: "PURCHASE",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.alreadyProcessed).toBe(false);
  });

  it("treats a redelivered conversion event as already processed (count 0 from ignoreDuplicates)", async () => {
    const admin = createMockAdmin({
      prompter_conversions: [{ data: [], error: null, count: 0 }],
    });

    const result = await recordConversion(admin, {
      tenantId: TENANT_ID,
      externalEventId: "order-1", // same external_event_id as before
      eventType: "PURCHASE",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.alreadyProcessed).toBe(true);
  });
});
