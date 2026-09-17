import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLiveCatalogCacheForTests } from "openclaw/plugin-sdk/provider-catalog-shared";
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

describe("dynamic model resolution", () => {
  it("resolves a listed model, so a ClawHub install can select konduit models", () => {
    const provider = registered();
    const model = provider.resolveDynamicModel!({
      provider: "konduit",
      modelId: "scaleway/gpt-oss-120b",
    } as never);
    expect(model).toMatchObject({ id: "scaleway/gpt-oss-120b", provider: "konduit", api: "openai-completions" });
  });

  it("keeps a baseUrl the user configured for the provider", () => {
    const provider = registered();
    const model = provider.resolveDynamicModel!({
      provider: "konduit",
      modelId: "scaleway/gpt-oss-120b",
      providerConfig: { baseUrl: "https://gateway.example/v1" },
    } as never);
    expect(model?.baseUrl).toBe("https://gateway.example/v1");
  });
});

// The key lives in OpenClaw's auth store, and the hook reads it through the
// SDK rather than being handed it. This is the one seam the plugin cannot
// inject, so it is the one thing these tests replace.
const storedApiKey = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("openclaw/plugin-sdk/provider-auth-runtime", () => ({
  resolveApiKeyForProvider: async () => (storedApiKey.value ? { apiKey: storedApiKey.value } : undefined),
}));

describe("resolving a deployment this release does not list", () => {
  const liveBody = {
    object: "list",
    data: [
      {
        id: "scaleway/brand-new-11b",
        display_name: "Brand New 11B",
        modality: "chat",
        context_window: 64000,
        max_output_tokens: 8192,
        reasoning: false,
        capabilities: { streaming: true, tools: true, json_mode: true },
        pricing: { currency: "EUR", unit: "micro_eur_per_million_tokens", input: 200000, output: 400000 },
        deployment: { status: "active" },
      },
    ],
  };

  function context(modelId: string, baseUrl: string) {
    return { provider: "konduit", modelId, providerConfig: { baseUrl }, config: {} } as never;
  }

  function stubbedCatalog() {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(liveBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    return fetchFn;
  }

  beforeEach(() => {
    clearLiveCatalogCacheForTests();
    storedApiKey.value = "kdt-test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks konduit's catalog for a model the manifest does not have, and routes it", async () => {
    stubbedCatalog();
    const model = await registered().prepareDynamicModel!(context("scaleway/brand-new-11b", "https://gateway-live-1.example/v1"));
    expect(model).toMatchObject({
      id: "scaleway/brand-new-11b",
      provider: "konduit",
      api: "openai-completions",
      baseUrl: "https://gateway-live-1.example/v1",
      contextWindow: 64000,
    });
  });

  it("does not read the catalog for a model the manifest already lists", async () => {
    const fetchFn = stubbedCatalog();
    const model = await registered().prepareDynamicModel!(context("scaleway/gpt-oss-120b", "https://gateway-live-2.example/v1"));
    expect(model).toMatchObject({ id: "scaleway/gpt-oss-120b" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("declines without a key, rather than asking konduit's catalog unauthenticated", async () => {
    const fetchFn = stubbedCatalog();
    storedApiKey.value = undefined;
    const model = await registered().prepareDynamicModel!(context("scaleway/brand-new-11b", "https://gateway-live-3.example/v1"));
    expect(model).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("what OpenClaw says when konduit cannot answer", () => {
  it("names the variant a user forgot, because that is the id konduit actually serves", () => {
    const hint = registered().buildUnknownModelHint!({
      provider: "konduit",
      modelId: "hetzner/qwen3.6-35b-a3b",
      env: {},
    } as never);
    expect(hint).toContain("hetzner/qwen3.6-35b-a3b:fp8");
  });

  it("sends a user with an unknown model to the list konduit serves", () => {
    const hint = registered().buildUnknownModelHint!({
      provider: "konduit",
      modelId: "scaleway/never-existed",
      env: {},
    } as never);
    expect(hint).toContain("openclaw models list --provider konduit");
    expect(hint).not.toContain("models.providers");
  });

  it("says where a konduit key comes from and how to hand it over", () => {
    const message = registered().buildMissingAuthMessage!({
      provider: "konduit",
      env: {},
      listProfileIds: () => [],
    } as never);
    expect(message).toContain("console.konduit.eu");
    expect(message).toContain("openclaw models auth paste-api-key --provider konduit");
    expect(message).toContain("KONDUIT_API_KEY");
  });
});
