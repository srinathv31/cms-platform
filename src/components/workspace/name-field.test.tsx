// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveFields } from "./autosave/autosave-scheduler";
import { createWorkspaceSession, type WorkspaceSession } from "./session/session-store";

// The name field: what it hands to autosave, and how Enter, Esc, an emptied field and the arrival
// from "New template" (the one-shot "just created" cookie) behave.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let session: WorkspaceSession;

vi.mock("next/navigation", () => ({
  useParams: () => ({ team: "coral-offers", templateId: "UC-ABC123" }),
}));
vi.mock("./session/workspace-session", () => ({ useWorkspaceSession: () => session }));

const { NameField } = await import("./name-field");

const replaceState = vi.spyOn(window.history, "replaceState");
const pushState = vi.spyOn(window.history, "pushState");

/** What `createTemplate` leaves behind as it redirects. */
const markJustCreated = (templateId: string) => {
  document.cookie = `ucomp_created=${templateId}; path=/; max-age=60; samesite=lax`;
};
const justCreatedCookie = () =>
  document.cookie.split("; ").find((part) => part.startsWith("ucomp_created=")) ?? null;

let root: Root;
let container: HTMLElement;
let save: ReturnType<typeof vi.fn<(fields: SaveFields) => void>>;

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

const field = () => container.querySelector("textarea") as HTMLTextAreaElement;

async function typeInto(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(el: HTMLElement, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  document.cookie = "ucomp_created=; path=/; max-age=0";
  replaceState.mockClear();
  pushState.mockClear();
  save = vi.fn();
  session = createWorkspaceSession();
  session.attach(save);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("NameField", () => {
  it("is plain text when the version can't be edited", async () => {
    await render(<NameField name="Rate Change Notice" editable={false} />);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Rate Change Notice");
  });

  it("saves the trimmed name as the author types, and nothing while it is empty", async () => {
    await render(<NameField name="Rate Change Notice" editable />);
    await act(async () => field().focus());

    await typeInto(field(), "  Spring Travel  ");
    expect(save).toHaveBeenLastCalledWith({ name: "Spring Travel" });

    save.mockClear();
    await typeInto(field(), "   ");
    expect(save).not.toHaveBeenCalled();
  });

  it("goes back to the name it started with when it is left empty", async () => {
    await render(<NameField name="Rate Change Notice" editable />);
    await act(async () => field().focus());
    await typeInto(field(), "S"); // saved on the way down
    await typeInto(field(), "");
    save.mockClear();

    await act(async () => field().blur());
    expect(field().value).toBe("Rate Change Notice");
    expect(save).toHaveBeenCalledWith({ name: "Rate Change Notice" });
  });

  it("Esc puts the old name back, saving it only if a different one already went out", async () => {
    await render(<NameField name="Rate Change Notice" editable />);
    await act(async () => field().focus());
    await typeInto(field(), "Something else");
    save.mockClear();

    await press(field(), "Escape");
    expect(field().value).toBe("Rate Change Notice");
    expect(save).toHaveBeenCalledWith({ name: "Rate Change Notice" });
    expect(document.activeElement).not.toBe(field());

    // Nothing typed this time: nothing to put back.
    await act(async () => field().focus());
    save.mockClear();
    await press(field(), "Escape");
    expect(save).not.toHaveBeenCalled();
  });

  it("Enter leaves the field and moves into the document", async () => {
    const focus = vi.fn();
    session.setEditor({
      focus,
      focusThread: () => {},
      getBlockRect: () => null,
      getThreadRect: () => null,
      subscribeBlockRects: () => () => {},
      requestComment: () => {},
    });
    await render(<NameField name="Rate Change Notice" editable />);
    await act(async () => field().focus());

    await press(field(), "Enter");
    expect(focus).toHaveBeenCalledWith("first-section");
    expect(document.activeElement).not.toBe(field());
  });

  it("arriving just after creating the template selects the whole name, once, and leaves the address alone", async () => {
    markJustCreated("UC-ABC123");
    await render(<NameField name="Card offer terms" editable />);

    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe("Card offer terms".length);
    // The flag is taken as it is read: a reload or a later visit is an ordinary arrival.
    expect(justCreatedCookie()).toBeNull();
    // The redirect already went to the template's own address: no history call, nothing for Next's
    // own history updates to race with.
    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();

    await act(async () => field().blur());
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(<NameField name="Card offer terms" editable />);
    expect(document.activeElement).not.toBe(field());
  });

  it("an ordinary arrival, or one at another template than the one just created, leaves the name alone", async () => {
    await render(<NameField name="Card offer terms" editable />);
    expect(document.activeElement).not.toBe(field());

    await act(async () => root.unmount());
    root = createRoot(container);
    markJustCreated("UC-ZZZ999");
    await render(<NameField name="Card offer terms" editable />);
    expect(document.activeElement).not.toBe(field());
    expect(justCreatedCookie()).toBe("ucomp_created=UC-ZZZ999");
  });

  it("keeps what the author typed when the page re-renders around the field", async () => {
    await render(<NameField name="Card offer terms" editable />);
    await act(async () => field().focus());
    await typeInto(field(), "Spring Trav");

    // A re-render with the server's old name (a refresh that beat the autosave) must not win.
    await render(<NameField name="Card offer terms" editable />);
    expect(field().value).toBe("Spring Trav");
    await typeInto(field(), "Spring Travel");
    await render(<NameField name="Card offer terms" editable />);
    expect(field().value).toBe("Spring Travel");
  });

  it("leaves the name alone on a page that isn't editable, even just after creating it", async () => {
    markJustCreated("UC-ABC123");
    await render(<NameField name="Card offer terms" editable={false} />);
    expect(container.querySelector("textarea")).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
