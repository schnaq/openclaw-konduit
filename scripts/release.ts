// Cuts a release: one version into both files that carry it, the full check
// suite, a commit and a tag. Pushing the tag is what releases — `release.yml`
// publishes to npm and `clawhub-publish.yml` to ClawHub, both on `v*`.
//
//   node scripts/release.ts 0.2.0                  # rehearse, change nothing
//   node scripts/release.ts 0.2.0 --release        # bump, commit, tag, push
//   node scripts/release.ts 0.2.0 --local-publish  # …and upload from here
//
// `--local-publish` exists for a registry CI cannot reach yet: it publishes
// from this machine and still pushes the tag, and both workflows skip a
// version their registry already has, so the tag lands green either way.
// ClawHub records a manual publish as an override of the trusted publisher,
// with the reason below; npm gets no provenance that way. Prefer the tag.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PACKAGE = new URL("../package.json", import.meta.url);
const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);
const NPM_NAME = "@konduiteu/openclaw";
const REPO = "schnaq/openclaw-konduit";
const RELEASE_BRANCH = "main";
const SEMVER = /^\d+\.\d+\.\d+(-[0-9a-z.-]+)?$/i;
const MANUAL_REASON =
  "Released from a maintainer machine while the repository has no npm publishing credential; the tag workflow cannot upload.";

const args = process.argv.slice(2);
const version = args.find((arg) => !arg.startsWith("--"));
const localPublish = args.includes("--local-publish");
const release = localPublish || args.includes("--release");
const skipCatalog = args.includes("--skip-catalog");

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function step(message: string) {
  console.log(`\n▸ ${message}`);
}

function run(command: string, commandArgs: string[]) {
  execFileSync(command, commandArgs, { encoding: "utf8", stdio: "inherit" });
}

function capture(command: string, commandArgs: string[]): string {
  return execFileSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

if (!version || !SEMVER.test(version)) {
  fail("Usage: node scripts/release.ts <version> [--release | --local-publish] [--skip-catalog]");
}

const pkg = JSON.parse(readFileSync(PACKAGE, "utf8"));
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const tag = `v${version}`;

// ── Preflight ──────────────────────────────────────────────────────────────
// Everything that can say no before a single file is written.
step(`Preflight for ${NPM_NAME}@${version}`);

if (pkg.version !== manifest.version) {
  fail(`package.json says ${pkg.version} and openclaw.plugin.json says ${manifest.version}; reconcile them first`);
}
if (pkg.version === version) fail(`${version} is already the version in the working tree`);
console.log(`  ${pkg.version} → ${version}`);

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== RELEASE_BRANCH) fail(`on branch ${branch}; releases are cut from ${RELEASE_BRANCH}`);

const dirty = capture("git", ["status", "--porcelain"]);
if (dirty) fail(`uncommitted changes:\n${dirty}\nA release publishes what is committed.`);

run("git", ["fetch", "origin", RELEASE_BRANCH, "--tags", "--quiet"]);
if (capture("git", ["rev-list", "--count", `HEAD..origin/${RELEASE_BRANCH}`]) !== "0") {
  fail(`origin/${RELEASE_BRANCH} has commits this branch does not; pull first`);
}
if (capture("git", ["tag", "--list", tag])) fail(`tag ${tag} already exists`);

if (JSON.parse(capture("npm", ["view", NPM_NAME, "versions", "--json"]) || "[]").includes(version)) {
  fail(`npm already has ${NPM_NAME}@${version}, and npm never replaces a version`);
}

if (localPublish) {
  console.log(`  npm: ${capture("npm", ["whoami"])}`);
  if (!capture("npx", ["clawhub", "token"])) fail("no ClawHub token; run `clawhub login`");
  console.log("  clawhub: token present");
}

// ── Version ────────────────────────────────────────────────────────────────
// OpenClaw reads the manifest's version and npm reads package.json's, so the
// two move together or the release workflow refuses the tag.
step("Writing the version");
writeFileSync(PACKAGE, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
console.log("  package.json, openclaw.plugin.json");

// ── Checks ─────────────────────────────────────────────────────────────────
// What CI runs on the tag, run before the tag exists.
step("Checks");
run("npm", ["run", "typecheck"]);
run("npm", ["test"]);
run("npm", ["run", "build"]);
if (skipCatalog || !process.env.KONDUIT_API_KEY) {
  console.log(`  ⚠ catalog:check skipped (${skipCatalog ? "--skip-catalog" : "no KONDUIT_API_KEY"}); the tag workflow runs it with the repository secret`);
} else {
  run("npm", ["run", "catalog:check"]);
}
run("npm", ["pack", "--dry-run"]);

// ── Commit and tag ─────────────────────────────────────────────────────────
step(release ? "Commit and tag" : "Commit and tag (skipped)");
if (release) {
  run("git", ["add", "package.json", "openclaw.plugin.json"]);
  run("git", ["commit", "-m", `chore(release): ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", `${NPM_NAME}@${version}`]);
  console.log(`  ${capture("git", ["log", "--oneline", "-1"])}`);
} else {
  console.log("  the version bump is in the working tree; `git checkout package.json openclaw.plugin.json` undoes it");
}

// ── Publish ────────────────────────────────────────────────────────────────
step(localPublish ? "Publishing from here" : "Publishing (left to the tag)");
if (localPublish) {
  run("npm", ["publish", "--access", "public"]);
  run("npx", [
    "clawhub",
    "package",
    "publish",
    ".",
    "--version",
    version,
    "--source-repo",
    REPO,
    "--source-commit",
    capture("git", ["rev-parse", "HEAD"]),
    "--source-ref",
    tag,
    "--manual-override-reason",
    MANUAL_REASON,
    "--wait",
  ]);
} else if (release) {
  console.log("  release.yml publishes to npm, clawhub-publish.yml to ClawHub, once the tag is pushed");
} else {
  run("npm", ["publish", "--access", "public", "--dry-run"]);
}

// ── Push ───────────────────────────────────────────────────────────────────
step(release ? "Pushing" : "Push (skipped)");
if (release) {
  run("git", ["push", "origin", RELEASE_BRANCH]);
  run("git", ["push", "origin", tag]);
} else {
  console.log(`  nothing to push`);
}

console.log(
  `\n✓ ${release ? `${tag} pushed` : `${version} rehearsed; nothing was committed or uploaded`}${localPublish ? " and published" : ""}`,
);
