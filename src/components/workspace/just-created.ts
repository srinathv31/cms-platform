// "This template was just made from a starter": the one-shot handoff from `createTemplate` (which
// sets it as it redirects) to the workspace's name field (which takes it on arrival and selects the
// name). The cookie's name and lifetime are in `@/domain/arrival-cookies`, which the server action and the
// imports route read too; this module is the browser's half.
//
// It is a cookie, not a URL parameter. The action redirects straight to the template's own address,
// so nothing has to tidy the address bar afterwards: an address rewritten under the router while the
// redirect navigation is still settling can turn Next's late commit of that navigation into a second
// history entry (Back then needs two presses to reach the Library).

import { JUST_CREATED_COOKIE } from "@/domain/arrival-cookies";

/**
 * True once, on the first arrival at the template the cookie names; the cookie is cleared as it is
 * taken. Any other template, or a later visit, gets false.
 */
export function takeJustCreated(templateId: string | undefined): boolean {
  if (!templateId || typeof document === "undefined") return false;
  const prefix = `${JUST_CREATED_COOKIE}=`;
  const entry = document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix));
  if (
    entry === undefined ||
    decodeURIComponent(entry.slice(prefix.length)) !== templateId
  )
    return false;
  document.cookie = `${JUST_CREATED_COOKIE}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`;
  return true;
}
