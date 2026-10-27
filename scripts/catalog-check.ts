// The `--check` comparison, pure so it is testable without the network.
// The CI key sees only what its organisation may call, so the manifest must be
// a subset of the live list; extra live models are served by runtime discovery.
export function checkSubset(
  manifest: { defaultModel: string; models: { id: string }[] },
  liveIds: Iterable<string>,
): string[] {
  const live = new Set(liveIds);
  const problems: string[] = [];
  const missing = manifest.models.map((m) => m.id).filter((id) => !live.has(id));
  if (missing.length > 0) problems.push(`GET /v1/models no longer lists: ${missing.join(", ")}`);
  if (!manifest.models.some((m) => m.id === manifest.defaultModel)) {
    problems.push(`defaultModel ${manifest.defaultModel} is not among the manifest's models`);
  } else if (!live.has(manifest.defaultModel) && !missing.includes(manifest.defaultModel)) {
    problems.push(`defaultModel ${manifest.defaultModel} is not listed by GET /v1/models`);
  }
  return problems;
}
