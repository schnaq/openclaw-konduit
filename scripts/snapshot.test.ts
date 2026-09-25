import { describe, expect, it } from "vitest";
import { projectSnapshot, type CatalogSnapshot } from "./snapshot.js";

function snapshot(overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    models: [
      {
        id: "mistral-small-3.2",
        display_name: "Mistral Small 3.2",
        modality: "chat",
        context_window: 128000,
        max_output_tokens: 4096,
        reasoning: false,
        supports_streaming: true,
        supports_tools: true,
        supports_json_mode: true,
      },
    ],
    deployments: [
      {
        provider_id: "scaleway",
        model_id: "mistral-small-3.2",
        input_price_micro_eur_per_mtok: 150000,
        output_price_micro_eur_per_mtok: 350000,
        status: "active",
      },
    ],
    ...overrides,
  };
}

describe("projectSnapshot", () => {
  it("joins a deployment to its model into konduit's own id and shape", () => {
    const [model] = projectSnapshot(snapshot());
    expect(model).toEqual({
      id: "scaleway/mistral-small-3.2",
      display_name: "Mistral Small 3.2",
      modality: "chat",
      context_window: 128000,
      max_output_tokens: 4096,
      reasoning: false,
      capabilities: { streaming: true, tools: true, json_mode: true },
      pricing: { currency: "EUR", unit: "micro_eur_per_million_tokens", input: 150000, output: 350000 },
      deployment: { status: "active" },
    });
  });

  it("appends :variant only when the deployment names one", () => {
    const withVariant = snapshot({
      deployments: [
        {
          provider_id: "hetzner",
          model_id: "mistral-small-3.2",
          variant: "fp8",
          input_price_micro_eur_per_mtok: 0,
          output_price_micro_eur_per_mtok: 0,
          status: "active",
        },
      ],
    });
    expect(projectSnapshot(withVariant)[0]?.id).toBe("hetzner/mistral-small-3.2:fp8");
  });

  it("prices output as null when the deployment names none, rather than guessing input's price", () => {
    const embedding = snapshot({
      deployments: [
        {
          provider_id: "scaleway",
          model_id: "mistral-small-3.2",
          input_price_micro_eur_per_mtok: 100000,
          status: "active",
        },
      ],
    });
    expect(projectSnapshot(embedding)[0]?.pricing.output).toBeNull();
  });

  it("carries no capabilities.vision for a snapshot older than the field", () => {
    const [model] = projectSnapshot(snapshot());
    expect(model.capabilities).not.toHaveProperty("vision");
  });

  it.each([true, false])("projects supports_vision %s to capabilities.vision", (vision) => {
    const base = snapshot();
    const [model] = projectSnapshot({
      ...base,
      models: base.models.map((m) => ({ ...m, supports_vision: vision })),
    });
    expect(model.capabilities.vision).toBe(vision);
  });

  it("refuses a deployment whose model id the snapshot does not list, rather than writing a shorter manifest silently", () => {
    const orphaned = snapshot({
      deployments: [
        {
          provider_id: "scaleway",
          model_id: "nonexistent",
          input_price_micro_eur_per_mtok: 100000,
          status: "active",
        },
      ],
    });
    expect(() => projectSnapshot(orphaned)).toThrow(/nonexistent/);
  });

  it("projects one entry per deployment, so a model served by two providers appears twice", () => {
    const sharedModel = snapshot({
      deployments: [
        {
          provider_id: "scaleway",
          model_id: "mistral-small-3.2",
          input_price_micro_eur_per_mtok: 150000,
          output_price_micro_eur_per_mtok: 350000,
          status: "active",
        },
        {
          provider_id: "stackit",
          model_id: "mistral-small-3.2",
          input_price_micro_eur_per_mtok: 450000,
          output_price_micro_eur_per_mtok: 650000,
          status: "active",
        },
      ],
    });
    expect(projectSnapshot(sharedModel).map((model) => model.id)).toEqual([
      "scaleway/mistral-small-3.2",
      "stackit/mistral-small-3.2",
    ]);
  });
});
