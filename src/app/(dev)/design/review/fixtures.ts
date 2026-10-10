// Fixtures for the review screen mock: Spring Travel Rewards — Terms, v3 in review against the Active
// v2 (scenario 5: v3 adds a required `annual_fee`). The redline is hand-built in the RedlineDoc shape
// from review-types.ts (the real diff comes from domain/redline.ts), and the clean v3 document that the
// outputs render is derived from it, so there is one source of truth.

import type { ContractChange, JSONContent, Variable } from "@/editor/model/types";
import type { Channel } from "@/domain/types";
import type {
  ApprovalStage,
  Person,
  RedlineBlock,
  RedlineDoc,
  RedlineStatus,
  StepView,
  ThreadView,
} from "@/domain/review-types";
import { listSets } from "@/components/preview/sample-sets";
import { CORAL_VARIABLES } from "../workspace/fixtures";
import type { StageCount } from "./types";

export const TEMPLATE_NAME = "Spring Travel Rewards — Terms";
export const TEMPLATE_ID = "UC-4F7K2Q";
export const VERSION = 3;
export const BASELINE = 2;
/** The demo clock (YYYY-MM-DD) and the instant "ago" is measured from. */
export const TODAY = "2026-10-04";
export const NOW_MS = Date.parse("2026-10-04T15:30:00Z");
export const VARIABLES: Variable[] = CORAL_VARIABLES;
export const CHANNELS: Channel[] = ["pdf", "web", "email"];
export const SAMPLE_SETS = listSets([], VARIABLES, TODAY);

// ── People ───────────────────────────────────────────────────────

export const MAYA: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 28 };
export const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 212 };
export const ALEX: Person = { id: "alex", name: "Alex Kim", initials: "AK", hue: 152 };

export const SUBMITTED_AT = "2026-10-04T13:12:00Z";
export const SUBMIT_NOTE = "Added the annual fee and the new $4,000 spend threshold. The bonus is now a variable.";

const iso = (minutesAgo: number) => new Date(NOW_MS - minutesAgo * 60_000).toISOString();

export function ago(at: string): string {
  const minutes = Math.round((NOW_MS - Date.parse(at)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

// ── Dates ────────────────────────────────────────────────────────

const LONG = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const asUtc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const formatLong = (ymd: string) => LONG.format(asUtc(ymd));
export const formatShort = (ymd: string) => SHORT.format(asUtc(ymd));
export function addDays(ymd: string, days: number): string {
  return new Date(asUtc(ymd).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

// ── Builders ─────────────────────────────────────────────────────

type Inline = JSONContent;
type Mark = NonNullable<JSONContent["marks"]>[number];

const bold: Mark = { type: "bold" };
const INSERT: Mark = { type: "redline", attrs: { op: "insert" } };
const DELETE: Mark = { type: "redline", attrs: { op: "delete" } };

const t = (text: string, ...marks: Mark[]): Inline => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const v = (key: string): Inline => ({ type: "variable", attrs: { key } });
const withMark = (node: Inline, mark: Mark): Inline => ({ ...node, marks: [...(node.marks ?? []), mark] });
const ins = (node: Inline) => withMark(node, INSERT);
const del = (node: Inline) => withMark(node, DELETE);

const p = (...content: Inline[]): JSONContent => ({ type: "paragraph", content });
const h2 = (text: string, requiredKey: string): JSONContent => ({
  type: "heading",
  attrs: { level: 2, requiredKey },
  content: [t(text)],
});
const li = (...content: Inline[]): JSONContent => ({ type: "listItem", content: [p(...content)] });
const ul = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const ol = (...items: JSONContent[]): JSONContent => ({ type: "orderedList", content: items });
const cell = (header: boolean, ...content: Inline[]): JSONContent => ({
  type: header ? "tableHeader" : "tableCell",
  content: [p(...content)],
});
const row = (...cells: JSONContent[]): JSONContent => ({ type: "tableRow", content: cells });
const callout = (...content: Inline[]): JSONContent => ({ type: "callout", content: [p(...content)] });

const block = (id: string, status: RedlineStatus, node: JSONContent): RedlineBlock => ({
  id,
  status,
  node: { ...node, attrs: { ...node.attrs, id } },
});

// ── The redline: v3 against v2 ───────────────────────────────────

const BLOCKS: RedlineBlock[] = [
  block(
    "b1",
    "unchanged",
    p(
      t("Hi "),
      v("first_name"),
      t(" "),
      v("last_name"),
      t(", your Spring Travel Rewards offer is ready. Here is what the card includes and the terms that come with it."),
    ),
  ),
  block("b2", "unchanged", h2("Offer details", "offer_details")),
  block(
    "b3",
    "changed",
    p(
      t("Earn "),
      del(t("20,000")),
      ins(v("bonus_points")),
      t(" bonus points after you spend "),
      del(t("$3,000")),
      ins(t("$4,000")),
      t(" on purchases in your first three months. Apply by "),
      v("offer_end_date"),
      t(" to lock in the terms below."),
    ),
  ),
  block(
    "b4",
    "changed",
    ul(
      li(t("Triple points on flights, hotels and rental cars booked with your card.")),
      li(t("Double points on dining and groceries, and one point on everything else.")),
      li(
        ins(t("Points ")),
        ins(t("never expire", bold)),
        ins(t(" while your account is open and in good standing.")),
      ),
    ),
  ),
  block("b5", "added", p(t("This offer can’t be combined with other card promotions."))),
  block(
    "b6",
    "unchanged",
    p(t("This offer is available to residents of "), v("home_state"), t(" with a valid U.S. mailing address.")),
  ),
  block("b7", "unchanged", h2("Rates and fees", "rates_and_fees")),
  block("b8", "changed", {
    type: "table",
    content: [
      row(cell(true, t("Interest rates and fees")), cell(true, t("Terms"))),
      row(
        cell(false, t("Annual percentage rate (APR) for purchases")),
        cell(false, v("purchase_apr"), t(" — varies with the Prime Rate.")),
      ),
      row(
        cell(false, ins(t("Annual fee"))),
        cell(false, ins(v("annual_fee")), ins(t(", billed on your first statement."))),
      ),
      row(cell(false, t("Late payment fee")), cell(false, t("Up to "), del(t("$40")), ins(t("$41")))),
      row(
        cell(false, t("Foreign transaction fee")),
        cell(false, del(t("3% of each transaction")), ins(t("None"))),
      ),
    ],
  }),
  block(
    "b9",
    "unchanged",
    callout(
      t("The APR is variable. ", bold),
      t("It can change when the Prime Rate changes, and a higher rate applies to your balance from the next billing cycle."),
    ),
  ),
  block("b10", "removed", p(t("Rates shown are effective January 1, 2026."))),
  block("b11", "unchanged", h2("Legal notices", "legal_notices")),
  block(
    "b12",
    "unchanged",
    p(
      t("This offer is not transferable and expires on "),
      v("offer_end_date"),
      t(". The terms above are accurate as of the date this notice was prepared and may change after that date."),
    ),
  ),
  block(
    "b13",
    "changed",
    ol(
      li(t("Credit approval is required. Terms may vary based on your creditworthiness.")),
      li(t("Bonus points post within "), del(t("twelve")), ins(t("eight")), t(" weeks of meeting the spending requirement.")),
      li(t("Your account must be open and in good standing to redeem points.")),
      li(t("Residents of "), v("home_state"), t(": state-specific terms are in your cardmember agreement.")),
    ),
  ),
  block(
    "b14",
    "unchanged",
    p(t("Questions? Call the number on the back of your card or visit our help center. Coral Bank, N.A. Member FDIC.")),
  ),
];

const count = (status: RedlineStatus) => BLOCKS.filter((b) => b.status === status).length;

export const REDLINE: RedlineDoc = {
  blocks: BLOCKS,
  counts: { added: count("added"), removed: count("removed"), changed: count("changed"), moved: count("moved") },
};

export const CHANGE_COUNT = REDLINE.counts.added + REDLINE.counts.removed + REDLINE.counts.changed;

// ── Derived: the clean v3 and the helpers the views share ────────

function isDeleted(node: JSONContent): boolean {
  return (node.marks ?? []).some((m) => m.type === "redline" && m.attrs?.op === "delete");
}

/** The node as it is in v3: deleted content dropped, redline marks removed. */
export function cleanNode(node: JSONContent): JSONContent | null {
  if (isDeleted(node)) return null;
  const next: JSONContent = { ...node };
  if (node.marks) {
    const marks = node.marks.filter((m) => m.type !== "redline");
    if (marks.length) next.marks = marks;
    else delete next.marks;
  }
  if (node.content) next.content = node.content.map(cleanNode).filter((n): n is JSONContent => n !== null);
  return next;
}

/** The version under review as plain TipTap JSON: what the outputs render. */
export const V3_DOC: JSONContent = {
  type: "doc",
  content: BLOCKS.filter((b) => b.status !== "removed")
    .map((b) => cleanNode(b.node))
    .filter((n): n is JSONContent => n !== null),
};

export function textOf(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "variable") {
    const key = String(node.attrs?.key ?? "");
    return VARIABLES.find((variable) => variable.key === key)?.label ?? key;
  }
  return (node.content ?? []).map(textOf).join(node.type === "tableRow" ? " · " : " ");
}

/** The section a block sits in, for the "Changes only" view and the thread anchors. */
export function sectionOf(blocks: RedlineBlock[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    const n = blocks[i].node;
    if (n.type === "heading") return textOf(n);
  }
  return null;
}

/** A short name for a block, for a thread whose anchor has no quote. */
export function blockLabel(id: string): string {
  const b = BLOCKS.find((x) => x.id === id);
  if (!b) return "Removed block";
  if (b.node.type === "table") return "Table";
  const text = textOf(b.node);
  return text.length > 54 ? `${text.slice(0, 52)}…` : text;
}

// ── Contract changes (the version's variable list against the Active one) ────

export const CONTRACT_CHANGES: ContractChange[] = [
  { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
  { kind: "added", key: "bonus_points", breaking: false, type: "number", required: false },
  { kind: "label_changed", key: "home_state", breaking: false, from: "State", to: "Home state" },
];

/** What domain/contract.ts `describeChanges` writes, one line per change, same order. */
export const CONTRACT_LINES: string[] = [
  "v3 adds required `annual_fee` (Currency).",
  "v3 adds optional `bonus_points` (Number).",
  "v3 changes the label of `home_state` to “Home state”.",
];

// ── Approval chain ───────────────────────────────────────────────

export const CHAIN: Record<StageCount, ApprovalStage[]> = {
  1: [{ id: "stage_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } }],
  2: [
    { id: "stage_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } },
    { id: "stage_legal", position: 1, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
  ],
};

/** The stepper for `done` stages approved (everything past them waits). `returned` marks the current stage. */
export function stepsFor(stages: StageCount, done: number, returned: boolean): StepView[] {
  return CHAIN[stages].map((stage, i): StepView => {
    if (i < done) return { position: i, name: stage.name, status: "done", decidedBy: JORDAN, decidedAt: iso(0) };
    if (i === done) return { position: i, name: stage.name, status: returned ? "returned" : "current" };
    return { position: i, name: stage.name, status: "waiting" };
  });
}

// ── Consequences (what domain/consequences.ts writes for the Approve dialog) ──

export function approveConsequences(opts: { stages: StageCount; final: boolean; sunset: string | null }): string[] {
  if (!opts.final) return [`v${VERSION} moves to the Legal reviewer. It becomes Active once they approve.`];
  const lines = [
    opts.sunset
      ? `v${VERSION} becomes Active. v${BASELINE} becomes Superseded.`
      : `v${VERSION} becomes Active. v${BASELINE} becomes Superseded; Coral keeps rendering v${BASELINE} until it relinks.`,
  ];
  if (opts.sunset) {
    lines.push(
      `Coral still renders v${BASELINE} (last render today). It will keep working until ${formatLong(opts.sunset)}.`,
    );
  }
  lines.push("Coral has to map `annual_fee` before it moves to v3.");
  return lines;
}

// ── Threads ──────────────────────────────────────────────────────

export const THREADS: ThreadView[] = [
  {
    id: "t1",
    blockId: "b8",
    quote: "Annual fee",
    status: "open",
    originVersionNumber: 3,
    originRound: 1,
    originLabel: "v3",
    orphaned: false,
    comments: [
      { id: "c1", author: ALEX, kind: "comment", body: "Does $95 apply to every Spring card tier?", createdAt: iso(52) },
      {
        id: "c2",
        author: MAYA,
        kind: "comment",
        body: "One fee for the whole Spring card. Tiers come later.",
        createdAt: iso(31),
      },
    ],
  },
  {
    id: "t3",
    blockId: "b4",
    quote: "never expire",
    status: "open",
    originVersionNumber: 3,
    originRound: 1,
    originLabel: "v3",
    orphaned: false,
    comments: [
      {
        id: "c5",
        author: ALEX,
        kind: "comment",
        body: "Legal usually wants “do not expire” here.",
        createdAt: iso(18),
      },
    ],
  },
  {
    id: "t2",
    blockId: "b3",
    quote: "$4,000",
    status: "resolved",
    originVersionNumber: 3,
    originRound: 1,
    originLabel: "v3",
    orphaned: false,
    resolvedBy: ALEX,
    resolvedAt: iso(36),
    comments: [
      {
        id: "c3",
        author: ALEX,
        kind: "comment",
        body: "Is the new $4,000 threshold confirmed with product?",
        createdAt: iso(64),
      },
      { id: "c4", author: MAYA, kind: "comment", body: "Yes. Sam signed off on Friday.", createdAt: iso(40) },
    ],
  },
];
