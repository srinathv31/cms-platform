// "This template was just imported": the one-shot handoff from `POST /api/imports` (which sets it as
// it answers) to the Content page (which takes it on arrival and widens the rail on the Original
// view, where the import report sits at the top). The name is selected on arrival by `ucomp_created`
// (just-created.ts), which the route sets too. A cookie for the same reason that one is.

import { JUST_IMPORTED_COOKIE } from "@/domain/import-types";

/** The template an arrival from an import is waiting for, without taking it (the Content skeleton asks); null when none is. */
export function peekJustImported(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${JUST_IMPORTED_COOKIE}=`;
  const entry = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  const id = entry === undefined ? "" : decodeURIComponent(entry.slice(prefix.length));
  return id === "" ? null : id;
}

/**
 * True once, on the first arrival at the template the cookie names; the cookie is cleared as it is
 * taken. Any other template, or a later visit, gets false.
 */
export function takeJustImported(templateId: string | undefined): boolean {
  if (!templateId || peekJustImported() !== templateId) return false;
  document.cookie = `${JUST_IMPORTED_COOKIE}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`;
  return true;
}
