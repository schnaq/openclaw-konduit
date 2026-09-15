// konduit as an OpenClaw provider: European inference over an OpenAI-compatible
// API, plus the two hooks that put the organisation's balance and limits on the
// provider card. Shape follows OpenClaw's bundled extensions/deepseek.
import {
  defineSingleProviderPluginEntry,
  type SingleProviderPluginOptions,
} from "openclaw/plugin-sdk/provider-entry";
import { buildKonduitProvider, manifest, PROVIDER_ID } from "./catalog.js";
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
      // release, at cost zero until the generator writes its price.
      liveModelDiscovery: true,
      discoveryMode: "strict",
    },
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
