// @vitest-environment happy-dom
import { act, createRef, useEffect, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputKey } from "@/domain/review-outputs";
import type { StepView } from "@/domain/review-types";
import type { Channel } from "@/domain/types";
import { DecisionBar } from "./decision-bar";
import { approveWaitsOn, type DecisionAccess } from "./decision-model";
import { DecisionRail } from "./decision-rail";
import { useViewedOutputs } from "./use-viewed-outputs";

// Decision 0037 on the review screen: Approve waits until every output of the round has rendered on the
// approver's screen, and asks the domain's own rule (`outputsRefusal`, through `approveWaitsOn`) with the
// set `useViewedOutputs` keeps. Request changes never waits. The set lasts a reload in the same tab.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STEPS: StepView[] = [{ position: 0, name: "Team approver", status: "current" }];
const NOW = "2026-10-05T02:29:00.000Z";
const OPEN: DecisionAccess = { kind: "open" };

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

/** The rail as the review screen wires it: the viewed set, the domain's answer, the decision row. */
function Screen({ versionId, channels, seeRef }: { versionId: string; channels: Channel[]; seeRef: RefObject<((o: OutputKey) => void) | null> }) {
  const { viewed, onViewed } = useViewedOutputs("jordan", versionId, 1);
  useEffect(() => {
    seeRef.current = onViewed;
  }, [seeRef, onViewed]);
  return (
    <DecisionRail
      steps={STEPS}
      nowIso={NOW}
      access={OPEN}
      approveBlocked={approveWaitsOn(OPEN, { state: "in_review", channels }, viewed)}
      row={{ kind: "buttons" }}
      onApprove={() => {}}
      onRequest={() => {}}
      approveRef={createRef()}
      requestRef={createRef()}
      regionRef={createRef()}
    >
      <p>body</p>
    </DecisionRail>
  );
}

function mount(versionId: string, channels: Channel[]) {
  const seeRef = createRef<(o: OutputKey) => void>();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Screen versionId={versionId} channels={channels} seeRef={seeRef} />));
  const button = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
  return {
    host,
    approve: () => button("Approve"),
    request: () => button("Request changes"),
    stageLine: () => host.querySelector('[data-step="current"]')!.textContent,
    see: (output: OutputKey) => act(() => seeRef.current!(output)),
  };
}

const blocked = (b: HTMLButtonElement) => b.getAttribute("aria-disabled") === "true";

describe("Approve waits on every output", () => {
  it("an alert: blocked with what's left, until Push on both phones and SMS have been on screen", () => {
    const screen = mount("ver_alert", ["push", "sms"]);
    expect(blocked(screen.approve())).toBe(true);
    expect(blocked(screen.request()), "Request changes never waits").toBe(false);
    expect(screen.stageLine()).toContain("Preview Push (iPhone, Android) and SMS first.");
    // The stage's line is Approve's description, not Request changes'.
    expect(screen.approve().getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.request().getAttribute("aria-describedby")).toBeNull();

    screen.see("push.ios");
    screen.see("sms");
    expect(blocked(screen.approve())).toBe(true);
    expect(screen.stageLine()).toContain("Preview Push (Android) first.");

    screen.see("push.android");
    expect(blocked(screen.approve())).toBe(false);
    expect(screen.stageLine()).toContain("Waiting for a decision");
  });

  it("a document: the same row geometry blocked and available", () => {
    const screen = mount("ver_doc", ["pdf", "web"]);
    const region = screen.host.querySelector("[data-decision]")!;
    expect(region.className).toContain("h-8");
    expect(blocked(screen.approve())).toBe(true);
    screen.see("web");
    screen.see("pdf");
    expect(blocked(screen.approve())).toBe(false);
    expect(region.className).toContain("h-8");
  });

  it("keeps what was viewed for the round in this tab's session, so a reload doesn't start over", () => {
    const first = mount("ver_reload", ["pdf"]);
    first.see("pdf");
    expect(JSON.parse(window.sessionStorage.getItem("ucomp:viewed-outputs:jordan:ver_reload:1")!)).toEqual(["pdf"]);
    act(() => root!.unmount());

    // A reload: what the tab stored is read back (for a version this page load hasn't seen yet).
    window.sessionStorage.setItem("ucomp:viewed-outputs:jordan:ver_stored:1", JSON.stringify(["web", "not-an-output"]));
    const again = mount("ver_stored", ["web"]);
    expect(blocked(again.approve())).toBe(false);
  });

  it("works without storage: viewing still counts for the page's life", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const screen = mount("ver_nostorage", ["email"]);
    expect(blocked(screen.approve())).toBe(true);
    screen.see("email");
    expect(blocked(screen.approve())).toBe(false);
  });
});

describe("approveWaitsOn", () => {
  it("only while the pair is the viewer's to press and the round is in review", () => {
    const facts = { state: "in_review" as const, channels: ["pdf"] as Channel[] };
    expect(approveWaitsOn(OPEN, facts, [])).toBe("Preview PDF first.");
    expect(approveWaitsOn(OPEN, facts, ["pdf"])).toBeNull();
    expect(approveWaitsOn({ kind: "blocked", reason: "You submitted this version." }, facts, [])).toBeNull();
    expect(approveWaitsOn({ kind: "hidden" }, facts, [])).toBeNull();
    expect(approveWaitsOn(OPEN, { ...facts, state: "active" }, [])).toBeNull();
  });
});

describe("DecisionBar (the stacked layout)", () => {
  it("greys Approve alone, described by the reason beside the pair", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <DecisionBar
        access={OPEN}
        approveBlocked="Preview SMS first."
        row={{ kind: "buttons" }}
        decidedHere={false}
        onApprove={() => {}}
        onRequest={() => {}}
      />,
    );
    document.body.append(host);
    const [approve, request] = [...host.querySelectorAll("button")];
    expect([approve.textContent, approve.getAttribute("aria-disabled")]).toEqual(["Approve", "true"]);
    expect([request.textContent, request.getAttribute("aria-disabled")]).toEqual(["Request changes", null]);
    const reason = document.getElementById(approve.getAttribute("aria-describedby")!);
    expect(reason?.textContent).toBe("Preview SMS first.");
  });
});
