// Rewrites modelCatalog.providers.konduit in openclaw.plugin.json from
// konduit's own GET /v1/models, so the two dozen-odd entries never drift by
// hand. `--check` exits 1 when the committed manifest is behind; CI runs it.
//
// Needs KONDUIT_API_KEY: the catalog is authenticated (it carries prices).
// A key with only the models:read scope is enough and is what CI holds.
//
// `--snapshot <path>` reads konduit's own catalogdata snapshot instead of
// calling the live API — for a maintainer refreshing the list without a key
// at hand. It carries no price authentication because it is not the live
// catalog: it is konduit's source data, read from a checkout of the konduit
// repository (services/control-api/internal/catalogdata/snapshots/*.json).
// `--check` refuses to combine with it, because "matches the snapshot" is not
// the claim CI needs — CI needs "matches what konduit currently serves".
import { readFileSync, writeFileSync } from "node:fs";
import { mapCatalog, pickDefaultModel, type KonduitModel } from "../src/catalog-mapping.ts";
import { projectSnapshot, type CatalogSnapshot } from "./snapshot.ts";

const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

const check = process.argv.includes("--check");
const snapshotIndex = process.argv.indexOf("--snapshot");
const snapshotPath = snapshotIndex === -1 ? undefined : process.argv[snapshotIndex + 1];

if (snapshotIndex !== -1 && !snapshotPath) {
  console.error("--snapshot needs a path to a konduit catalogdata snapshot json file.");
  process.exit(2);
}
if (snapshotPath && check) {
  console.error("--check reads the live catalog to prove CI matches what konduit serves; it does not take --snapshot.");
  process.exit(2);
}

const current = readFileSync(MANIFEST, "utf8");
const manifest = JSON.parse(current);
const provider = manifest.modelCatalog.providers.konduit;

let sourceModels: KonduitModel[];
if (snapshotPath) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as CatalogSnapshot;
  sourceModels = projectSnapshot(snapshot);
  console.log(`read ${sourceModels.length} deployments from ${snapshotPath}`);
} else {
  const apiKey = process.env.KONDUIT_API_KEY;
  if (!apiKey) {
    console.error("KONDUIT_API_KEY is not set. A key scoped to models:read is enough, or pass --snapshot <path>.");
    process.exit(2);
  }
  const baseUrl = String(process.env.KONDUIT_BASE_URL ?? provider.baseUrl).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) {
    console.error(`GET ${baseUrl}/models answered HTTP ${response.status}`);
    process.exit(2);
  }
  const body = (await response.json()) as { data: KonduitModel[] };
  sourceModels = body.data;
}

const models = mapCatalog(sourceModels);
if (models.length === 0) {
  console.error("konduit returned no active chat deployment; refusing to write an empty catalog");
  process.exit(2);
}
// Keep the default the manifest already names while konduit still serves it;
// otherwise the first active deployment. Never empty once there are models.
const defaultModel = pickDefaultModel(sourceModels, provider.defaultModel);
// mapCatalog and pickDefaultModel apply the same servable-chat predicate in two
// places. They agree today; this catches the day one of them is changed alone,
// because a default OpenClaw cannot find in the list is a broken manifest.
if (!models.some((model) => model.id === defaultModel)) {
  console.error(`default ${defaultModel} is not among the ${models.length} models written; refusing to write an inconsistent manifest`);
  process.exit(2);
}

const next = {
  ...manifest,
  modelCatalog: {
    ...manifest.modelCatalog,
    providers: {
      ...manifest.modelCatalog.providers,
      konduit: { ...provider, defaultModel, models },
    },
  },
};
const rendered = `${JSON.stringify(next, null, 2)}\n`;

if (check) {
  if (rendered !== current) {
    console.error("openclaw.plugin.json is behind GET /v1/models. Run `npm run catalog` and commit.");
    process.exit(1);
  }
  console.log(`openclaw.plugin.json matches ${models.length} deployments`);
} else {
  writeFileSync(MANIFEST, rendered);
  console.log(`wrote ${models.length} deployments to openclaw.plugin.json (default ${defaultModel})`);
}
