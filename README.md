# konduit for OpenClaw

European AI inference through [konduit](https://konduit.eu) as an OpenClaw
provider, with the organisation's live credit balance and rate limits on the
provider card.

## Install

```sh
openclaw plugins install clawhub:@schnaq/openclaw-konduit
openclaw plugins enable konduit
```

or from npm, which asks you to confirm the source:

```sh
openclaw plugins install npm:@schnaq/openclaw-konduit
```

Set `KONDUIT_API_KEY` to a key minted in the [konduit console](https://console.konduit.eu),
or run `openclaw onboard --konduit-api-key kdt-…`. The key needs the
`usage:read` scope for the card to show a balance; a key created without any
scopes is unrestricted and works as it is. A key narrowed to `chat:write` still
completes, and the card says why it shows nothing.

If you had configured konduit by hand under `models.providers.konduit`, keep
it: OpenClaw merges your entries with the plugin's by model id, and your
`baseUrl` wins.

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

That includes deployments konduit marks `deprecated`: the status discourages
them, it does not switch them off, and a model you already have in your config
should not vanish from the list because of a label. Only `retired` deployments
are left out. The default model is never a deprecated one.

CI checks the committed list against the live catalog. Live discovery is on
as well, so a deployment konduit adds appears before the next release — at
cost zero until the generator has written its price.

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
npm exec clawhub -- package trusted-publisher set @schnaq/openclaw-konduit \
  --repository schnaq/openclaw-konduit \
  --workflow-filename clawhub-publish.yml
```

npm publishes on a `v*` tag with provenance. Version, tag, push:

```sh
npm version minor && git push --follow-tags
```

MIT.
