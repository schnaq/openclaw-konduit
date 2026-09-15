// One konduit deployment, as GET /v1/models returns it — the fields this
// generator reads. See services/gateway/internal/catalog/models.go in
// schnaq/konduit for the full body.
export type KonduitModel = {
  id: string;
  display_name: string;
  modality: string;
  context_window: number;
  max_output_tokens: number | null;
  capabilities: { streaming: boolean; tools: boolean; json_mode: boolean };
  pricing: { currency: string; unit: string; input: number; output: number | null };
  deployment: { status: string };
};

// One entry of openclaw.plugin.json's modelCatalog.providers.konduit.models.
export type ManifestModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ["text"];
  contextWindow: number;
  maxTokens: number;
  // OpenClaw labels these USD per million tokens and has no currency field.
  // konduit prices in EUR per million; the numbers go in as they are and the
  // README says what the dollar sign in OpenClaw's session cost really is.
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat: { supportsUsageInStreaming: boolean; supportsTools: boolean; maxTokensField: "max_tokens" };
};

// konduit's own deployment id grammar: a provider slug, a slash, the model
// name, and an optional `:variant`. The model segment stays free-form because
// konduit does not control what characters an upstream model name contains —
// apart from `@`, which is the whole reason this is checked here.
//
// The separator used to be `@` and moved to `:` on 2026-09-11, because enough
// of the ecosystem reads `@` as an instance selector to corrupt an id in
// transit. These ids are written into a manifest that lands in every user's
// OpenClaw config, so shipping the old spelling would plant it where it is
// hardest to take back. The same pattern guards konduit's live canary.
const DEPLOYMENT_ID = /^[a-z0-9-]+\/[^:@]+(:[a-z0-9.-]+)?$/;

const PRICING_UNIT = "micro_eur_per_million_tokens";
const MICRO_PER_UNIT = 1_000_000;
// konduit reports max_output_tokens as null for a deployment whose operator
// publishes no cap. OpenClaw needs a number; this is a conservative one.
const FALLBACK_MAX_TOKENS = 4096;

// konduit serves a deployment while its status is active or deprecated —
// deprecated is discouraged, not switched off, and a user whose config names
// one would find it missing from the catalog if we dropped it. `retired`, and
// any status this generator has not seen, is left out rather than advertised.
const SERVABLE_STATUS = new Set(["active", "deprecated"]);

function isServableChat(model: KonduitModel): boolean {
  return model.modality === "chat" && SERVABLE_STATUS.has(model.deployment.status);
}

/** Servable chat deployments, sorted by id so two runs produce one diff. */
export function mapCatalog(models: KonduitModel[]): ManifestModel[] {
  return models
    .filter(isServableChat)
    .map(mapModel)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The id the manifest should name as its default: the one it already names
 * while konduit still serves it — deprecated included, since it still answers —
 * otherwise the first active deployment in id order, so a fresh manifest never
 * defaults to a model whose operator is winding it down. Empty when konduit
 * serves no chat deployment, which the generator refuses to write anyway.
 */
export function pickDefaultModel(models: KonduitModel[], current: string): string {
  const servable = models.filter(isServableChat).sort((a, b) => a.id.localeCompare(b.id));
  if (servable.some((model) => model.id === current)) return current;
  const active = servable.find((model) => model.deployment.status === "active");
  return (active ?? servable[0])?.id ?? "";
}

export function mapModel(model: KonduitModel): ManifestModel {
  if (!DEPLOYMENT_ID.test(model.id)) {
    throw new Error(`deployment id ${model.id} is not provider/model[:variant]; konduit does not accept '@' anywhere and this catalog will not publish it`);
  }
  if (model.pricing.unit !== PRICING_UNIT) {
    throw new Error(`unexpected pricing unit ${model.pricing.unit} on ${model.id}; this generator understands ${PRICING_UNIT}`);
  }
  const input = model.pricing.input / MICRO_PER_UNIT;
  const output = (model.pricing.output ?? model.pricing.input) / MICRO_PER_UNIT;
  return {
    id: model.id,
    name: model.display_name,
    reasoning: false,
    input: ["text"],
    contextWindow: model.context_window,
    maxTokens: model.max_output_tokens ?? FALLBACK_MAX_TOKENS,
    cost: { input, output, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsUsageInStreaming: model.capabilities.streaming,
      supportsTools: model.capabilities.tools,
      maxTokensField: "max_tokens",
    },
  };
}
