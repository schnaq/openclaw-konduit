// GET /v1/usage → OpenClaw's provider card. The contract is the `Usage` schema
// in schnaq/konduit's docs/openapi/gateway.yaml; this file is its only reader.
import { readProviderJsonResponse } from "openclaw/plugin-sdk/provider-http";
import {
  buildUsageErrorSnapshot,
  fetchJson,
  type ProviderUsageSnapshot,
} from "openclaw/plugin-sdk/provider-usage";
import { KONDUIT_BASE_URL, PROVIDER_ID } from "./catalog.js";

export const DISPLAY_NAME = "konduit";

const MICRO_PER_UNIT = 1_000_000;
const MALFORMED = "Malformed usage response";

type Limit = { requests_per_minute: number | null; tokens_per_minute: number | null };

/** The body konduit answers, field for field. Amounts are integers in micro-EUR. */
export type UsageResponse = {
  object: "usage";
  organisation_id: string;
  api_key_id: string;
  balance: {
    currency: string;
    booked_micro_eur: number;
    reserved_micro_eur: number;
    available_micro_eur: number;
  };
  limits: { key: Limit; organisation: Limit };
  expires_at: string | null;
};

type ProvidersConfig = {
  models?: { providers?: Record<string, { baseUrl?: string } | undefined> };
};

/**
 * The base URL the usage call goes to. A user who pointed models.providers.konduit
 * at another gateway must have their balance read from that gateway, never from
 * the manifest's default; the manifest is the fallback only.
 */
export function resolveBaseUrl(config: ProvidersConfig): string {
  const configured = config.models?.providers?.[PROVIDER_ID]?.baseUrl?.trim();
  return (configured || KONDUIT_BASE_URL).replace(/\/+$/, "");
}

// What a customer reads when the call is refused. The statuses are konduit's
// documented ones; anything else is shown as its number.
const REFUSALS: Record<number, string> = {
  401: "konduit rejected the API key",
  403: "the API key lacks the usage:read scope",
  429: "rate limited by konduit; the card refreshes later",
  503: "konduit's ledger is unavailable; retry shortly",
};

export async function fetchKonduitUsage(
  baseUrl: string,
  token: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<ProviderUsageSnapshot> {
  const response = await fetchJson(
    `${baseUrl}/usage`,
    { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    timeoutMs,
    fetchFn,
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return buildUsageErrorSnapshot(PROVIDER_ID, REFUSALS[response.status] ?? `HTTP ${response.status}`);
  }
  let data: unknown;
  try {
    data = await readProviderJsonResponse<unknown>(response, "konduit usage");
  } catch {
    return buildUsageErrorSnapshot(PROVIDER_ID, MALFORMED);
  }
  return snapshotFrom(data);
}

/** Maps one answer to the card. Pure, so the mapping is tested without a fetch. */
export function snapshotFrom(data: unknown): ProviderUsageSnapshot {
  if (!isUsageResponse(data)) {
    return buildUsageErrorSnapshot(PROVIDER_ID, MALFORMED);
  }
  const { balance, limits } = data;
  return {
    provider: PROVIDER_ID,
    displayName: DISPLAY_NAME,
    windows: [],
    billing: [
      {
        type: "balance",
        label: "Available credit",
        amount: balance.available_micro_eur / MICRO_PER_UNIT,
        unit: balance.currency,
      },
    ],
    summary: summarise(balance, limits),
  };
}

function summarise(balance: UsageResponse["balance"], limits: UsageResponse["limits"]): string {
  const parts: string[] = [];
  if (balance.reserved_micro_eur > 0) {
    parts.push(`Reserved ${money(balance.reserved_micro_eur / MICRO_PER_UNIT, balance.currency)}`);
  }
  parts.push(describeLimit(limits.key, "key"), describeLimit(limits.organisation, "organisation"));
  return parts.filter(Boolean).join(" · ") || "no rate limits configured";
}

// null is "no ceiling" and is left out; a limit that is there is shown compactly.
function describeLimit(limit: Limit, scope: string): string {
  const parts: string[] = [];
  if (limit.requests_per_minute !== null) parts.push(`${compact(limit.requests_per_minute)} RPM`);
  if (limit.tokens_per_minute !== null) parts.push(`${compact(limit.tokens_per_minute)} TPM`);
  return parts.length > 0 ? `${parts.join(" · ")} (${scope})` : "";
}

function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLimit(value: unknown): value is Limit {
  return (
    isRecord(value) &&
    (value.requests_per_minute === null || typeof value.requests_per_minute === "number") &&
    (value.tokens_per_minute === null || typeof value.tokens_per_minute === "number")
  );
}

function isUsageResponse(value: unknown): value is UsageResponse {
  if (!isRecord(value) || !isRecord(value.balance) || !isRecord(value.limits)) return false;
  const { balance, limits } = value;
  return (
    typeof balance.currency === "string" &&
    typeof balance.booked_micro_eur === "number" &&
    typeof balance.reserved_micro_eur === "number" &&
    typeof balance.available_micro_eur === "number" &&
    isLimit(limits.key) &&
    isLimit(limits.organisation)
  );
}
