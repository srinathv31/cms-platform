// Who is told about a version's change: the consumer audience of a notice (decision 0032). Pure TypeScript.
//
// A notice goes to every registered consumer with a non-preview render of the template from the window
// before the event on (for `sunset_passed`, the sunset itself), so a consumer that stopped rendering the
// template months ago isn't told about it. Each implementation behind the service interfaces asks its own
// render log; this is the rule they share.

import { DAY_MS } from "../dates";

/** Consumers that rendered the template (not as a preview) this recently get its notices. */
export const CONSUMER_NOTICE_WINDOW_DAYS = 90;

/** The first instant a render counts from, for a notice about an event at `at`. */
export function noticeAudienceSince(at: Date): Date {
  return new Date(at.getTime() - CONSUMER_NOTICE_WINDOW_DAYS * DAY_MS);
}
