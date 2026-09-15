import { describe, expect, it } from "vitest";
import { fetchKonduitUsage, resolveBaseUrl, snapshotFrom, type UsageResponse } from "./usage.js";

function usage(overrides: Partial<UsageResponse> = {}): UsageResponse {
  return {
    object: "usage",
    organisation_id: "9b1fb56e-0000-4000-8000-000000000001",
    api_key_id: "2c565c6a-0000-4000-8000-000000000001",
    balance: { currency: "EUR", booked_micro_eur: 12_340_000, reserved_micro_eur: 0, available_micro_eur: 12_340_000 },
    limits: {
      key: { requests_per_minute: 60, tokens_per_minute: 100_000 },
      organisation: { requests_per_minute: null, tokens_per_minute: 1_000_000 },
    },
    expires_at: "2026-12-31T00:00:00Z",
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Seen = { url?: string; headers?: Record<string, string> };

function fetchAnswering(response: Response, seen: Seen = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.headers = (init?.headers as Record<string, string> | undefined) ?? {};
    return response;
  }) as typeof fetch;
}

describe("resolveBaseUrl", () => {
  it("prefers the user's configured base URL, trimmed of its trailing slash", () => {
    expect(resolveBaseUrl({ models: { providers: { konduit: { baseUrl: "https://gateway.example/v1/" } } } })).toBe(
      "https://gateway.example/v1",
    );
  });

  it("falls back to the manifest's when nothing is configured", () => {
    expect(resolveBaseUrl({})).toBe("https://api.konduit.eu/v1");
    expect(resolveBaseUrl({ models: { providers: { konduit: { baseUrl: "   " } } } })).toBe("https://api.konduit.eu/v1");
  });
});

describe("snapshotFrom", () => {
  it("shows the available balance in the ledger's currency and the effective limits", () => {
    expect(snapshotFrom(usage())).toEqual({
      provider: "konduit",
      displayName: "konduit",
      windows: [],
      billing: [{ type: "balance", label: "Available credit", amount: 12.34, unit: "EUR" }],
      summary: "60 RPM · 100K TPM (key) · 1M TPM (organisation)",
    });
  });

  it("mentions a reservation only when there is one", () => {
    const snapshot = snapshotFrom(usage({ balance: { currency: "EUR", booked_micro_eur: 1_000_000, reserved_micro_eur: 40_000, available_micro_eur: 960_000 } }));
    expect(snapshot.billing).toEqual([{ type: "balance", label: "Available credit", amount: 0.96, unit: "EUR" }]);
    expect(snapshot.summary).toMatch(/^Reserved €0\.04 · /);
  });

  it("says so when no limit is configured anywhere", () => {
    const snapshot = snapshotFrom(usage({
      limits: {
        key: { requests_per_minute: null, tokens_per_minute: null },
        organisation: { requests_per_minute: null, tokens_per_minute: null },
      },
    }));
    expect(snapshot.summary).toBe("no rate limits configured");
  });

  it("treats a body that is not the contract as malformed", () => {
    for (const bad of [null, [], {}, { balance: {} }, { balance: { available_micro_eur: "12" }, limits: {} }]) {
      expect(snapshotFrom(bad).error).toBe("Malformed usage response");
    }
  });
});

describe("fetchKonduitUsage", () => {
  it("asks {baseUrl}/usage with the key as a bearer token", async () => {
    const seen: Seen = {};
    const snapshot = await fetchKonduitUsage("https://gateway.example/v1", "kdt-test", 5000, fetchAnswering(jsonResponse(200, usage()), seen));
    expect(seen.url).toBe("https://gateway.example/v1/usage");
    expect(seen.headers).toMatchObject({ Authorization: "Bearer kdt-test", Accept: "application/json" });
    expect(snapshot.billing?.[0]).toMatchObject({ amount: 12.34, unit: "EUR" });
  });

  it.each([
    [401, "konduit rejected the API key"],
    [403, "the API key lacks the usage:read scope"],
    [429, "rate limited by konduit; the card refreshes later"],
    [503, "konduit's ledger is unavailable; retry shortly"],
    [418, "HTTP 418"],
  ])("names the cause of a %d", async (status, message) => {
    const snapshot = await fetchKonduitUsage("https://gateway.example/v1", "kdt-test", 5000, fetchAnswering(jsonResponse(status, { error: {} })));
    expect(snapshot).toEqual({ provider: "konduit", displayName: "konduit", windows: [], error: message });
  });

  it("reports a body that is not JSON as malformed", async () => {
    const snapshot = await fetchKonduitUsage("https://gateway.example/v1", "kdt-test", 5000, fetchAnswering(jsonResponse(200, "{not json")));
    expect(snapshot.error).toBe("Malformed usage response");
  });
});
