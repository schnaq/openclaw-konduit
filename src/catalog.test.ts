import { describe, expect, it } from "vitest";
import {
  buildKonduitProvider,
  KONDUIT_BASE_URL,
  manifest,
  PROVIDER_ID,
  konduitLiveModelDiscovery,
  projectKonduitLiveModels,
  resolveKonduitRuntimeModel,
} from "./catalog.js";

describe("the manifest", () => {
  it("declares the provider, the usage contract and the key variable", () => {
    expect(manifest.providers).toEqual([PROVIDER_ID]);
    expect(manifest.contracts.usageProviders).toEqual([PROVIDER_ID]);
    expect(manifest.setup.providers[0]).toMatchObject({ id: PROVIDER_ID, envVars: ["KONDUIT_API_KEY"] });
  });

  it("names a default model it also lists", () => {
    const catalog = manifest.modelCatalog.providers.konduit;
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models.map((model) => model.id)).toContain(catalog.defaultModel);
  });
});

describe("buildKonduitProvider", () => {
  it("serves the manifest's models over konduit's OpenAI-compatible base URL", () => {
    const provider = buildKonduitProvider();
    expect(provider.baseUrl).toBe(KONDUIT_BASE_URL);
    expect(KONDUIT_BASE_URL).toBe("https://api.konduit.eu/v1");
    expect(provider.api).toBe("openai-completions");
    expect(provider.models.map((model) => model.id)).toEqual(
      manifest.modelCatalog.providers.konduit.models.map((model) => model.id),
    );
  });

  it("returns a fresh copy each time, so a caller mutating one does not edit the manifest", () => {
    const first = buildKonduitProvider();
    const second = buildKonduitProvider();
    expect(first.models).not.toBe(second.models);
    expect(first.models).toEqual(second.models);
  });
});

describe("resolveKonduitRuntimeModel", () => {
  const defaultModel = manifest.modelCatalog.providers.konduit.defaultModel;

  it("resolves a listed model into a model OpenClaw can route", () => {
    const model = resolveKonduitRuntimeModel({ modelId: defaultModel });
    const listed = manifest.modelCatalog.providers.konduit.models.find((entry) => entry.id === defaultModel)!;
    expect(model).toMatchObject({
      id: defaultModel,
      provider: PROVIDER_ID,
      api: "openai-completions",
      baseUrl: KONDUIT_BASE_URL,
      contextWindow: listed.contextWindow,
      maxTokens: listed.maxTokens,
    });
  });

  it("declines a model konduit does not serve", () => {
    expect(resolveKonduitRuntimeModel({ modelId: "scaleway/not-a-deployment" })).toBeUndefined();
  });

  it("routes through a baseUrl the user configured, never the manifest's", () => {
    const model = resolveKonduitRuntimeModel({ modelId: defaultModel, baseUrl: "https://gateway.example/v1" });
    expect(model?.baseUrl).toBe("https://gateway.example/v1");
  });

  it("matches a model id the way OpenClaw compares them, ignoring case and padding", () => {
    expect(resolveKonduitRuntimeModel({ modelId: `  ${defaultModel.toUpperCase()}  ` })?.id).toBe(defaultModel);
  });
});

describe("projectKonduitLiveModels", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
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
  });

  it("carries konduit's own metadata into the catalog, not OpenClaw's guesses", () => {
    const [model] = projectKonduitLiveModels([row()], []);
    expect(model).toMatchObject({
      id: "scaleway/brand-new-11b",
      name: "Brand New 11B",
      contextWindow: 64000,
      maxTokens: 8192,
      cost: { input: 0.2, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsUsageInStreaming: true, supportsTools: true, maxTokensField: "max_tokens" },
    });
  });

  it("leaves out a deployment that does not serve chat, so an embedding model stays out of the model picker", () => {
    const models = projectKonduitLiveModels([row({ id: "scaleway/bge-multilingual-gemma2", modality: "embedding" })], []);
    expect(models).toEqual([]);
  });

  it("keeps a deprecated deployment and leaves out a retired one", () => {
    const models = projectKonduitLiveModels(
      [
        row({ id: "scaleway/winding-down", deployment: { status: "deprecated" } }),
        row({ id: "scaleway/switched-off", deployment: { status: "retired" } }),
      ],
      [],
    );
    expect(models.map((model) => model.id)).toEqual(["scaleway/winding-down"]);
  });

  it("keeps the manifest's entry for a row it cannot read, rather than dropping the model", () => {
    const fallback = buildKonduitProvider().models;
    const known = fallback.find((model) => model.id === "scaleway/gpt-oss-120b")!;
    const models = projectKonduitLiveModels(
      [row({ id: "scaleway/gpt-oss-120b", pricing: { currency: "EUR", unit: "eur_per_token", input: 1, output: 2 } })],
      fallback,
    );
    expect(models).toEqual([known]);
  });

  it("falls back to the manifest when konduit answers nothing this plugin can read", () => {
    const fallback = buildKonduitProvider().models;
    expect(projectKonduitLiveModels([{ nonsense: true }], fallback)).toEqual(fallback);
  });
});

describe("konduitLiveModelDiscovery", () => {
  it("reads the rows konduit answers with konduit's own projection", () => {
    const models = konduitLiveModelDiscovery.projectRows(
      [
        {
          id: "scaleway/brand-new-11b",
          display_name: "Brand New 11B",
          modality: "chat",
          context_window: 64000,
          max_output_tokens: 8192,
          capabilities: { streaming: true, tools: false, json_mode: true },
          pricing: { currency: "EUR", unit: "micro_eur_per_million_tokens", input: 200000, output: 400000 },
          deployment: { status: "active" },
        },
      ],
      { baseUrl: KONDUIT_BASE_URL, models: [] },
    );
    expect(models).toEqual([
      expect.objectContaining({ id: "scaleway/brand-new-11b", contextWindow: 64000, maxTokens: 8192 }),
    ]);
  });

  it("hands back the catalog OpenClaw would have used when konduit answers nothing readable", () => {
    const fallback = buildKonduitProvider();
    expect(konduitLiveModelDiscovery.projectRows([{ nonsense: true }], fallback)).toEqual(fallback.models);
  });
});
