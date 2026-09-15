import { describe, expect, it } from "vitest";
import type { OpenClawPluginApi, ProviderPlugin } from "openclaw/plugin-sdk/plugin-entry";
import entry from "./index.js";

// Everything the entry helper touches on the api besides registerProvider is
// accepted and ignored: a callable that returns itself for any property.
const anything: unknown = new Proxy(function () {}, {
  get: (_target, property) => (property === "then" ? undefined : anything),
  apply: () => anything,
});

function registered(): ProviderPlugin {
  const providers: ProviderPlugin[] = [];
  const api = new Proxy({} as OpenClawPluginApi, {
    get: (_target, property) =>
      property === "registerProvider"
        ? (provider: ProviderPlugin) => {
            providers.push(provider);
          }
        : anything,
  });
  entry.register(api);
  expect(providers).toHaveLength(1);
  return providers[0]!;
}

function usageBody() {
  return {
    object: "usage",
    organisation_id: "org",
    api_key_id: "key",
    balance: { currency: "EUR", booked_micro_eur: 1_000_000, reserved_micro_eur: 0, available_micro_eur: 1_000_000 },
    limits: {
      key: { requests_per_minute: null, tokens_per_minute: null },
      organisation: { requests_per_minute: null, tokens_per_minute: null },
    },
    expires_at: null,
  };
}

describe("the konduit plugin entry", () => {
  it("registers provider konduit with both usage hooks, so OpenClaw auto-discovers it", () => {
    const provider = registered();
    expect(provider.id).toBe("konduit");
    expect(provider.label).toBe("konduit");
    expect(typeof provider.resolveUsageAuth).toBe("function");
    expect(typeof provider.fetchUsageSnapshot).toBe("function");
    expect(provider.catalog).toBeDefined();
  });

  it("resolves usage auth from the API key, and declines when there is none", async () => {
    const provider = registered();
    const resolve = (key?: string) =>
      provider.resolveUsageAuth!({
        config: {},
        env: { KONDUIT_API_KEY: key },
        provider: "konduit",
        resolveApiKeyFromConfigAndStore: ({ envDirect } = {}) => envDirect?.find((candidate) => Boolean(candidate)),
        resolveOAuthToken: async () => null,
      } as never);
    expect(await resolve("kdt-test")).toEqual({ token: "kdt-test" });
    expect(await resolve(undefined)).toBeNull();
  });

  it("fetches usage from the user's configured base URL, not the manifest's", async () => {
    const provider = registered();
    const seen: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify(usageBody()), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const snapshot = await provider.fetchUsageSnapshot!({
      config: { models: { providers: { konduit: { baseUrl: "https://gateway.example/v1/" } } } },
      env: {},
      provider: "konduit",
      token: "kdt-test",
      timeoutMs: 1000,
      fetchFn,
    } as never);

    expect(seen).toEqual(["https://gateway.example/v1/usage"]);
    expect(snapshot?.billing).toEqual([{ type: "balance", label: "Available credit", amount: 1, unit: "EUR" }]);
  });
});
