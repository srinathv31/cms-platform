// @vitest-environment happy-dom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/domain/review-types";
import type { BaseVersionContent } from "@/server/queries/base-version";
import type { SaveFields } from "./autosave/autosave-scheduler";
import type { WorkspaceSession } from "./session/session-store";

// The draft's undo and redo buttons hold their place from the first paint: the server renders both,
// greyed out, before the save status, so neither the editor's history arriving nor the status changing
// moves anything (the zero-layout-shift check in e2e/principles.spec.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BaseAnswer = ActionResult<{ base: BaseVersionContent }>;
/** The base-version route as the browser reaches it: handed the URL fetched, it gives the body (or the network fails). */
const baseRoute = vi.hoisted(() => vi.fn<(url: string) => Promise<BaseAnswer>>());
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    const body = await baseRoute(url);
    return { status: body.ok ? 200 : 409, json: async () => body };
  }),
);
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(() => "revert-toast"), { error: vi.fn(), dismiss: vi.fn() }) }));
// The session's autosave host, without the network: what it is handed is the session's business.
const autosave = vi.hoisted(() => ({ save: vi.fn<(fields: SaveFields) => void>(), flush: async () => {} }));
vi.mock("./autosave/use-draft-autosave", () => ({ useDraftAutosave: () => ({ ...autosave, status: "saved" }) }));

const { SaveStatus } = await import("./save-status");
const { WorkspaceSessionProvider, useWorkspaceSession } = await import("./session/workspace-session");
const { toast } = await import("sonner");
const { GENERIC_FAILURE } = await import("@/components/versions/action-dialog");

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

// "Revert to v1" reads the version from the server: one read at a time, the menu greyed out with
// "Reverting…" meanwhile, a failure in a toast, and an Undo in the success toast that goes as soon as
// anything else is edited, so it can never put the old content over a newer edit.
describe("Revert to v1", () => {
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const OPENING: SaveFields = { body: doc("Opening"), variables: [], channels: ["pdf"], emailSubject: null, emailPreheader: null, sampleSets: [] };
  const V1: BaseVersionContent = {
    number: 1,
    name: "Rate notice",
    body: doc("Version 1"),
    variables: [],
    channels: ["pdf"],
    emailSubject: null,
    emailPreheader: null,
    sampleSets: [],
  };

  let root: Root;
  let container: HTMLElement;
  /** What the Content page would show: the session hands it new values to put on screen. */
  const content = vi.fn();
  /** What the header's name field would show. */
  const nameField = vi.fn();
  /** What the session handed to autosave. */
  const saved: SaveFields[] = [];
  let removeContent: () => void;

  const sleep = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))));
  async function until(check: () => unknown) {
    for (let i = 0; i < 40; i++) {
      if (check()) return;
      await sleep(25);
    }
    throw new Error("timed out waiting for the UI");
  }
  async function click(el: Element) {
    await act(async () => {
      const init = { bubbles: true, cancelable: true, button: 0 };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mousedown", init));
      el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      el.dispatchEvent(new MouseEvent("click", init));
    });
  }
  const trigger = () => container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  const menu = () => document.querySelector('[role="menu"]');
  const item = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes("Revert to v1"))!;
  /** The item's lines a sighted person reads (a line kept only to hold the menu's width is invisible). */
  const visibleText = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>("span")].filter((s) => !s.children.length && !s.closest(".invisible")).map((s) => s.textContent);

  async function openMenu() {
    await click(trigger());
    await until(menu);
  }

  /** The success toast's Undo, as sonner was handed it. */
  function undoToast() {
    const call = vi.mocked(toast).mock.calls.find(([message]) => message === "Reverted to v1");
    if (!call) throw new Error("no revert toast");
    const { onClick } = call[1]!.action as { onClick: (event: React.MouseEvent<HTMLButtonElement>) => void };
    return { undo: () => act(async () => onClick(new MouseEvent("click") as unknown as React.MouseEvent<HTMLButtonElement>)) };
  }

  beforeEach(async () => {
    session = null;
    baseRoute.mockReset();
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.dismiss).mockClear();
    content.mockClear();
    nameField.mockClear();
    saved.length = 0;
    autosave.save.mockImplementation((fields) => {
      saved.push(fields);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(page()));
    // The Content page, editable: it binds the draft and can show the version's fields. The header's
    // name field shows the draft's name, renamed since it was started from v1.
    await act(async () => {
      session!.bind({ versionId: "v_draft", rev: 4 });
      removeContent = session!.addRestoreTarget({ opening: OPENING, restore: content });
      session!.addRestoreTarget({ opening: { name: "Rate notice (renamed)" }, restore: nameField });
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("reads the base of the draft on screen, by its version id", async () => {
    baseRoute.mockResolvedValue({ ok: true, base: V1 });
    await openMenu();
    await click(item());
    await until(() => !menu());
    expect(baseRoute).toHaveBeenCalledWith("/api/templates/UC-ABC123/base-version?draft=v_draft");
    expect(content).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Reverted to v1", expect.objectContaining({ duration: 10_000 }));
  });

  it("while the version loads, greys the item out with Reverting… and doesn't start a second revert", async () => {
    let answer: (value: BaseAnswer) => void = () => {};
    baseRoute.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await openMenu();
    await click(item());

    // The menu stays open while it loads, so the state shows at the control.
    expect(menu()).not.toBeNull();
    expect(item().hasAttribute("data-disabled")).toBe(true);
    expect(item().getAttribute("aria-busy")).toBe("true");
    expect(visibleText(item())).toEqual(["Revert to v1", "Reverting…"]);

    await click(item());
    await click(item());
    expect(baseRoute).toHaveBeenCalledTimes(1);

    await act(async () => answer({ ok: true, base: V1 }));
    await until(() => !menu());
    expect(content).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls.filter(([message]) => message === "Reverted to v1")).toHaveLength(1);
  });

  it("shows a failure in a toast when the read throws, and offers the item again", async () => {
    baseRoute.mockRejectedValue(new Error("network down"));
    await openMenu();
    await click(item());
    await until(() => vi.mocked(toast.error).mock.calls.length > 0);
    expect(toast.error).toHaveBeenCalledWith(GENERIC_FAILURE);
    expect(content).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();

    await until(() => !menu());
    await openMenu();
    expect(item().hasAttribute("data-disabled")).toBe(false);
    expect(visibleText(item())).toEqual(["Revert to v1", "Where this draft started. It stays open."]);
  });

  it("shows the server's refusal in a toast", async () => {
    baseRoute.mockResolvedValue({ ok: false, code: "no_draft_to_revert", reason: "There is no draft to revert." });
    await openMenu();
    await click(item());
    await until(() => vi.mocked(toast.error).mock.calls.length > 0);
    expect(toast.error).toHaveBeenCalledWith("There is no draft to revert.");
    expect(content).not.toHaveBeenCalled();
  });

  it("takes the Undo away as soon as anything is typed, and Undo then changes nothing", async () => {
    baseRoute.mockResolvedValue({ ok: true, base: V1 });
    await openMenu();
    await click(item());
    await until(() => !menu());
    const { undo } = undoToast();
    expect(toast.dismiss).not.toHaveBeenCalled();

    await act(async () => session!.save({ body: doc("Typed after the revert") }));
    expect(toast.dismiss).toHaveBeenCalledWith("revert-toast");

    content.mockClear();
    await undo();
    expect(content).not.toHaveBeenCalled();
  });

  it("takes the Undo away when the content leaves the screen (another tab)", async () => {
    baseRoute.mockResolvedValue({ ok: true, base: V1 });
    await openMenu();
    await click(item());
    await until(() => !menu());

    await act(async () => removeContent());
    expect(toast.dismiss).toHaveBeenCalledWith("revert-toast");
  });

  it("puts the content back when Undo is pressed before anything else changed", async () => {
    baseRoute.mockResolvedValue({ ok: true, base: V1 });
    await openMenu();
    await click(item());
    await until(() => !menu());
    content.mockClear();

    await undoToast().undo();
    expect(content).toHaveBeenCalledTimes(1);
    expect(content.mock.calls[0]![0]).toMatchObject({ body: doc("Opening") });
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it("greys the item out while the page is inert (Submit), and offers it again after", async () => {
    baseRoute.mockResolvedValue({ ok: true, base: V1 });
    let letGo = () => {};
    await act(async () => {
      letGo = session!.makeInert();
    });
    await openMenu();
    expect(item().hasAttribute("data-disabled")).toBe(true);
    await click(item());
    expect(baseRoute).not.toHaveBeenCalled();

    await act(async () => letGo());
    expect(item().hasAttribute("data-disabled")).toBe(false);
  });

  it("takes the Undo away when Submit holds the page", async () => {
    baseRoute.mockResolvedValue({ ok: true, base: V1 });
    await openMenu();
    await click(item());
    await until(() => !menu());
    const { undo } = undoToast();

    await act(async () => void session!.makeInert());
    expect(toast.dismiss).toHaveBeenCalledWith("revert-toast");
    content.mockClear();
    await undo();
    expect(content).not.toHaveBeenCalled();
  });

  it("puts focus on the header's status row, found through the session, when the menu went away with the changes", async () => {
    // Nothing to revert to but the opening: once that is put back, the status is no menu, and its trigger goes.
    await act(async () => root.render(page(<SaveStatus templateId="UC-ABC123" basedOn={null} activeNumber={null} />)));
    await act(async () => session!.save({ body: doc("Typed") }));
    // The status row as `StatusRow` registers it: by name, whatever its label or markup.
    const row = document.createElement("div");
    row.tabIndex = -1;
    document.body.append(row);
    session!.focusTargets.register("statusRow", row, "draft");

    await openMenu();
    const opening = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.includes("Revert to when you opened it"),
    )!;
    await click(opening);
    await until(() => document.activeElement === row);
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  // The name is a version field: reverting to v1 brings v1's name back too, and Undo the draft's.
  it("puts v1's name in the name field and saves it, and Undo puts the draft's name back", async () => {
    baseRoute.mockResolvedValue({ ok: true, base: V1 });
    await openMenu();
    await click(item());
    await until(() => !menu());
    expect(nameField).toHaveBeenCalledTimes(1);
    expect(nameField.mock.calls[0]![0]).toEqual(expect.objectContaining({ name: "Rate notice" }));
    expect(saved.at(-1)).toMatchObject({ name: "Rate notice", body: doc("Version 1") });

    await undoToast().undo();
    expect(nameField.mock.calls.at(-1)![0]).toEqual(expect.objectContaining({ name: "Rate notice (renamed)" }));
    expect(saved.at(-1)).toMatchObject({ name: "Rate notice (renamed)", body: doc("Opening") });
  });
});
