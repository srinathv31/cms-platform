// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle";
import type { Person, RoundHistoryItem, VersionTimelineItem } from "@/domain/review-types";

// One version's entry on the Versions tab, as the label rule shows it (domain/rounds.ts): no round on a
// version approved on its first try, "Approved on round 3" on one that took three, the round in the
// heading while a round after a send-back is in review, and the review history folded until opened,
// each round linking to its own review screen. The server actions under the entry's islands are replaced.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/server/actions/review", () => ({
  setSunset: vi.fn(),
  startRevoke: vi.fn(),
  confirmRevoke: vi.fn(),
  cancelRevoke: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { VersionEntry } = await import("./version-entry");

const NOW = new Date("2026-10-09T15:00:00.000Z");
const eli: Person = { id: "eli", name: "Eli Park", initials: "EP", hue: 120 };
const naomi: Person = { id: "naomi", name: "Naomi Reyes", initials: "NR", hue: 300 };
const maya: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 40 };
const jordan: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 200 };

const CTX = {
  templateId: "UC-ABC123",
  activeNumber: 2,
  usage: [],
  sunsetCalendar: { zone: "America/New_York", today: "2026-10-09" },
  nowIso: NOW.toISOString(),
};
const OK = { ok: true } as const;
const NO_REVOKE = { ok: false, ...REFUSALS.noRevokePending } as const;

function entry(over: Partial<VersionTimelineItem> = {}): VersionTimelineItem {
  return {
    id: "ver_2",
    number: 2,
    round: 1,
    label: "v2",
    approvedOnRound: null,
    rounds: null,
    state: "active",
    createdAt: "2026-09-20T12:00:00.000Z",
    author: eli,
    submittedAt: "2026-09-24T12:00:00.000Z",
    activatedAt: "2026-09-25T12:00:00.000Z",
    sunsetPassed: false,
    contractLines: [],
    contractItems: [],
    decisions: [{ kind: "approved", stageName: "Team approver", by: naomi, at: "2026-09-25T12:00:00.000Z" }],
    lastRenderAt: null,
    renders30d: 0,
    can: { setSunset: OK, startRevoke: OK, confirmRevoke: NO_REVOKE, cancelRevoke: NO_REVOKE },
    ...over,
  };
}

const round = (n: number, over: Partial<RoundHistoryItem> = {}): RoundHistoryItem => ({
  id: `ver_2r${n}`,
  round: n,
  state: "changes_requested",
  submittedAt: `2026-09-2${n}T12:00:00.000Z`,
  submittedBy: eli,
  ...over,
});

/** High-Yield Savings v2: sent back twice, approved on round 3. */
const APPROVED_ON_3 = entry({
  round: 3,
  approvedOnRound: "Approved on round 3",
  rounds: [
    round(3, { id: "ver_2", state: "active", decision: { kind: "approved", by: naomi, at: "2026-09-25T12:00:00.000Z", stageName: "Team approver" } }),
    round(2, {
      decision: { kind: "changes_requested", by: naomi, at: "2026-09-23T12:00:00.000Z", stageName: "Team approver", reason: "The email preheader still says 'rate change'." },
    }),
    round(1, {
      decision: { kind: "changes_requested", by: naomi, at: "2026-09-22T12:00:00.000Z", stageName: "Team approver", reason: "The withdrawal limit isn't stated." },
    }),
  ],
});

/** Cash Back v3: round 1 sent back, round 2 in review. */
const IN_REVIEW_ROUND_2 = entry({
  id: "ver_3",
  number: 3,
  round: 2,
  label: "v3 · Round 2",
  state: "in_review",
  author: maya,
  submittedAt: "2026-10-08T12:00:00.000Z",
  activatedAt: undefined,
  decisions: [],
  rounds: [
    { id: "ver_3", round: 2, state: "in_review", submittedAt: "2026-10-08T12:00:00.000Z", submittedBy: maya },
    {
      id: "ver_3r1",
      round: 1,
      state: "changes_requested",
      submittedAt: "2026-10-05T12:00:00.000Z",
      submittedBy: maya,
      decision: { kind: "changes_requested", by: jordan, at: "2026-10-06T12:00:00.000Z", stageName: "Team approver", reason: "Say when the annual fee starts." },
    },
  ],
});

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function render(item: VersionTimelineItem) {
  await act(async () => root.render(<VersionEntry item={item} ctx={CTX} space="deposits" now={NOW} last />));
}

const heading = () => container.querySelector("h2")!.textContent;
const trigger = () => container.querySelector<HTMLButtonElement>('[data-slot="review-history"] button');
const rows = () => [...container.querySelectorAll<HTMLElement>('[data-slot="review-history"] li')];
const rowLink = (row: HTMLElement) => row.querySelector("a")!;

describe("VersionEntry: rounds", () => {
  it("shows no round on a version approved on its first try, and no review history", async () => {
    await render(entry());
    expect(heading()).toBe("v2");
    expect(container.querySelector('[data-slot="approved-on-round"]')).toBeNull();
    expect(container.querySelector('[data-slot="review-history"]')).toBeNull();
    expect(container.textContent).not.toMatch(/round/i);
  });

  it("says which round a released version was approved on, beside its badge", async () => {
    await render(APPROVED_ON_3);
    expect(heading()).toBe("v2");
    expect(container.querySelector('[data-slot="approved-on-round"]')?.textContent).toBe("Approved on round 3");
    expect(container.querySelector("li[data-slot='version-entry']")?.getAttribute("data-round")).toBe("3");
  });

  it("folds the review history until it is opened", async () => {
    await render(APPROVED_ON_3);
    expect(trigger()?.textContent).toBe("Review history (3 rounds)");
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(rows()).toEqual([]);
  });

  it("opens to one row per round, newest first, each with its state, what closed it, and a link to its review screen", async () => {
    await render(APPROVED_ON_3);
    await act(async () => trigger()!.click());
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");

    const shown = rows();
    expect(shown.map((row) => rowLink(row).textContent)).toEqual(["Round 3", "Round 2", "Round 1"]);
    expect(shown.map((row) => row.querySelector("[data-status]")?.getAttribute("data-status"))).toEqual([
      "active",
      "changes_requested",
      "changes_requested",
    ]);
    // The released round is the bare URL (the number's head); a sent-back round names itself.
    expect(shown.map((row) => rowLink(row).getAttribute("href"))).toEqual([
      "/deposits/review/UC-ABC123/2",
      "/deposits/review/UC-ABC123/2?round=2",
      "/deposits/review/UC-ABC123/2?round=1",
    ]);
    expect(shown[0].textContent).toContain("Approved by Naomi Reyes on Sep 25");
    expect(shown[1].textContent).toContain("Naomi Reyes requested changes on Sep 23: “The email preheader still says 'rate change'.”");
    expect(shown[2].textContent).toContain("Naomi Reyes requested changes on Sep 22: “The withdrawal limit isn't stated.”");
  });

  it("heads a version in review after a send-back with its round, and keeps the round sent back in its history", async () => {
    await render(IN_REVIEW_ROUND_2);
    expect(heading()).toBe("v3 · Round 2");
    expect(container.querySelector('[data-slot="approved-on-round"]')).toBeNull();
    expect(trigger()?.textContent).toBe("Review history (2 rounds)");

    await act(async () => trigger()!.click());
    const shown = rows();
    expect(shown.map((row) => rowLink(row).getAttribute("href"))).toEqual([
      "/deposits/review/UC-ABC123/3?round=2",
      "/deposits/review/UC-ABC123/3?round=1",
    ]);
    expect(shown[0].textContent).toContain("Submitted by Maya Chen on Oct 8");
    expect(shown[1].textContent).toContain("Jordan Ellis requested changes on Oct 6: “Say when the annual fee starts.”");
  });
});
