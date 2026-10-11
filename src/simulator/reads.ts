import type { ApiTemplateSummary } from "@/contracts/api-v1";
import type { SimDeliveryView, SimResult } from "./types";

// The browser's side of Coral's two on-demand reads: GET /sim/templates/search and
// GET /sim/deliveries/{id}/view (src/app/(simulator)/sim/, served by queries.ts). Route handlers rather than
// server actions, so a read never waits in the queue of the page's writes. Each answers a `SimResult`; one
// that can't be reached or isn't an answer comes back as a refusal Coral can show, never as a throw.

export const templateSearchUrl = (q: string) => `/sim/templates/search?${new URLSearchParams({ q })}`;
export const deliveryViewUrl = (deliveryId: string) => `/sim/deliveries/${encodeURIComponent(deliveryId)}/view`;

const UNREACHABLE = "Coral couldn't be reached.";

async function read<T extends object>(url: string): Promise<SimResult<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    const body: unknown = await response.json();
    const { ok, reason } = (typeof body === "object" && body !== null ? body : {}) as { ok?: unknown; reason?: unknown };
    if (ok === true) return body as SimResult<T>;
    if (ok === false && typeof reason === "string") return { ok: false, reason };
  } catch {
    // No network, or an error page instead of JSON.
  }
  return { ok: false, reason: UNREACHABLE };
}

/** The Active templates Stencil lists for `q` (every one for an empty `q`). */
export const readTemplateSearch = (q: string) => read<{ results: ApiTemplateSummary[] }>(templateSearchUrl(q));

/** One delivery as its customer sees it. */
export const readDeliveryView = (deliveryId: string) => read<{ view: SimDeliveryView }>(deliveryViewUrl(deliveryId));
