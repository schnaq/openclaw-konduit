# konduit for OpenClaw

European AI inference through [konduit](https://konduit.eu) as an OpenClaw
provider, with the organisation's live credit balance and rate limits on the
provider card.

## Install

```sh
openclaw plugins install clawhub:@konduiteu/openclaw
openclaw plugins enable konduit
```

or from npm, which asks you to confirm the source:

```sh
openclaw plugins install npm:@konduiteu/openclaw
```

Set `KONDUIT_API_KEY` to a key minted in the [konduit console](https://console.konduit.eu),
or run `openclaw onboard --konduit-api-key kdt-…`. A key created without any
scopes is unrestricted and works as it is. A key that carries scopes needs:

| Scope | What stops working without it |
| --- | --- |
| `chat:write` | inference — `POST /v1/chat/completions` |
| `models:read` | the live model list. The plugin reads konduit's catalog when OpenClaw refreshes its model list and when it resolves a model it does not list; without this scope a refresh fails and you are left with the models your config names |
| `usage:read` | the balance and the limits on the provider card, nothing else |

konduit's scopes are a flat allowlist, so `chat:write` does not imply
`models:read`; a scoped key is refused on every route it does not name.

If you had configured konduit by hand under `models.providers.konduit`, keep
it: OpenClaw merges your entries with the plugin's by model id, and your
`baseUrl` wins.

**A failed connection test does not mean konduit is unreachable.** OpenClaw
probes a provider by asking the configured model for a reply worth eight output
tokens. A deployment that reasons spends them on reasoning and returns no
visible text, and the probe reads that as a failure — konduit answered `200`.
Many of the chat deployments reason, the default `scaleway/gpt-oss-120b`
among them, so a fresh install is likely to show it. Ask the model something
instead; that is the test that counts:

```sh
openclaw agent --model konduit/scaleway/gpt-oss-120b --message "say OK"
```

## What the card shows

- **Available credit** — the organisation's `available_micro_eur`, in EUR.
  Every key of an organisation sees the same wallet; it is the number that
  explains a `402`.
- **Summary** — an open reservation if there is one, then the rate limits the
  key is actually held to: its own, and its organisation's (or konduit's
  deployment default where the organisation set none). `60 RPM · 100K TPM
  (key) · 1M TPM (organisation)`. A limit that is not configured is left out.
- Errors name their cause: a rejected key, a key without `usage:read`, a
  rate limit, or konduit's ledger being unavailable.

OpenClaw caches a snapshot for a minute and refreshes when you look, so the
card costs one request a minute against your key's rate limit while it is
open.

## Models and prices

`openclaw.plugin.json` lists every chat deployment konduit still serves, with
context window, output cap and price, generated from `GET /v1/models`:

```sh
KONDUIT_API_KEY=kdt-… npm run catalog
```

The catalog is authenticated because it carries prices, so this needs a key
with `models:read` — and nothing else. That is the scope the repository's
`KONDUIT_API_KEY` secret carries, and all `catalog:check` in CI asks for.

Without a key, `npm run catalog -- --snapshot <path>` reads konduit's own
catalogdata snapshot instead (a checkout of the konduit repository,
`services/control-api/internal/catalogdata/snapshots/*.json`) and writes the
same manifest shape from it — whatever that checkout's snapshot says, which
may be ahead of what is deployed (an unreleased snapshot) or behind it (a
stale checkout); it is not a substitute for `catalog:check` against the live
API. It also cannot see a `capabilities.vision` the snapshot has no field for
yet even if the live API already does (see "input" below).

That includes deployments konduit marks `deprecated`: the status discourages
them, it does not switch them off, and a model you already have in your config
should not vanish from the list because of a label. Only `retired` deployments
are left out. The default model is never a deprecated one.

CI checks the committed list against the live catalog, but the committed list
is only the offline seed. When OpenClaw refreshes its model list, the plugin
reads konduit's catalog with the same projection the generator uses, and what
konduit answers wins — for every model, not just new ones: name, `input`,
context window, output cap, reasoning and price. A deployment konduit adds
appears before the next release and can be selected right away; a model
konduit starts serving images for shows `text+image` after the next refresh.
Deployments that do not serve chat — the embedding ones — stay out of the
model list rather than being offered as something to talk to.

The manifest declares the catalog `"runtime"` for that reason. OpenClaw lays
the manifest rows of a `"refreshable"` or `"static"` provider over whatever
discovery returns for the same id, so under 0.3.0 a refresh could add models
but never correct one the release already listed.

Each model's `input` is `["text", "image"]` when konduit's catalog says
`capabilities.vision: true`, and `["text"]` otherwise — including while
konduit has not shipped that field yet, which is also how an older konduit
reads today. Nothing here guesses.

### After `plugins update`, and after any Gateway restart

Refresh the list once:

```sh
openclaw models list --provider konduit --refresh
```

(or press Refresh in the Control UI's model picker). Until you do, `openclaw
models list` shows only the konduit models your config names — typically just
the default. That is OpenClaw 2026.9.4, not the plugin, and no plugin setting
changes it:

- The Gateway starts with a static catalog pass and does not run provider
  discovery on startup; ordinary `models list` and the picker never start it
  either. Only an explicit refresh does.
- The inventory a refresh discovers lives in the Gateway's memory. For a
  provider installed from ClawHub it is not written to the on-disk catalog
  cache, so every restart — including the automatic one after `openclaw plugins
  update` — starts without it.

Every konduit model stays selectable in the meantime (`/model
konduit/<id>`); it is only missing from the list. OpenClaw also has no periodic
provider refresh; the plugin's own one-minute cache only spares konduit
repeated requests during one refresh or model lookup.

### `Trust: reason=provenance-invalid`

`openclaw plugins inspect konduit` reports `provenance-invalid` for every
install from ClawHub, and a reinstall does not change it. OpenClaw reserves
`trusted-official` for packages in its own official external plugin catalog,
installed from ClawHub's `official` channel; konduit is published to the
`community` channel, and OpenClaw files every community install under
`provenance-invalid`. It gates only runtime APIs OpenClaw keeps for trusted
plugins, none of which this plugin uses. The install notice `Plugin manifest id
"konduit" differs from npm package name "@konduiteu/openclaw"` is informational:
the manifest id is the config key, which is why the plugin is `konduit` in your
config.

**One caveat.** OpenClaw prices models in US dollars per million tokens and
has no currency field. konduit prices in euros; the euro figures are stored
in those fields, so OpenClaw's local *session cost* shows a dollar sign over
euro-denominated numbers. The balance on the card is not affected: it comes
from konduit and is formatted as EUR.

The two Hetzner deployments are listed at zero. That is a recorded price, not
a missing one: Hetzner's Inference API is free of charge while it stays
experimental.

## The contract

The plugin reads `GET /v1/usage`, described in the konduit repository's
`docs/openapi/gateway.yaml`. The plugin pins the API it was written against,
not a konduit commit.

Model ids are `provider/model` or `provider/model:variant`. The separator used
to be `@` and the plugin refuses to publish that spelling, because enough of
the ecosystem reads `@` as an instance selector to truncate an id in transit.

## Develop

```sh
npm install
npm test            # vitest
npm run typecheck
npm run build       # dist/, which is what OpenClaw loads
npm run validate    # clawhub package validate
openclaw plugins install --link .   # try it in a local OpenClaw
```

`src/openclaw-sdk.d.ts` declares the plugin SDK subpaths that `openclaw`
ships without types. Delete it whole when a release types its own SDK;
nothing else has to change.

## Publish

The first ClawHub publish is manual and creates the package:

```sh
npm exec clawhub -- login
npm run validate
npm exec clawhub -- package publish . --dry-run
npm exec clawhub -- package publish .
```

After it, set the trusted publisher once and the dispatch workflow publishes
with GitHub OIDC and no stored token:

```sh
npm exec clawhub -- package trusted-publisher set @konduiteu/openclaw \
  --repository schnaq/openclaw-konduit \
  --workflow-filename clawhub-publish.yml
```

npm publishes on a `v*` tag with provenance. Version, tag, push:

```sh
npm version minor && git push --follow-tags
```

MIT.
