// @vitest-environment happy-dom
import { createRef } from "react";
import type { Route } from "next";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { REASONS } from "@/domain/permissions";
import type { StepView } from "@/domain/review-types";
import type { DecisionAccess, DecisionRow } from "./decision-model";
import { DecisionBar } from "./decision-bar";
import { BLOCKED_ID, DecisionRail, type NextRound } from "./decision-rail";

const STEPS: StepView[] = [{ position: 0, name: "Team approver", status: "current" }];
const NOW = "2026-10-05T02:29:00.000Z";
const BUTTONS: DecisionRow = { kind: "buttons" };
const SENT_BACK: DecisionRow = { kind: "sentBack" };
const JORDAN = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 200 };

// Tests that need focus or ids put their markup in the document; each starts from an empty one.
afterEach(() => {
  document.body.innerHTML = "";
});

/** The text of the elements an element's `aria-describedby` names (it must be in the document). */
function description(el: Element): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function rail(access: DecisionAccess, row: DecisionRow = BUTTONS, next: NextRound | null = null, steps: StepView[] = STEPS) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <DecisionRail
      steps={steps}
      nowIso={NOW}
      access={access}
      row={row}
      next={next}
      onApprove={() => {}}
      onRequest={() => {}}
      approveRef={createRef()}
      requestRef={createRef()}
      regionRef={createRef()}
    >
      <p>body</p>
    </DecisionRail>,
  );
  return host;
}

describe("DecisionRail: one geometry for every viewer", () => {
  const rows = (host: HTMLElement) => ({
    region: host.querySelector("[data-decision]") as HTMLElement,
    buttons: [...host.querySelectorAll("[data-rail-head] button")] as HTMLButtonElement[],
    step: host.querySelector('[data-step="current"]')!.textContent,
  });

  it("an approver gets two enabled buttons in a 32px row", () => {
    const { region, buttons, step } = rows(rail({ kind: "open" }));
    expect(region.className).toContain("h-8");
    expect(buttons.map((b) => [b.textContent, b.disabled])).toEqual([
      ["Approve", false],
      ["Request changes", false],
    ]);
    expect(step).toContain("Waiting for a decision");
  });

  it.each([REASONS.ownVersion.reason, REASONS.wroteVersion.reason, "Waiting on Legal reviewer."])(
    "blocked (%s): both are greyed but take focus, and the reason on the stage line describes them",
    (reason) => {
      const host = rail({ kind: "blocked", reason });
      document.body.append(host);
      const { region, buttons, step } = rows(host);
      expect(region.className).toContain("h-8");
      expect(buttons.map((b) => b.textContent)).toEqual(["Approve", "Request changes"]);
      for (const b of buttons) {
        // Marked disabled for assistive technology and for styling, never with the native attribute.
        expect([b.disabled, b.getAttribute("aria-disabled"), b.hasAttribute("data-disabled")]).toEqual([false, "true", true]);
        b.focus();
        expect(document.activeElement, `${b.textContent} takes focus`).toBe(b);
        expect(b.getAttribute("aria-describedby")).toBe(BLOCKED_ID);
        expect(description(b)).toBe(reason);
      }
      expect(step).toContain(reason);
      expect(step).not.toContain("Waiting for a decision");
    },
  );

  it("blocked with no stage waiting: each button carries the reason itself", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <DecisionRail
        steps={[{ position: 0, name: "Team approver", status: "done" }]}
        nowIso={NOW}
        access={{ kind: "blocked", reason: REASONS.ownVersion.reason }}
        row={BUTTONS}
        onApprove={() => {}}
        onRequest={() => {}}
        approveRef={createRef()}
        requestRef={createRef()}
        regionRef={createRef()}
      >
        <p>body</p>
      </DecisionRail>,
    );
    document.body.append(host);
    const buttons = [...host.querySelectorAll("[data-rail-head] button")] as HTMLButtonElement[];
    expect(host.querySelector(`#${BLOCKED_ID}`)).toBeNull();
    for (const b of buttons) expect(description(b)).toBe(REASONS.ownVersion.reason);
  });

  it("someone who isn't an approver gets no buttons, and the row stays", () => {
    const { region, buttons, step } = rows(rail({ kind: "hidden" }));
    expect(buttons).toHaveLength(0);
    expect(region.className).toContain("h-8");
    expect(step).toContain("Waiting for a decision");
  });

  it("once decided, a status line stands in the row and can take focus", () => {
    const { region, buttons } = rows(rail({ kind: "blocked", reason: "x" }, { kind: "line", text: "You approved v3." }));
    expect(buttons).toHaveLength(0);
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("tabindex")).toBe("-1");
    expect(region.hasAttribute("data-decided")).toBe(true);
    expect(region.textContent).toBe("You approved v3.");
    expect(region.className).toContain("h-8");
  });

  describe("a sent-back round", () => {
    const RETURNED: StepView[] = [
      { position: 0, name: "Team approver", status: "returned", decidedBy: JORDAN, decidedAt: "2026-10-02T01:00:00.000Z" },
    ];
    const ROUND_2 = { label: "v3, round 2", href: "/coral-offers/review/UC-J530DX/3?round=2" as Route };
    const region = (host: HTMLElement) => host.querySelector("[data-decision]") as HTMLElement;

    it("links to the round that replaced it, in the same 32px row, and repeats nothing the stepper says", () => {
      const host = rail({ kind: "open" }, SENT_BACK, ROUND_2, RETURNED);
      const row = region(host);
      expect(row.className).toContain("h-8");
      expect(row.hasAttribute("data-decided")).toBe(true);
      // Nothing to announce: it was decided before this visit.
      expect(row.getAttribute("role")).toBeNull();
      expect(row.querySelectorAll("button")).toHaveLength(0);
      expect(row.textContent).toBe("Open v3, round 2");
      const links = [...row.querySelectorAll("a")];
      expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
        ["Open v3, round 2", "/coral-offers/review/UC-J530DX/3?round=2"],
      ]);
      // Not a primary button: the screen's one black button is Approve.
      expect(links[0]!.getAttribute("data-slot")).toBeNull();
      // Who sent it back, and when, is the returned stage's line, once.
      const head = host.querySelector("[data-rail-head]")!;
      expect(host.querySelector('[data-step="returned"]')!.textContent).toBe("Team approverJordan Ellis · 3 days ago");
      expect(head.textContent!.match(/Jordan Ellis/g)).toHaveLength(1);
    });

    it("links a number released since by its number, to its bare review page", () => {
      const row = region(rail({ kind: "hidden" }, SENT_BACK, { label: "v2", href: "/deposits/review/UC-ZKZSRZ/2" as Route }, RETURNED));
      expect([...row.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
        ["Open v2", "/deposits/review/UC-ZKZSRZ/2"],
      ]);
    });

    it("with only a draft after it, is an empty row that keeps its height", () => {
      const row = region(rail({ kind: "open" }, SENT_BACK, null, RETURNED));
      expect(row.textContent).toBe("");
      expect(row.querySelectorAll("a, button")).toHaveLength(0);
      expect(row.className).toContain("h-8");
    });

    it("never shows the link in place of the buttons, nor beside a line", () => {
      const buttons = region(rail({ kind: "open" }, BUTTONS, ROUND_2));
      expect(buttons.querySelectorAll("a")).toHaveLength(0);
      expect([...buttons.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Approve", "Request changes"]);
      const line = region(rail({ kind: "open" }, { kind: "line", text: "You returned v3, round 1 to Maya Chen." }, ROUND_2, RETURNED));
      expect(line.querySelectorAll("a")).toHaveLength(0);
      expect(line.textContent).toBe("You returned v3, round 1 to Maya Chen.");
    });
  });

  describe("a decided stage", () => {
    const at = "2026-10-02T01:00:00.000Z";
    const step = (host: HTMLElement, status: StepView["status"]) => host.querySelector(`[data-step="${status}"]`)!;
    const icon = (li: Element) => li.querySelector('[role="img"]');

    it("reads who decided it and when, the same for both outcomes, and its icon names the outcome", () => {
      const host = rail({ kind: "hidden" }, SENT_BACK, null, [
        { position: 0, name: "Team approver", status: "done", decidedBy: JORDAN, decidedAt: at },
        { position: 1, name: "Legal reviewer", status: "returned", decidedBy: { ...JORDAN, name: "Taylor Kim" }, decidedAt: at },
      ]);
      const done = step(host, "done");
      const returned = step(host, "returned");
      expect(done.textContent).toBe("Team approverJordan Ellis · 3 days ago");
      expect(returned.textContent).toBe("Legal reviewerTaylor Kim · 3 days ago");
      expect([icon(done)?.getAttribute("aria-label"), icon(returned)?.getAttribute("aria-label")]).toEqual(["Approved", "Changes requested"]);
      // A name, never text: status words on screen belong to the StatusBadge.
      expect(host.querySelector("[data-rail-head]")!.textContent).not.toMatch(/Changes requested|Approved/);
    });

    it("without a recorded decision, says what happened in a word that is not a status", () => {
      const host = rail({ kind: "hidden" }, SENT_BACK, null, [
        { position: 0, name: "Team approver", status: "done" },
        { position: 1, name: "Legal reviewer", status: "returned" },
      ]);
      expect(step(host, "done").textContent).toBe("Team approverApproved");
      expect(step(host, "returned").textContent).toBe("Legal reviewerSent back");
    });

    it("a stage still to decide has no icon name: its line says it", () => {
      const host = rail({ kind: "open" });
      expect(icon(step(host, "current"))).toBeNull();
    });
  });

  it("a row that isn't decided is not a status, and is not a focus target", () => {
    const { region } = rows(rail({ kind: "open" }));
    expect(region.getAttribute("role")).toBeNull();
    expect(region.hasAttribute("tabindex")).toBe(false);
    expect(region.hasAttribute("data-decided")).toBe(false);
  });
});

describe("DecisionBar (the stacked layout)", () => {
  const bar = (access: DecisionAccess, row: DecisionRow = BUTTONS, decidedHere = false) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <DecisionBar access={access} row={row} decidedHere={decidedHere} onApprove={() => {}} onRequest={() => {}} />,
    );
    return host;
  };

  it("has the same two decisions for an approver", () => {
    const host = bar({ kind: "open" });
    expect([...host.querySelectorAll("button")].map((b) => [b.textContent, b.disabled])).toEqual([
      ["Approve", false],
      ["Request changes", false],
    ]);
  });

  it("greys them for the author but keeps them focusable, described by the reason beside them", () => {
    const host = bar({ kind: "blocked", reason: REASONS.wroteVersion.reason });
    document.body.append(host);
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((b) => [b.textContent, b.disabled, b.getAttribute("aria-disabled")])).toEqual([
      ["Approve", false, "true"],
      ["Request changes", false, "true"],
    ]);
    for (const b of buttons) {
      b.focus();
      expect(document.activeElement).toBe(b);
      expect(description(b)).toBe(REASONS.wroteVersion.reason);
    }
    expect(host.textContent).toContain(REASONS.wroteVersion.reason);
  });

  it("is absent for someone who isn't an approver, and for a version that was decided before", () => {
    expect(bar({ kind: "hidden" }).innerHTML).toBe("");
    expect(bar({ kind: "open" }, { kind: "line", text: "v3 is Active." }).innerHTML).toBe("");
    expect(bar({ kind: "open" }, SENT_BACK).innerHTML).toBe("");
  });

  it("confirms a decision made here with a line, hidden from assistive technology (the rail's status is the announcement)", () => {
    const host = bar({ kind: "open" }, { kind: "line", text: "You returned v3 to Maya Chen." }, true);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.querySelector("p")?.textContent).toBe("You returned v3 to Maya Chen.");
    expect(host.querySelector("p")?.getAttribute("aria-hidden")).toBe("true");
  });
});
