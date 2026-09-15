import { describe, expect, it } from "vitest";
import { buildKonduitProvider, KONDUIT_BASE_URL, manifest, PROVIDER_ID } from "./catalog.js";

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
