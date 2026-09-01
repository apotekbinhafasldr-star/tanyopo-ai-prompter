import { describe, expect, it } from "vitest";
import { ConnectorConfigError } from "@/lib/connectors/types";

describe("ConnectorConfigError", () => {
  it("carries the platform and a human-readable message", () => {
    const err = new ConnectorConfigError("META", "Meta connector belum dikonfigurasi.");
    expect(err.platform).toBe("META");
    expect(err.message).toBe("Meta connector belum dikonfigurasi.");
    expect(err.name).toBe("ConnectorConfigError");
  });

  it("is a real Error instance (catchable in a standard error chain)", () => {
    const err = new ConnectorConfigError("TIKTOK", "not configured");
    expect(err).toBeInstanceOf(Error);
    expect(() => {
      throw err;
    }).toThrow(ConnectorConfigError);
  });
});
