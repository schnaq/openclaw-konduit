import { describe, expect, it } from "vitest";
import { mapCatalog, mapModel, type KonduitModel } from "./catalog-mapping.ts";

function item(overrides: Partial<KonduitModel> = {}): KonduitModel {
  return {
    id: "scaleway/mistral-small-3.2:fp8",
    display_name: "Mistral Small 3.2",
    modality: "chat",
    context_window: 128000,
    max_output_tokens: 8192,
    capabilities: { streaming: true, tools: true, json_mode: true },
    pricing: { currency: "EUR", unit: "micro_eur_per_million_tokens", input: 100000, output: 300000 },
    deployment: { status: "active" },
    ...overrides,
  };
}

describe("mapModel", () => {
  it("turns micro-EUR per million into EUR per million, both directions", () => {
    const model = mapModel(item());
    expect(model.cost).toEqual({ input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 });
  });

  it("prices output like input when konduit reports no output price", () => {
    const model = mapModel(item({ pricing: { currency: "EUR", unit: "micro_eur_per_million_tokens", input: 250000, output: null } }));
    expect(model.cost.output).toBe(0.25);
  });

  it("carries id, name, window and output cap", () => {
    const model = mapModel(item());
    expect(model).toMatchObject({
      id: "scaleway/mistral-small-3.2:fp8",
      name: "Mistral Small 3.2",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 8192,
      compat: { supportsUsageInStreaming: true, supportsTools: true, maxTokensField: "max_tokens" },
    });
  });

  it("falls back to a fixed output cap when konduit reports none", () => {
    expect(mapModel(item({ max_output_tokens: null })).maxTokens).toBe(4096);
  });

  it("refuses a pricing unit it does not understand rather than mis-pricing", () => {
    expect(() =>
      mapModel(item({ pricing: { currency: "EUR", unit: "eur_per_token", input: 1, output: 1 } })),
    ).toThrow(/eur_per_token/);
  });
});

describe("mapCatalog", () => {
  it("keeps active chat deployments only, sorted by id", () => {
    const models = mapCatalog([
      item({ id: "z/last" }),
      item({ id: "a/embed", modality: "embedding" }),
      item({ id: "a/retired", deployment: { status: "retired" } }),
      item({ id: "a/first" }),
    ]);
    expect(models.map((model) => model.id)).toEqual(["a/first", "z/last"]);
  });
});
