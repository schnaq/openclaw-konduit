import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLiveCatalogCacheForTests } from "openclaw/plugin-sdk/provider-catalog-shared";
import { resolveKonduitLiveModel } from "./discovery.js";

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "scaleway/brand-new-11b",
    display_name: "Brand New 11B",
    modality: "chat",
    context_window: 64000,
    max_output_tokens: 8192,
    reasoning: false,
    capabilities: { streaming: true, tools: true, json_mode: true },
    pricing: { currency: "EUR", unit: "micro_eur_per_million_tokens", input: 200000, output: 400000 },
    deployment: { status: "active" },
    ...overrides,
  };
}

function answering(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

// Each test gets its own base URL: the live catalog is cached per endpoint, and
// a shared one would let one test answer another's lookup.
let endpoints = 0;
function baseUrl() {
  endpoints += 1;
  return `https://gateway-${endpoints}.example/v1`;
}

beforeEach(() => {
  clearLiveCatalogCacheForTests();
});

describe("resolveKonduitLiveModel", () => {
  it("answers a deployment konduit serves but this release does not list, with konduit's own metadata", async () => {
    const fetchFn = answering({ object: "list", data: [deployment()] });
    const model = await resolveKonduitLiveModel({
      modelId: "scaleway/brand-new-11b",
      baseUrl: baseUrl(),
      apiKey: "kdt-test",
      fetchFn,
    });
    expect(model).toMatchObject({
      id: "scaleway/brand-new-11b",
      contextWindow: 64000,
      maxTokens: 8192,
      cost: { input: 0.2, output: 0.4, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("sends the key konduit's catalog requires", async () => {
    const fetchFn = answering({ object: "list", data: [deployment()] });
    const url = baseUrl();
    await resolveKonduitLiveModel({ modelId: "scaleway/brand-new-11b", baseUrl: url, apiKey: "kdt-test", fetchFn });
    const [requested, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(requested).toBe(`${url}/models`);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer kdt-test");
  });

  it("declines a model konduit does not serve", async () => {
    const fetchFn = answering({ object: "list", data: [deployment()] });
    const model = await resolveKonduitLiveModel({
      modelId: "scaleway/never-existed",
      baseUrl: baseUrl(),
      apiKey: "kdt-test",
      fetchFn,
    });
    expect(model).toBeUndefined();
  });

  it("declines a deployment that does not serve chat", async () => {
    const fetchFn = answering({
      object: "list",
      data: [deployment({ id: "scaleway/bge-multilingual-gemma2", modality: "embedding" })],
    });
    const model = await resolveKonduitLiveModel({
      modelId: "scaleway/bge-multilingual-gemma2",
      baseUrl: baseUrl(),
      apiKey: "kdt-test",
      fetchFn,
    });
    expect(model).toBeUndefined();
  });

  it("reads konduit's catalog once for repeated lookups, so resolution does not cost a request per turn", async () => {
    const fetchFn = answering({ object: "list", data: [deployment()] });
    const url = baseUrl();
    await resolveKonduitLiveModel({ modelId: "scaleway/brand-new-11b", baseUrl: url, apiKey: "kdt-test", fetchFn });
    await resolveKonduitLiveModel({ modelId: "scaleway/brand-new-11b", baseUrl: url, apiKey: "kdt-test", fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("declines quietly when konduit refuses the catalog, leaving the error to the caller's own path", async () => {
    const fetchFn = answering({ error: { message: "the API key is not valid", code: "invalid_api_key" } }, 401);
    const model = await resolveKonduitLiveModel({
      modelId: "scaleway/brand-new-11b",
      baseUrl: baseUrl(),
      apiKey: "kdt-wrong",
      fetchFn,
    });
    expect(model).toBeUndefined();
  });
});
