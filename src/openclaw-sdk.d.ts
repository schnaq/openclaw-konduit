// openclaw@2026.9.4 ships its plugin SDK as JavaScript without declarations for
// the provider surface. Of the six public subpaths this plugin is allowed to
// use, only `plugin-entry` carries a `types` condition in the package's exports
// map. Under `strict`, tsc answers every other import with TS7016 and the build
// stops. So the declarations live here.
//
// Two rules kept them honest. Where `plugin-entry` already types something, it
// is *derived* from there rather than restated — a second hand-written copy of
// ProviderUsageSnapshot drifts from the one OpenClaw actually checks against,
// and the first draft of this file did exactly that. Where nothing types it,
// the shape is read off the shipped bundle (dist/provider-entry-BeD2ux9P.mjs,
// dist/provider-catalog-2Xpqgcw3.mjs) and kept no wider than this plugin uses.
//
// Delete this file when a release types its own plugin SDK. Nothing else in the
// repository has to change when it does.

declare module "openclaw/plugin-sdk/provider-model-shared" {
  /**
   * What a provider contributes to the catalog: where to call, how, and what it
   * serves. Written out rather than derived — nothing in `plugin-entry` exposes
   * this shape, because the entry helper consumes it and never hands it back.
   */
  export type ModelProviderConfig = {
    baseUrl: string;
    api?: string;
    headers?: Record<string, string>;
    models: { id: string; [key: string]: unknown }[];
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

  /**
   * OpenClaw's process-local cache for live catalog reads, shared with its own
   * discovery so a plugin's lookup and OpenClaw's listing do not each pay for a
   * request. `shouldCache` decides whether a resolved value is kept; a rejected
   * load is never cached.
   */
  export function getCachedLiveCatalogValue<T>(params: {
    keyParts: readonly string[];
    ttlMs?: number;
    load: () => Promise<T>;
    shouldCache?: (value: T) => boolean;
  }): Promise<T>;

  /** Drops that cache. Exported by the SDK for tests and isolated probes. */
  export function clearLiveCatalogCacheForTests(): void;
}

declare module "openclaw/plugin-sdk/provider-usage" {
  import type { ProviderPlugin } from "openclaw/plugin-sdk/plugin-entry";

  /** The card a usage hook answers, as OpenClaw's own hook signature defines it. */
  export type ProviderUsageSnapshot = NonNullable<
    Awaited<ReturnType<NonNullable<ProviderPlugin["fetchUsageSnapshot"]>>>
  >;

  /** One monetary fact on that card. konduit reports the `balance` arm. */
  export type ProviderUsageBilling = NonNullable<ProviderUsageSnapshot["billing"]>[number];

  /** fetch with a timeout signal merged into init.signal. Does not throw on a non-2xx. */
  export function fetchJson(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    fetchFn: typeof fetch,
  ): Promise<Response>;

  /**
   * The card for a provider that could not answer. displayName falls back to the
   * provider id when the SDK knows no label for it, which is konduit's case.
   */
  export function buildUsageErrorSnapshot(provider: string, error: string): ProviderUsageSnapshot;
}

declare module "openclaw/plugin-sdk/provider-http" {
  /**
   * Reads a response body as JSON, bounded, and throws `${label}: malformed JSON
   * response` when it does not parse. The caller decides what that means for the
   * card; nothing about the rejection is written to the snapshot by this call.
   */
  export function readProviderJsonResponse<T>(
    response: Response,
    label: string,
    opts?: { requestHeaders?: Record<string, string> },
  ): Promise<T>;
}

declare module "openclaw/plugin-sdk/provider-entry" {
  import type {
    OpenClawPluginApi,
    OpenClawPluginConfigSchema,
    OpenClawPluginDefinition,
    ProviderPlugin,
  } from "openclaw/plugin-sdk/plugin-entry";
  import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";

  /**
   * The catalog a manifest-backed provider declares. This is not
   * ProviderPluginCatalog: the entry helper accepts either that `run` shape or
   * this one, and builds the `run` itself from these fields. Passing a
   * ProviderPluginCatalog through unchanged is the other arm below.
   */
  export type ManifestBackedCatalog = {
    /** Defaults to building from the manifest's own modelCatalog entry. */
    buildProvider?: () => ModelProviderConfig | Promise<ModelProviderConfig>;
    buildStaticProvider?: () => ModelProviderConfig | Promise<ModelProviderConfig>;
    /** Lets a user's configured models.providers.<id>.baseUrl win over the manifest's. */
    allowExplicitBaseUrl?: boolean;
    /**
     * true to list models from {baseUrl}/models at runtime with OpenClaw's own
     * reader, or the discovery options to read those rows with. `projectRows`
     * receives the parsed `data` array and the catalog OpenClaw would have used
     * without discovery, and answers the models the provider actually serves.
     */
    liveModelDiscovery?:
      | boolean
      | {
          projectRows?: (
            rows: readonly unknown[],
            fallback: ModelProviderConfig,
          ) => ModelProviderConfig["models"];
        };
    discoveryMode?: string;
  };

  /**
   * What a single-provider plugin declares. `provider.id` is optional: the entry
   * falls back to the plugin's own id, which is how this plugin is written.
   */
  export type SingleProviderPluginOptions = {
    id: string;
    name: string;
    description?: string;
    kind?: string;
    configSchema?: OpenClawPluginConfigSchema;
    /** The parsed openclaw.plugin.json. Auth and the model catalog are read from it. */
    manifest?: Record<string, unknown>;
    provider:
      | SingleProviderDeclaration
      | ((api: OpenClawPluginApi) => SingleProviderDeclaration | undefined);
  };

  // `auth` is optional here although ProviderPlugin requires it: the entry
  // derives the provider's auth methods from the manifest's providerAuthChoices
  // when the declaration names none, which is how this plugin declares auth once
  // in openclaw.plugin.json instead of twice.
  type SingleProviderDeclaration = Omit<ProviderPlugin, "id" | "catalog" | "auth"> & {
    id?: string;
    auth?: ProviderPlugin["auth"];
    catalog: ManifestBackedCatalog | ProviderPlugin["catalog"];
  };

  /**
   * Wraps one provider as a plugin entry. Throws at registration when neither
   * the provider's catalog nor the manifest can say what the provider serves.
   */
  export function defineSingleProviderPluginEntry(
    options: SingleProviderPluginOptions,
  ): OpenClawPluginDefinition;
}

declare module "openclaw/plugin-sdk/provider-auth-runtime" {
  import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

  /**
   * The API key OpenClaw holds for a provider, from config, the environment or
   * the auth store — the same lookup its own request path makes. Answers
   * nothing when there is no key, rather than throwing.
   */
  export function resolveApiKeyForProvider(params: {
    provider: string;
    cfg?: OpenClawConfig;
    agentDir?: string;
    workspaceDir?: string;
    profileId?: string;
    lockedProfile?: boolean;
  }): Promise<{ apiKey?: string } | undefined>;
}
