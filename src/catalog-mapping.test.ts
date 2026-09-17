import { describe, expect, it } from "vitest";
import { mapCatalog, mapModel, pickDefaultModel, type KonduitModel } from "./catalog-mapping.js";

function item(overrides: Partial<KonduitModel> = {}): KonduitModel {
  return {
    id: "scaleway/mistral-small-3.2:fp8",
    display_name: "Mistral Small 3.2",
    modality: "chat",
    context_window: 128000,
    max_output_tokens: 8192,
    reasoning: false,
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

  it("says a model reasons when konduit says it does, rather than guessing", () => {
    expect(mapModel(item({ reasoning: true })).reasoning).toBe(true);
    expect(mapModel(item({ reasoning: false })).reasoning).toBe(false);
  });

  it("falls back to a fixed output cap when konduit reports none", () => {
    expect(mapModel(item({ max_output_tokens: null })).maxTokens).toBe(4096);
  });

  it("refuses an id spelled with the separator konduit moved away from", () => {
    expect(() => mapModel(item({ id: "hetzner/qwen3.6-35b-a3b@fp8" }))).toThrow(/@/);
  });

  it("accepts both shapes konduit's own grammar allows", () => {
    expect(mapModel(item({ id: "hetzner/qwen3.8-27b" })).id).toBe("hetzner/qwen3.8-27b");
    expect(mapModel(item({ id: "scaleway/mistral-small-3.2:fp8" })).id).toBe("scaleway/mistral-small-3.2:fp8");
  });

  it("refuses a pricing unit it does not understand rather than mis-pricing", () => {
    expect(() =>
      mapModel(item({ pricing: { currency: "EUR", unit: "eur_per_token", input: 1, output: 1 } })),
    ).toThrow(/eur_per_token/);
  });
});

describe("mapCatalog", () => {
  it("keeps every chat deployment konduit still serves, sorted by id", () => {
    const models = mapCatalog([
      item({ id: "z/last" }),
      item({ id: "a/embed", modality: "embedding" }),
      item({ id: "a/retired", deployment: { status: "retired" } }),
      item({ id: "a/deprecated", deployment: { status: "deprecated" } }),
      item({ id: "a/first" }),
    ]);
    expect(models.map((model) => model.id)).toEqual(["a/deprecated", "a/first", "z/last"]);
  });

  it("drops a status it has never heard of rather than advertising it", () => {
    expect(mapCatalog([item({ id: "a/odd", deployment: { status: "draining" } })])).toEqual([]);
  });
});

describe("pickDefaultModel", () => {
  it("keeps the default the manifest already names while konduit still serves it", () => {
    const items = [item({ id: "a/first" }), item({ id: "z/last" })];
    expect(pickDefaultModel(items, "z/last")).toBe("z/last");
  });

  it("keeps a deprecated default, because deprecated still answers", () => {
    const items = [item({ id: "a/first" }), item({ id: "z/old", deployment: { status: "deprecated" } })];
    expect(pickDefaultModel(items, "z/old")).toBe("z/old");
  });

  it("prefers an active deployment when it has to choose a new default", () => {
    const items = [item({ id: "a/old", deployment: { status: "deprecated" } }), item({ id: "z/fresh" })];
    expect(pickDefaultModel(items, "gone/away")).toBe("z/fresh");
  });

  it("takes the first servable deployment when none is active", () => {
    const items = [
      item({ id: "z/old", deployment: { status: "deprecated" } }),
      item({ id: "a/older", deployment: { status: "deprecated" } }),
    ];
    expect(pickDefaultModel(items, "")).toBe("a/older");
  });

  it("returns nothing when konduit serves no chat deployment at all", () => {
    expect(pickDefaultModel([item({ modality: "embedding" })], "")).toBe("");
  });
});
