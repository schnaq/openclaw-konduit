// Projects a konduit catalogdata snapshot — the source data behind konduit's
// GET /v1/models, committed in the konduit repository at
// services/control-api/internal/catalogdata/snapshots/*.json — into the same
// KonduitModel shape mapCatalog already reads off the live API.
//
// This exists for a maintainer who wants to refresh openclaw.plugin.json
// without a models:read key at hand: `npm run catalog` needs one because the
// live endpoint is authenticated (it carries prices), but konduit's own repo
// checkout has the same numbers in its snapshot, unauthenticated, one clone
// away. `scripts/catalog.ts --snapshot <path>` reads it through this module
// instead of fetching.
//
// The snapshot has no `capabilities.vision` yet — that field is landing in
// konduit's contract separately (see src/catalog-mapping.ts) — so every model
// this projects comes out with `vision` absent, same as an old konduit. That
// is intentional: this script does not guess which deployments see images.
// Once konduit ships the field, `npm run catalog` against the live,
// authenticated API is what turns a vision-capable id like
// `stackit/qwen3-vl-235b-a22b` into `input: ["text", "image"]`.
import type { KonduitModel } from "../src/catalog-mapping.js";

type SnapshotModel = {
  id: string;
  display_name: string;
  modality: string;
  context_window: number;
  max_output_tokens: number | null;
  reasoning: boolean;
  supports_streaming: boolean;
  supports_tools: boolean;
  supports_json_mode: boolean;
};

type SnapshotDeployment = {
  provider_id: string;
  model_id: string;
  variant?: string;
  input_price_micro_eur_per_mtok: number;
  output_price_micro_eur_per_mtok?: number;
  status: string;
};

export type CatalogSnapshot = {
  models: SnapshotModel[];
  deployments: SnapshotDeployment[];
};

// konduit's own id grammar (services/control-api/internal/catalogdata's
// DeploymentID): provider/model, with `:variant` appended only when the
// deployment names one.
function deploymentId(deployment: SnapshotDeployment): string {
  const id = `${deployment.provider_id}/${deployment.model_id}`;
  return deployment.variant ? `${id}:${deployment.variant}` : id;
}

/**
 * One KonduitModel per deployment in the snapshot, in the shape mapCatalog
 * already understands. A deployment naming a model the snapshot does not list
 * is left out — that is a malformed snapshot, not something to guess at.
 */
export function projectSnapshot(snapshot: CatalogSnapshot): KonduitModel[] {
  const modelsById = new Map(snapshot.models.map((model) => [model.id, model]));
  const projected: KonduitModel[] = [];
  for (const deployment of snapshot.deployments) {
    const model = modelsById.get(deployment.model_id);
    if (!model) continue;
    projected.push({
      id: deploymentId(deployment),
      display_name: model.display_name,
      modality: model.modality,
      context_window: model.context_window,
      max_output_tokens: model.max_output_tokens,
      reasoning: model.reasoning,
      capabilities: {
        streaming: model.supports_streaming,
        tools: model.supports_tools,
        json_mode: model.supports_json_mode,
      },
      pricing: {
        currency: "EUR",
        unit: "micro_eur_per_million_tokens",
        input: deployment.input_price_micro_eur_per_mtok,
        output: deployment.output_price_micro_eur_per_mtok ?? null,
      },
      deployment: { status: deployment.status },
    });
  }
  return projected;
}
