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
