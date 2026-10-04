// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveFields } from "./autosave/autosave-scheduler";
import { createWorkspaceSession, type WorkspaceSession } from "./session/session-store";

// The name field: what it hands to autosave, and how Enter, Esc, an emptied field and the arrival
// from "New template" (?created=1) behave.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let session: WorkspaceSession;
let search = "";

vi.mock("next/navigation", () => ({
  usePathname: () => "/coral-offers/templates/UC-ABC123",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("./session/workspace-session", () => ({ useWorkspaceSession: () => session }));

const { NameField } = await import("./name-field");

const replaceState = vi.spyOn(window.history, "replaceState");

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
  search = "";
  replaceState.mockClear();
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
    session.setEditor({ focus });
    await render(<NameField name="Rate Change Notice" editable />);
    await act(async () => field().focus());

    await press(field(), "Enter");
    expect(focus).toHaveBeenCalledWith("first-section");
    expect(document.activeElement).not.toBe(field());
  });

  it("arriving with ?created=1 selects the whole name and drops the param", async () => {
    search = "created=1";
    await render(<NameField name="Card offer terms" editable />);

    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe("Card offer terms".length);
    // Dropped with the native history call: no router transition to re-render the page mid-typing.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/coral-offers/templates/UC-ABC123");
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

  it("leaves the name alone on a page that isn't editable, even with ?created=1", async () => {
    search = "created=1";
    await render(<NameField name="Card offer terms" editable={false} />);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
