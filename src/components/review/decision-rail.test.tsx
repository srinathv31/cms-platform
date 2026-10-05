// @vitest-environment happy-dom
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StepView } from "@/domain/review-types";
import type { DecisionAccess } from "./decision-model";
import { DecisionBar } from "./decision-bar";
import { BLOCKED_ID, DecisionRail } from "./decision-rail";

const STEPS: StepView[] = [{ position: 0, name: "Team approver", status: "current" }];
const NOW = "2026-10-05T02:29:00.000Z";

function rail(access: DecisionAccess, line: string | null = null) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <DecisionRail
      steps={STEPS}
      nowIso={NOW}
      access={access}
      line={line}
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

  it("the author gets them dim, and the reason stands where the stage says it is waiting, described by the buttons", () => {
    const host = rail({ kind: "blocked", reason: "You submitted this version." });
    const { region, buttons, step } = rows(host);
    expect(region.className).toContain("h-8");
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
    expect(step).toContain("You submitted this version.");
    expect(step).not.toContain("Waiting for a decision");
    for (const b of buttons) expect(b.getAttribute("aria-describedby")).toBe(BLOCKED_ID);
    expect(host.querySelector(`#${BLOCKED_ID}`)?.textContent).toBe("You submitted this version.");
  });

  it("someone who isn't an approver gets no buttons, and the row stays", () => {
    const { region, buttons, step } = rows(rail({ kind: "hidden" }));
    expect(buttons).toHaveLength(0);
    expect(region.className).toContain("h-8");
    expect(step).toContain("Waiting for a decision");
  });

  it("once decided, a status line stands in the row and can take focus", () => {
    const { region, buttons } = rows(rail({ kind: "blocked", reason: "x" }, "You approved v3."));
    expect(buttons).toHaveLength(0);
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("tabindex")).toBe("-1");
    expect(region.hasAttribute("data-decided")).toBe(true);
    expect(region.textContent).toBe("You approved v3.");
    expect(region.className).toContain("h-8");
  });

  it("a row that isn't decided is not a status, and is not a focus target", () => {
    const { region } = rows(rail({ kind: "open" }));
    expect(region.getAttribute("role")).toBeNull();
    expect(region.hasAttribute("tabindex")).toBe(false);
    expect(region.hasAttribute("data-decided")).toBe(false);
  });
});

describe("DecisionBar (the stacked layout)", () => {
  const bar = (access: DecisionAccess, line: string | null = null, decidedHere = false) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <DecisionBar access={access} line={line} decidedHere={decidedHere} onApprove={() => {}} onRequest={() => {}} />,
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

  it("dims them for the author, with the reason beside them", () => {
    const host = bar({ kind: "blocked", reason: "You submitted this version." });
    expect([...host.querySelectorAll("button")].map((b) => b.disabled)).toEqual([true, true]);
    expect(host.textContent).toContain("You submitted this version.");
  });

  it("is absent for someone who isn't an approver, and for a version that was decided before", () => {
    expect(bar({ kind: "hidden" }).innerHTML).toBe("");
    expect(bar({ kind: "open" }, "v3 is Active.").innerHTML).toBe("");
  });

  it("confirms a decision made here with a line, hidden from assistive technology (the rail's status is the announcement)", () => {
    const host = bar({ kind: "open" }, "You returned v3 to Maya Chen.", true);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.querySelector("p")?.textContent).toBe("You returned v3 to Maya Chen.");
    expect(host.querySelector("p")?.getAttribute("aria-hidden")).toBe("true");
  });
});
