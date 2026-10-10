// @vitest-environment happy-dom
import { createRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Person } from "@/domain/review-types";
import type { VersionState } from "@/domain/types";

// The review header's byline reads the version as its label (domain/rounds.ts): the round once the
// number was sent back, and "Approved on round N" on a version released after send-backs.

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/workspace/workspace-share", () => ({ WorkspaceShare: () => null }));

const { ReviewHeader } = await import("./review-header");

const NOW = "2026-10-09T15:00:00.000Z";
const maya: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 40 };

function byline(version: { number: number; round: number; state: VersionState }) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <ReviewHeader
      team="coral-offers"
      templateId="UC-ABC123"
      templateName="Cash Back Welcome Bonus — Terms"
      versionNumber={version.number}
      round={version.round}
      state={version.state}
      author={maya}
      submittedAt="2026-10-09T13:00:00.000Z"
      nowIso={NOW}
      ring={false}
      slotRef={createRef()}
    />,
  );
  return host.querySelector('[data-slot="byline"]')?.textContent;
}

describe("ReviewHeader: the byline", () => {
  it("names the round once the number was sent back", () => {
    expect(byline({ number: 3, round: 2, state: "in_review" })).toBe("v3 · Round 2 by Maya Chen · 2 hours ago");
    expect(byline({ number: 3, round: 1, state: "changes_requested" })).toBe("v3 · Round 1 by Maya Chen · 2 hours ago");
  });

  it("is the bare version on a first round, and says which round a version released after send-backs was approved on", () => {
    expect(byline({ number: 3, round: 1, state: "in_review" })).toBe("v3 by Maya Chen · 2 hours ago");
    expect(byline({ number: 2, round: 1, state: "active" })).toBe("v2 by Maya Chen · 2 hours ago");
    expect(byline({ number: 2, round: 3, state: "active" })).toBe("v2 by Maya Chen · 2 hours ago · Approved on round 3");
  });
});
