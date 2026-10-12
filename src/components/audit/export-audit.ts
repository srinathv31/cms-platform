// The Export link's client side: ask for the CSV, and read what comes back. The route answers the
// file, or a refusal as every refusal is (`{ ok: false, code, reason }`, with a 403 or 404), so a
// click that gets a refusal can say why instead of saving it as a file.

import type { Refused } from "@/domain/refusals";

/** Shown when the request itself fails (no usable answer from the server), not a refusal. */
export const EXPORT_FAILED = "Couldn't export the audit log. Try again.";

/** The name the file is saved under when the server sent none. */
const FALLBACK_FILENAME = "stencil-audit.csv";

export type AuditFile = { ok: true; blob: Blob; filename: string } | Refused;

const failed: Refused = { ok: false, code: "failed", reason: EXPORT_FAILED };

/** `filename` from a `Content-Disposition: attachment; filename="…"` header. */
function filenameOf(response: Response): string {
  const match = /filename="([^"]+)"/.exec(
    response.headers.get("Content-Disposition") ?? "",
  );
  return match?.[1] ?? FALLBACK_FILENAME;
}

function isRefusal(body: unknown): body is Refused {
  if (typeof body !== "object" || body === null) return false;
  const { ok, code, reason } = body as {
    ok?: unknown;
    code?: unknown;
    reason?: unknown;
  };
  return ok === false && typeof code === "string" && typeof reason === "string";
}

/**
 * Fetches the export at `href` (the Audit page's `csvHref`, filters included): the file's bytes, as
 * sent, or the refusal with its code and reason. An answer that is neither (offline, a server error
 * page) is the code `failed`.
 */
export async function requestAuditExport(
  href: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<AuditFile> {
  let response: Response;
  try {
    response = await fetchImpl(href, { cache: "no-store" });
  } catch {
    return failed;
  }
  try {
    if (response.ok)
      return {
        ok: true,
        blob: await response.blob(),
        filename: filenameOf(response),
      };
    const body: unknown = await response.json();
    return isRefusal(body) ? body : failed;
  } catch {
    return failed;
  }
}

/** Saves the file the way a download link would, through a Blob URL revoked once the download has started. */
export function saveAuditFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
