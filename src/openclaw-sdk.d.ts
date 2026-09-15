// openclaw@2026.9.4 ships its plugin SDK as JavaScript without declarations for
// the provider surface. Of the six public subpaths this plugin is allowed to
// use, only `plugin-entry` carries a `types` condition in the package's exports
// map, and `buildManifestModelProviderConfig` has no declaration anywhere in the
// package at all. Under `strict`, tsc answers every one of those imports with
// TS7016 and the build stops.
//
// So the declarations live here. They are read off the shipped bundle —
// dist/provider-catalog-2Xpqgcw3.mjs for the function below — rather than
// guessed, and they are deliberately no wider than this plugin uses: a type
// that claims more than it was read from is worse than none.
//
// Delete this file when a release types its own plugin SDK. Nothing else in the
// repository has to change when it does, which is why the declarations are
// module declarations and not a rewritten import.

declare module "openclaw/plugin-sdk/provider-model-shared" {
  /** One model as OpenClaw's catalog holds it. Wider than this in the SDK; this is what the plugin reads back. */
  export type CatalogModel = {
    id: string;
    [key: string]: unknown;
  };

  /** What a provider contributes to the catalog: where to call, how, and what it serves. */
  export type ModelProviderConfig = {
    baseUrl: string;
    api?: string;
    headers?: Record<string, string>;
    models: CatalogModel[];
  };
}

declare module "openclaw/plugin-sdk/provider-catalog-shared" {
  import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";

  /** The manifest's modelCatalog entry for one provider, as the builder reads it. */
  export type ManifestProviderCatalog = {
    baseUrl: string;
    api?: string;
    defaultModel?: string;
    headers?: Record<string, string>;
    models: unknown[];
  };

  /**
   * Projects one manifest catalog into a runtime provider config.
   *
   * Throws when the provider is missing from the catalog, when it names no
   * baseUrl, or when normalisation drops a model — the last of which is how a
   * malformed model entry surfaces, rather than as a silently shorter list.
   */
  export function buildManifestModelProviderConfig(params: {
    providerId: string;
    catalog: ManifestProviderCatalog;
  }): ModelProviderConfig;
}
