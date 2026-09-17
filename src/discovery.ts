// konduit's catalog at resolution time. The manifest answers the models a
// release knows; this module answers the ones konduit started serving since —
// so a deployment that shows up in the model list can also be selected, rather
// than listing and then failing with "Unknown model".
import { getCachedLiveCatalogValue } from "openclaw/plugin-sdk/provider-catalog-shared";
import { readProviderJsonResponse } from "openclaw/plugin-sdk/provider-http";
import { fetchJson } from "openclaw/plugin-sdk/provider-usage";
import type { ProviderRuntimeModel } from "openclaw/plugin-sdk/plugin-entry";
import { PROVIDER_ID, projectKonduitLiveModels, toKonduitRuntimeModel } from "./catalog.js";

const LABEL = "konduit model catalog";
// A minute, the same window OpenClaw's own live discovery keeps: long enough
// that a busy session reads the catalog once, short enough that a deployment
// konduit adds is usable while the user is still looking for it.
const TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;

type LiveLookup = {
  modelId: string;
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

/**
 * The deployment konduit serves under this id, or nothing.
 *
 * Nothing is also the answer when konduit refuses the catalog or cannot be
 * reached: a model lookup is not the place to surface that, and the request the
 * user actually made reports it with its own status.
 */
export async function resolveKonduitLiveModel(lookup: LiveLookup): Promise<ProviderRuntimeModel | undefined> {
  const baseUrl = lookup.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl || !lookup.apiKey) return;
  const wanted = lookup.modelId.trim().toLowerCase();
  try {
    const models = await getCachedLiveCatalogValue({
      keyParts: [PROVIDER_ID, "live-models", baseUrl, lookup.apiKey],
      ttlMs: TTL_MS,
      load: async () => await readServableModels(baseUrl, lookup),
      shouldCache: (models) => models.length > 0,
    });
    const model = models.find((candidate) => candidate.id.trim().toLowerCase() === wanted);
    return model && toKonduitRuntimeModel(model, baseUrl);
  } catch {
    return;
  }
}

/** GET {baseUrl}/models, projected the way the manifest generator projects it. */
async function readServableModels(baseUrl: string, lookup: LiveLookup) {
  const response = await fetchJson(
    `${baseUrl}/models`,
    { headers: { Authorization: `Bearer ${lookup.apiKey}`, Accept: "application/json" } },
    lookup.timeoutMs ?? TIMEOUT_MS,
    lookup.fetchFn ?? fetch,
  );
  if (!response.ok) throw new Error(`${LABEL}: HTTP ${response.status}`);
  const body = await readProviderJsonResponse<{ data?: unknown }>(response, LABEL);
  return projectKonduitLiveModels(Array.isArray(body.data) ? body.data : [], []);
}
