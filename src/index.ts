// konduit as an OpenClaw provider: European inference over an OpenAI-compatible
// API, plus the two hooks that put the organisation's balance and limits on the
// provider card. Shape follows OpenClaw's bundled extensions/deepseek.
import {
  defineSingleProviderPluginEntry,
  type SingleProviderPluginOptions,
} from "openclaw/plugin-sdk/provider-entry";
import {
  buildKonduitProvider,
  konduitLiveModelDiscovery,
  KONDUIT_BASE_URL,
  listKonduitModelIds,
  manifest,
  PROVIDER_ID,
  resolveKonduitRuntimeModel,
  suggestKonduitModelId,
} from "./catalog.js";
import { resolveKonduitLiveModel } from "./discovery.js";
import { fetchKonduitUsage, resolveBaseUrl } from "./usage.js";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "konduit",
  description: "European AI inference through konduit, with live balance and rate limits.",
  // API-key auth and the model catalog are derived from the manifest, so they
  // are declared once, in openclaw.plugin.json, and the generator keeps them.
  manifest: manifest as unknown as SingleProviderPluginOptions["manifest"],
  provider: {
    label: "konduit",
    docsPath: "/providers/konduit",
    catalog: {
      buildProvider: buildKonduitProvider,
      buildStaticProvider: buildKonduitProvider,
      // A user who configured models.providers.konduit.baseUrl keeps it.
      allowExplicitBaseUrl: true,
      // GET {baseUrl}/models: a deployment konduit adds appears without a plugin
      // release. konduit's catalog carries the context window, the output cap,
      // the capabilities and the price, so the rows are read here rather than
      // by OpenClaw's generic reader, which would only find an id.
      liveModelDiscovery: konduitLiveModelDiscovery,
      discoveryMode: "strict",
    },
    // OpenClaw reads a manifest catalog at model-resolution time only for the
    // plugins it ships itself. Without this hook a ClawHub install lists its
    // models and then fails to select one: "Unknown model: konduit/…".
    resolveDynamicModel: ({ modelId, providerConfig }) =>
      resolveKonduitRuntimeModel({ modelId, ...(providerConfig?.baseUrl ? { baseUrl: providerConfig.baseUrl } : {}) }),
    // The async half of the same answer: a deployment konduit started serving
    // after this release is in konduit's catalog and not in the manifest, and
    // listing it without being able to select it is the bug one level up.
    prepareDynamicModel: async ({ modelId, providerConfig, config, agentDir, workspaceDir, authProfileId }) => {
      const baseUrl = providerConfig?.baseUrl;
      const listed = resolveKonduitRuntimeModel({ modelId, ...(baseUrl ? { baseUrl } : {}) });
      if (listed) return listed;
      // The key lives in OpenClaw's auth store; this is the SDK's way in.
      const { resolveApiKeyForProvider } = await import("openclaw/plugin-sdk/provider-auth-runtime");
      const apiKey = (
        await resolveApiKeyForProvider({
          provider: PROVIDER_ID,
          cfg: config,
          ...(agentDir ? { agentDir } : {}),
          ...(workspaceDir ? { workspaceDir } : {}),
          ...(authProfileId ? { profileId: authProfileId, lockedProfile: true } : {}),
        })
      )?.apiKey;
      if (!apiKey) return;
      return await resolveKonduitLiveModel({
        modelId,
        baseUrl: baseUrl?.trim() || KONDUIT_BASE_URL,
        apiKey,
      });
    },
    // OpenClaw's generic advice for an unknown model is to register it under
    // models.providers, which is not how this plugin is used: konduit publishes
    // its own catalog, so the answer is what konduit serves.
    buildUnknownModelHint: ({ modelId }) => {
      const suggestion = suggestKonduitModelId(modelId);
      const named = suggestion ? `konduit serves that model as "${suggestion}".` : `konduit serves no deployment called "${modelId}".`;
      return `${named} Deployment ids are provider/model[:variant]; \`openclaw models list --provider konduit\` lists the ${listKonduitModelIds().length} this release knows, and konduit's own catalog is read at runtime for the rest.`;
    },
    buildMissingAuthMessage: () =>
      'Mint a konduit API key at https://console.konduit.eu, then run `openclaw models auth paste-api-key --provider konduit` — or set KONDUIT_API_KEY. A key with no scopes works; the provider card also needs `usage:read`.',
    // Both hooks are required for OpenClaw to poll this provider's usage at
    // all; a plugin with only fetchUsageSnapshot is not auto-discovered.
    resolveUsageAuth: async (ctx) => {
      const token = ctx.resolveApiKeyFromConfigAndStore({ envDirect: [ctx.env.KONDUIT_API_KEY] });
      return token ? { token } : null;
    },
    fetchUsageSnapshot: async (ctx) =>
      await fetchKonduitUsage(resolveBaseUrl(ctx.config), ctx.token, ctx.timeoutMs, ctx.fetchFn),
  },
});
