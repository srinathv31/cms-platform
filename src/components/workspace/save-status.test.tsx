// @vitest-environment happy-dom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "./session/session-store";

// The draft's undo and redo buttons hold their place from the first paint: the server renders both,
// greyed out, before the save status, so neither the editor's history arriving nor the status changing
// moves anything (the zero-layout-shift check in e2e/principles.spec.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/server/queries/base-version", () => ({ getBaseVersion: vi.fn() }));

const { SaveStatus } = await import("./save-status");
const { WorkspaceSessionProvider, useWorkspaceSession } = await import("./session/workspace-session");

let session: WorkspaceSession | null;

/** Hands the provider's session to the test, which plays the editor's part (`setHistory`). */
function GrabSession() {
  const own = useWorkspaceSession();
  useEffect(() => {
    session = own;
  }, [own]);
  return null;
}

const page = (children: ReactNode = <SaveStatus templateId="UC-ABC123" basedOn={1} activeNumber={null} />) => (
  <WorkspaceSessionProvider>
    <GrabSession />
    {children}
  </WorkspaceSessionProvider>
);

/** The history buttons and the status, in the order they're laid out. */
function layout(root: ParentNode) {
  return [...root.querySelectorAll('button[aria-label="Undo"], button[aria-label="Redo"], [aria-live="polite"]')].map((el) =>
    el.matches("button") ? `${el.getAttribute("aria-label")}${el.hasAttribute("data-disabled") ? " (greyed)" : ""}` : el.textContent,
  );
}

describe("SaveStatus, on the server", () => {
  it("renders undo and redo, both greyed out, before the status", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(page());
    expect(layout(host)).toEqual(["Undo (greyed)", "Redo (greyed)", "Saved"]);
    for (const button of host.querySelectorAll("button[aria-label]")) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
    }
  });
});

describe("SaveStatus, in the browser", () => {
  let root: Root;
  let container: HTMLElement;
  const undo = vi.fn();
  const redo = vi.fn();
  const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

  beforeEach(async () => {
    session = null;
    undo.mockClear();
    redo.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(page()));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps both buttons, greyed out, until the editor's history is ready", () => {
    expect(layout(container)).toEqual(["Undo (greyed)", "Redo (greyed)", "Saved"]);
  });

  it("greys out only the one with nothing to do, and a greyed one does nothing", async () => {
    await act(async () => session!.setHistory({ canUndo: true, canRedo: false, undo, redo }));
    expect(layout(container)).toEqual(["Undo", "Redo (greyed)", "Saved"]);

    await act(async () => button("Redo").click());
    expect(redo).not.toHaveBeenCalled();
    await act(async () => button("Undo").click());
    expect(undo).toHaveBeenCalledOnce();
  });

  it("keeps both when the history goes away (another tab)", async () => {
    await act(async () => session!.setHistory({ canUndo: true, canRedo: true, undo, redo }));
    expect(layout(container)).toEqual(["Undo", "Redo", "Saved"]);
    await act(async () => session!.setHistory(null));
    expect(layout(container)).toEqual(["Undo (greyed)", "Redo (greyed)", "Saved"]);
  });
});
