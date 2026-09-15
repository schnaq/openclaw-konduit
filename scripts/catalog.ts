// Rewrites modelCatalog.providers.konduit in openclaw.plugin.json from
// konduit's own GET /v1/models, so the thirteen-odd entries never drift by
// hand. `--check` exits 1 when the committed manifest is behind; CI runs it.
//
// Needs KONDUIT_API_KEY: the catalog is authenticated (it carries prices).
// A key with only the models:read scope is enough and is what CI holds.
import { readFileSync, writeFileSync } from "node:fs";
import { mapCatalog, type KonduitModel } from "./catalog-mapping.ts";

const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

const check = process.argv.includes("--check");
const apiKey = process.env.KONDUIT_API_KEY;
if (!apiKey) {
  console.error("KONDUIT_API_KEY is not set. A key scoped to models:read is enough.");
  process.exit(2);
}

const current = readFileSync(MANIFEST, "utf8");
const manifest = JSON.parse(current);
const provider = manifest.modelCatalog.providers.konduit;
const baseUrl = String(process.env.KONDUIT_BASE_URL ?? provider.baseUrl).replace(/\/+$/, "");

const response = await fetch(`${baseUrl}/models`, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
});
if (!response.ok) {
  console.error(`GET ${baseUrl}/models answered HTTP ${response.status}`);
  process.exit(2);
}
const body = (await response.json()) as { data: KonduitModel[] };

const models = mapCatalog(body.data);
if (models.length === 0) {
  console.error("konduit returned no active chat deployment; refusing to write an empty catalog");
  process.exit(2);
}
// Keep the default the manifest already names while konduit still serves it;
// otherwise the first deployment in id order. Never empty once there are models.
const defaultModel = models.some((model) => model.id === provider.defaultModel)
  ? provider.defaultModel
  : models[0]!.id;

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
