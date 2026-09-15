// The manifest is the source of truth for models and auth; this module is how
// the runtime reads it. It is read with createRequire rather than imported:
// tsc would otherwise pull the root JSON under rootDir and move dist/ around
// it. import.meta.url is dist/catalog.js in production and src/catalog.ts under
// vitest; ../openclaw.plugin.json is the package root from both.
import { createRequire } from "node:module";
import { buildManifestModelProviderConfig } from "openclaw/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";

export const PROVIDER_ID = "konduit";

type ManifestModel = { id: string; name: string; [key: string]: unknown };

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
