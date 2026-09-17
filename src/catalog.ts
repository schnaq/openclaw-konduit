// The manifest is the source of truth for models and auth; this module is how
// the runtime reads it. It is read with createRequire rather than imported:
// tsc would otherwise pull the root JSON under rootDir and move dist/ around
// it. import.meta.url is dist/catalog.js in production and src/catalog.ts under
// vitest; ../openclaw.plugin.json is the package root from both.
import { createRequire } from "node:module";
import { buildManifestModelProviderConfig } from "openclaw/plugin-sdk/provider-catalog-shared";
import { mapCatalog, type KonduitModel, type ManifestModel } from "./catalog-mapping.js";
import type { ProviderRuntimeModel } from "openclaw/plugin-sdk/plugin-entry";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";

export const PROVIDER_ID = "konduit";


/** The parts of openclaw.plugin.json the runtime and the tests read. */
export type Manifest = {
  id: string;
  providers: string[];
  contracts: { usageProviders: string[] };
  setup: { providers: { id: string; envVars: string[] }[] };
  providerAuthChoices: unknown[];
  modelCatalog: {
    providers: {
      konduit: {
        baseUrl: string;
        api: string;
        defaultModel: string;
        models: ManifestModel[];
      };
    };
    discovery?: Record<string, unknown>;
  };
};

export const manifest = createRequire(import.meta.url)("../openclaw.plugin.json") as Manifest;

const catalog = manifest.modelCatalog.providers.konduit;

/** Where konduit's OpenAI-compatible API lives; a user's configured baseUrl overrides it. */
export const KONDUIT_BASE_URL = catalog.baseUrl;

type ManifestCatalog = Parameters<typeof buildManifestModelProviderConfig>[0]["catalog"];

/** One row of a provider's catalog, as OpenClaw hands it around. */
type CatalogModel = ModelProviderConfig["models"][number];

/** The provider as OpenClaw's catalog wants it. A copy every call; the manifest is never handed out. */
export function buildKonduitProvider(): ModelProviderConfig {
  return {
    baseUrl: KONDUIT_BASE_URL,
    api: "openai-completions",
    models: structuredClone(
      buildManifestModelProviderConfig({ providerId: PROVIDER_ID, catalog: catalog as ManifestCatalog }).models,
    ),
  };
}

/** The manifest's models by id, lowercased, the way OpenClaw compares model ids. */
const modelsById = new Map(buildKonduitProvider().models.map((model) => [model.id.trim().toLowerCase(), model]));

/**
 * One manifest model as a model OpenClaw can route to, or nothing for an id
 * konduit does not serve.
 *
 * OpenClaw reads a plugin's manifest catalog at resolution time only for
 * plugins it ships itself; a plugin installed from ClawHub lives outside that
 * set, so its models are listed but cannot be selected. This hook is the
 * documented way out: the provider answers the lookup itself.
 */
export function resolveKonduitRuntimeModel(params: { modelId: string; baseUrl?: string }): ProviderRuntimeModel | undefined {
  const model = modelsById.get(params.modelId.trim().toLowerCase());
  return model && toKonduitRuntimeModel(model, params.baseUrl);
}

/**
 * One catalog row as a model OpenClaw can route to. A user who pointed
 * models.providers.konduit at another gateway keeps that baseUrl.
 */
export function toKonduitRuntimeModel(model: CatalogModel, baseUrl?: string): ProviderRuntimeModel {
  return {
    ...structuredClone(model),
    provider: PROVIDER_ID,
    api: "openai-completions",
    baseUrl: baseUrl?.trim() || KONDUIT_BASE_URL,
    // The catalog type leaves name, cost, input and the caps optional; every
    // row this plugin projects carries them, static or live.
  } as ProviderRuntimeModel;
}

/**
 * konduit's own GET /v1/models rows as catalog entries — the same projection
 * the manifest generator writes, run at discovery time.
 *
 * OpenClaw's generic mapper reads an OpenAI `/models` body, which carries an id
 * and little else; konduit's carries the context window, the output cap, the
 * capabilities and the price. Handing it the generic reader would list a
 * deployment konduit added with guessed numbers, and would offer konduit's
 * embedding deployment as something to chat with.
 *
 * A row this release cannot read keeps the entry the manifest already has for
 * it, and a body with nothing readable in it leaves the manifest's list alone,
 * because an empty catalog is how a provider disappears from the picker.
 */
export function projectKonduitLiveModels(
  rows: readonly unknown[],
  fallbackModels: readonly CatalogModel[],
): CatalogModel[] {
  const knownById = new Map(fallbackModels.map((model) => [model.id, model]));
  const projected = new Map<string, CatalogModel>();
  for (const row of rows) {
    try {
      // mapCatalog applies the servable-chat predicate, so a retired, embedding
      // or image deployment drops out here rather than in a second copy of it.
      for (const model of mapCatalog([row as KonduitModel])) projected.set(model.id, model);
    } catch {
      const id = typeof (row as { id?: unknown })?.id === "string" ? (row as { id: string }).id : undefined;
      const known = id === undefined ? undefined : knownById.get(id);
      if (known) projected.set(known.id, known);
    }
  }
  if (projected.size === 0) return [...fallbackModels];
  return [...projected.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * What the entry hands OpenClaw's live discovery. Declared here, beside the
 * projection it runs, so it is exercised by the same tests.
 */
export const konduitLiveModelDiscovery = {
  projectRows: (rows: readonly unknown[], fallback: ModelProviderConfig): CatalogModel[] =>
    projectKonduitLiveModels(rows, fallback.models),
};

/**
 * The deployment ids this release lists, for a message that has to name them.
 * A copy: the caller must not be able to edit the manifest through it.
 */
export function listKonduitModelIds(): string[] {
  return [...modelsById.values()].map((model) => model.id);
}

/**
 * The id konduit serves that a user most likely meant. Only one case is worth
 * guessing: a deployment written without its `:variant`, which is the id konduit
 * publishes for a model served in one precision and the spelling a user copies
 * from somewhere else. Anything further from the truth gets the list instead.
 */
export function suggestKonduitModelId(modelId: string): string | undefined {
  const wanted = modelId.trim().toLowerCase();
  if (!wanted || wanted.includes(":")) return;
  return listKonduitModelIds().find((id) => id.toLowerCase().split(":")[0] === wanted);
}
