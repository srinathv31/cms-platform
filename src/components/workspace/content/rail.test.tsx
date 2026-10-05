// @vitest-environment happy-dom
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceSession, INITIAL_PREVIEW } from "../session/session-store";
import { Rail } from "./rail";

// The rail reads the session through these hooks; here they sit on a plain store (no autosave host).
const session = vi.hoisted(() => ({ current: null as null | ReturnType<typeof createWorkspaceSession> }));
vi.mock("../session/workspace-session", () => ({
  useWorkspaceSession: () => session.current!,
  useRailOpen: () => useSyncExternalStore(session.current!.subscribe, session.current!.getRailOpen, () => false),
  useRailTab: () => useSyncExternalStore(session.current!.subscribe, session.current!.getRailTab, () => null),
  usePreviewState: () =>
    useSyncExternalStore(session.current!.subscribe, session.current!.getPreview, () => INITIAL_PREVIEW),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

/** The page around the rail: the tab bar's Preview toggle, the template name, the document, and the rail with a button in it. */
function Page() {
  return (
    <>
      <button data-preview-toggle="" id="toggle">
        Preview
      </button>
      <textarea aria-label="Template name" id="name" defaultValue="Card offer terms" />
      <div className="ProseMirror" id="doc" tabIndex={0} />
      <Rail channels={<div />} preview={<button id="in-rail">Download PDF</button>}>
        <div />
      </Rail>
    </>
  );
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pressEscape = (target: HTMLElement) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  session.current = createWorkspaceSession();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Page />));
  act(() => session.current!.openPreview());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Escape in the rail", () => {
  it("closes the preview from inside the rail, and focus goes back to the Preview toggle", () => {
    $("in-rail").focus();
    pressEscape($("in-rail"));
    expect(session.current!.getPreview().open).toBe(false);
    expect(document.activeElement).toBe($("toggle"));
  });

  it("closes the preview from the document and leaves the caret there", () => {
    $("doc").focus();
    pressEscape($("doc"));
    expect(session.current!.getPreview().open).toBe(false);
    expect(document.activeElement).toBe($("doc"));
  });

  it("is spoken for by an open menu: that closes first, and the preview stays", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    $("in-rail").focus();
    pressEscape($("in-rail"));
    expect(session.current!.getPreview().open).toBe(true);
    menu.remove();
  });
});

describe("Escape in the template name", () => {
  /** What the name field does with the key (name-field.tsx): prevent it, put the old name back, leave the field. */
  function nameFieldHandlesEscape(field: HTMLTextAreaElement) {
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      field.value = "Card offer terms";
      field.blur();
    });
  }

  it("closes the preview when there is no edit to put back, with focus on the Preview toggle", () => {
    const field = $<HTMLTextAreaElement>("name");
    nameFieldHandlesEscape(field);
    field.focus();
    pressEscape(field);
    expect(session.current!.getPreview().open).toBe(false);
    expect(document.activeElement).toBe($("toggle"));
  });

  it("leaves the preview open while the name is mid-edit (the field takes that Escape), then closes it on the next", () => {
    const field = $<HTMLTextAreaElement>("name");
    nameFieldHandlesEscape(field);
    field.focus();
    field.value = "Card offer terms, edited";
    pressEscape(field);
    expect(field.value).toBe("Card offer terms");
    expect(session.current!.getPreview().open).toBe(true);
    pressEscape(document.body);
    expect(session.current!.getPreview().open).toBe(false);
    expect(document.activeElement).toBe($("toggle"));
  });
});

describe("The rail with review comments", () => {
  function CommentsPage({ preferred = true, count = 5 }: { preferred?: boolean; count?: number }) {
    return (
      <Rail
        channels={<div id="channels" />}
        comments={{ count, preferred, panel: <div id="threads">Threads</div> }}
        preview={<div id="preview-surface" />}
      >
        <div id="variables-panel" />
      </Rail>
    );
  }
  const shown = (id: string) => !$(id).closest("[hidden]");
  const tab = (name: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent?.startsWith(name))!;

  beforeEach(() => {
    // (The file's own beforeEach opened the preview.)
    act(() => session.current!.closePreview());
    act(() => root.render(<CommentsPage />));
  });

  it("adds Comments and Variables tabs, with the open count, and opens on Comments while something is waiting there", () => {
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(tab("Comments").textContent).toContain("5");
    expect(tab("Comments").getAttribute("aria-selected")).toBe("true");
    expect(shown("threads")).toBe(true);
    expect(shown("variables-panel")).toBe(false);
  });

  it("opens on Variables when nothing is waiting, and keeps both views mounted", () => {
    act(() => root.render(<CommentsPage preferred={false} count={0} />));
    expect(tab("Variables").getAttribute("aria-selected")).toBe("true");
    expect(shown("variables-panel")).toBe(true);
    expect(shown("threads")).toBe(false);
    expect($("threads")).toBeTruthy();
  });

  it("goes to Variables when the author picks it, and the choice sticks", () => {
    act(() => session.current!.selectRailView("variables"));
    expect(shown("variables-panel")).toBe(true);
    expect(shown("threads")).toBe(false);
    act(() => root.render(<CommentsPage preferred />));
    expect(shown("variables-panel")).toBe(true);
  });

  it("brings the comments back when a thread is shown, and draws no header of its own while the preview is open", () => {
    act(() => session.current!.selectRailView("variables"));
    act(() => session.current!.showComments());
    expect(shown("threads")).toBe(true);
    act(() => session.current!.openPreview());
    // The preview surface draws the header then (Preview | Comments | Variables); the rail adds none.
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(shown("threads")).toBe(false);
    act(() => session.current!.showComments());
    expect(shown("threads")).toBe(true);
  });

  it("is the rail it was when the template has no comments", () => {
    act(() =>
      root.render(
        <Rail channels={<div id="channels" />}>
          <div id="variables-panel" />
        </Rail>,
      ),
    );
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(shown("variables-panel")).toBe(true);
  });
});

describe("The rail of an imported template", () => {
  function ImportedPage({ arrival = false }: { arrival?: boolean }) {
    return (
      <>
        <button data-preview-toggle="" id="toggle">
          Preview
        </button>
        <Rail
          channels={<div id="channels" />}
          original
          takeArrival={() => arrival}
          footer={<button id="copilot">Copilot prompt</button>}
          preview={<button id="in-rail">Original file</button>}
        >
          <div id="variables-panel" />
        </Rail>
      </>
    );
  }
  const shown = (id: string) => !$(id).closest("[hidden]");
  const tab = (name: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent?.startsWith(name));
  const rail = () => document.querySelector<HTMLElement>('[data-slot="rail"]')!;

  beforeEach(() => {
    act(() => session.current!.closePreview());
    act(() => root.render(<ImportedPage />));
  });

  it("has Original and Variables tabs, on Variables, with the footer row at the end of the normal rail", () => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toBe(tab("Original"));
    expect(tabs[1]).toBe(tab("Variables"));
    expect(tab("Variables")!.getAttribute("aria-selected")).toBe("true");
    expect(shown("variables-panel")).toBe(true);
    expect(shown("copilot")).toBe(true);
  });

  it("widens on the Original view when Original is picked, and hides the normal rail", () => {
    act(() => tab("Original")!.click());
    expect(session.current!.getPreview()).toMatchObject({ open: true, view: "original" });
    expect(rail().getAttribute("aria-label")).toBe("Original");
    expect(rail().dataset.view).toBe("original");
    expect(shown("variables-panel")).toBe(false);
  });

  it("is put away by Escape, and focus goes back to the Original tab", async () => {
    act(() => tab("Original")!.click());
    $("in-rail").focus();
    pressEscape($("in-rail"));
    expect(session.current!.getPreview().open).toBe(false);
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(document.activeElement).toBe(tab("Original"));
  });

  it("opens widened on the Original view when the page arrives from an import, without the width transition", () => {
    act(() => root.render(<></>));
    act(() => root.render(<ImportedPage arrival />));
    expect(session.current!.getPreview()).toMatchObject({ open: true, view: "original" });
    expect(rail().style.transition).toBe("none");
  });
});
