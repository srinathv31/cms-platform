// Fixtures for the Review comments mock: the people, the threads and the block ids of the Spring
// Travel Rewards disclosure (borrowed read-only from the Preview mock). Times are fixed against a
// demo "now" so the server paint and the client agree.

import { DOCUMENT_THREAD, type CommentView, type Person, type ThreadView } from "@/domain/review-types";
import type { JSONContent } from "@/editor/model/types";
import { SPRING_DOC, TEMPLATE_ID, TEMPLATE_NAME, VARIABLES, draftModel } from "../preview/fixtures";

export { SPRING_DOC, TEMPLATE_ID, TEMPLATE_NAME, VARIABLES, draftModel };

// ── People ───────────────────────────────────────────────────────

export const MAYA: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 28 };
export const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 212 };

// ── Time ─────────────────────────────────────────────────────────

/** The demo clock, fixed. */
export const NOW = Date.parse("2027-02-18T15:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const HOUR = 60;
const DAY = 24 * HOUR;

/** "Just now", "12m ago", "3h ago", "Yesterday", "3 days ago". */
export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((NOW - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < HOUR) return `${minutes}m ago`;
  if (minutes < DAY) return `${Math.floor(minutes / HOUR)}h ago`;
  if (minutes < 2 * DAY) return "Yesterday";
  return `${Math.floor(minutes / DAY)} days ago`;
}

export const nowIso = () => new Date(NOW).toISOString();

// ── The document's blocks ────────────────────────────────────────

const TOP: JSONContent[] = SPRING_DOC.content ?? [];

function plainText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  // A chip is one character here: only the order of quotes inside a block matters.
  if (node.type === "variable") return "￼";
  return (node.content ?? []).map(plainText).join("");
}

export const BLOCKS = TOP.map((node, index) => ({
  index,
  id: String(node.attrs?.id ?? ""),
  text: plainText(node),
}));

const blockId = (index: number) => BLOCKS[index].id;

/** Document order of a thread: by block, then by where its quote starts in the block. */
export function orderKey(thread: { blockId: string; quote: string | null }): number {
  if (thread.blockId === DOCUMENT_THREAD) return -1;
  const block = BLOCKS.find((b) => b.id === thread.blockId);
  if (!block) return Number.MAX_SAFE_INTEGER;
  const at = thread.quote ? block.text.indexOf(thread.quote.slice(0, 24)) : -1;
  return block.index * 10_000 + Math.max(at, 0);
}

export function sortThreads<T extends { blockId: string; quote: string | null }>(threads: T[]): T[] {
  return [...threads].sort((a, b) => orderKey(a) - orderKey(b));
}

// ── Threads ──────────────────────────────────────────────────────

function c(id: string, author: Person, body: string, minutesAgo: number, kind: CommentView["kind"] = "comment"): CommentView {
  return { id, author, body, kind, createdAt: ago(minutesAgo) };
}

function thread(
  id: string,
  anchor: { blockId: string; quote?: string },
  comments: CommentView[],
  resolved?: { by: Person; minutesAgo: number },
): ThreadView {
  return {
    id,
    blockId: anchor.blockId,
    quote: anchor.quote ?? null,
    status: resolved ? "resolved" : "open",
    originVersionNumber: 1,
    comments,
    resolvedBy: resolved?.by,
    resolvedAt: resolved ? ago(resolved.minutesAgo) : undefined,
    orphaned: false,
  };
}

/**
 * Author side (Maya, on the draft made after Jordan requested changes on v1): the change request,
 * four open threads and two resolved ones.
 */
export function authorThreads(): ThreadView[] {
  return sortThreads([
    thread(
      "t-doc",
      { blockId: DOCUMENT_THREAD },
      [
        c(
          "c-doc-1",
          JORDAN,
          "Two things to fix before this can go live. The spend requirement is typed into the text, and the rates table does not say how the APR is set.",
          2 * DAY + 40,
          "change_request",
        ),
      ],
    ),
    thread(
      "t-spend",
      { blockId: blockId(2), quote: "$4,000 on purchases in your first three months" },
      [
        c("c-spend-1", JORDAN, "The spend amount is typed into the text. Make it a variable so it cannot drift from the cardmember agreement.", 2 * DAY + 38),
        c("c-spend-2", MAYA, "Makes sense. I will add a Spend requirement variable.", 22 * HOUR),
      ],
    ),
    thread(
      "t-never",
      { blockId: blockId(3), quote: "never expire" },
      [
        c("c-never-1", JORDAN, "Is “never expire” still accurate after the March terms change?", 2 * DAY + 35),
        c("c-never-2", MAYA, "Yes. The cardmember agreement is unchanged on this.", 2 * DAY + 5),
      ],
      { by: JORDAN, minutesAgo: 2 * DAY },
    ),
    thread(
      "t-address",
      { blockId: blockId(4), quote: "valid U.S. mailing address" },
      [c("c-address-1", JORDAN, "Should this say U.S. residency instead?", 2 * DAY + 33), c("c-address-2", MAYA, "The application form asks for a mailing address, so I kept it.", 2 * DAY + 2)],
      { by: MAYA, minutesAgo: 26 * HOUR },
    ),
    thread(
      "t-apr",
      { blockId: blockId(6) },
      [c("c-apr-1", JORDAN, "Add how the purchase APR is set, for example Prime plus a margin.", 2 * DAY + 30)],
    ),
    thread(
      "t-transfer",
      { blockId: blockId(9), quote: "This offer is not transferable" },
      [c("c-transfer-1", JORDAN, "Confirm with Legal that this still applies when a customer upgrades.", 2 * DAY + 26)],
    ),
    thread(
      "t-date",
      { blockId: blockId(9), quote: "accurate as of the date this notice was prepared" },
      [c("c-date-1", JORDAN, "Which date is this? “Prepared” is not defined anywhere.", 2 * DAY + 24)],
    ),
  ]);
}

/** Approver side (Jordan, reading v2): Maya's fixes are resolved, one thread is still open. */
export function reviewThreads(): ThreadView[] {
  return sortThreads(
    authorThreads().map((t) => {
      if (t.id === "t-doc" || t.id === "t-spend") {
        return { ...t, status: "resolved" as const, resolvedBy: MAYA, resolvedAt: ago(3 * HOUR) };
      }
      if (t.id === "t-apr") {
        return {
          ...t,
          comments: [...t.comments, c("c-apr-2", MAYA, "Added the margin over Prime to the APR row.", 2 * HOUR)],
        };
      }
      if (t.id === "t-date") return { ...t, status: "resolved" as const, resolvedBy: MAYA, resolvedAt: ago(3 * HOUR) };
      return t;
    }),
  );
}

/** The quote the `compose=1` and `compose=sel` deep links start a thread on. */
export const COMPOSE_ANCHOR = { blockId: blockId(2), quote: "bonus points" };
/** The block `compose=block` starts a whole-block thread on (the bulleted list under Offer details). */
export const BLOCK_ANCHOR = { blockId: blockId(3), quote: null };
