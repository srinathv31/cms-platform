import type { ActionResult } from "@/domain/review-types";

// The browser's side of the reads a screen makes on demand, when a dialog or a menu opens: GET
// /api/templates/[templateId]/… (src/app/api/templates/[templateId]/, src/server/api/reads.ts). Each
// answers `{ ok: true, … }`, or `{ ok: false, code, reason }` with the refusal's code, the sentence to
// show and a 4xx status.
// Route handlers rather than server actions: actions run one at a time with the page's mutations.

/** A template's reads, by the last segment of their route. */
export type TemplateRead = "compare" | "base-version" | "submit-summary" | "copilot-prompt" | "integration";

/** `/api/templates/UC-4F7K2Q/compare?from=…&to=…` */
export function templateReadUrl(templateId: string, read: TemplateRead, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `/api/templates/${encodeURIComponent(templateId)}/${read}${query ? `?${query}` : ""}`;
}

/**
 * One read: the data, or the refusal with its code and reason. Throws when the answer isn't a result (the
 * request failed, or the server sent an error page); each caller treats that as its own failure.
 */
export async function readTemplate<T>(
  templateId: string,
  read: TemplateRead,
  params?: Record<string, string>,
): Promise<ActionResult<T>> {
  const url = templateReadUrl(templateId, read, params);
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  const body: unknown = await response.json();
  if (!isResult(body)) throw new Error(`GET ${url} answered ${response.status} without a result.`);
  return body as ActionResult<T>;
}

function isResult(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { ok, code, reason } = body as { ok?: unknown; code?: unknown; reason?: unknown };
  return ok === true || (ok === false && typeof code === "string" && typeof reason === "string");
}
