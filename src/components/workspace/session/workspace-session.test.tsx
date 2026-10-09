// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftPatch } from "@/domain/types";
import type { DraftBinding, WorkspaceSession } from "./session-store";

// The workspace as the header puts it together on every tab: the binding, the name field and the save
// status, over the real autosave (only `fetch` is faked). No Content page is on screen, as on Versions,
// Usage or Activity.
//   - A rename there saves (handoff review I1): the header binds the session, not only the Content tab.
//   - A save the server refuses for good holds the page still and offers Reload (I6).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useParams: () => ({ team: "coral-offers", templateId: "UC-ABC123" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

const { WorkspaceSessionProvider, BindDraft, useWorkspaceSession } = await import("./workspace-session");
const { NameField } = await import("../name-field");
const { SaveStatus, SaveStopped } = await import("../save-status");

let session: WorkspaceSession;
let root: Root;
let container: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function GrabSession() {
  const own = useWorkspaceSession();
  useEffect(() => {
    session = own;
  }, [own]);
  return null;
}

/** The header of a draft, as the layout renders it on any tab. */
const header = (draft: DraftBinding | null = { versionId: "v_draft", rev: 4 }) => (
  <WorkspaceSessionProvider>
    <GrabSession />
    <BindDraft draft={draft} />
    <NameField name="Rate notice" editable={draft !== null} />
    <SaveStatus templateId="UC-ABC123" basedOn={null} activeNumber={null} />
    <SaveStopped />
  </WorkspaceSessionProvider>
);

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const saved = (rev: number) => reply(200, { ok: true, rev, savedAt: "2026-10-04T10:00:00.000Z" });
const conflict = () => reply(409, { ok: false, error: "conflict", rev: 9, message: "This draft changed elsewhere." });

const sent = (index: number) => {
  const [url, init] = fetchMock.mock.calls[index]!;
  return { url: String(url), patch: JSON.parse(init!.body as string) as DraftPatch };
};

const nameField = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Template name"]')!;
const statusText = () => container.querySelector('[aria-live="polite"]')?.textContent;
const stoppedText = () => container.querySelector('[data-slot="save-stopped"] [role="alert"]')?.textContent ?? null;
const reloadButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reload") ?? null;

async function rename(value: string) {
  await act(async () => {
    const el = nameField();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => saved(5));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a rename on a tab without the Content page (I1)", () => {
  it("is sent to the draft the header shows, and the status goes Saving…, then Saved", async () => {
    await act(async () => root.render(header()));
    expect(statusText()).toBe("Saved");

    await rename("Rate notice — 2027");
    expect(statusText()).toBe("Saving…");
    await wait(800);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0).url).toBe("/api/drafts/v_draft");
    expect(sent(0).patch).toMatchObject({ rev: 4, name: "Rate notice — 2027" });
    expect(statusText()).toBe("Saved");
  });

  it("is one session with the Content page: binding the same draft again keeps the rev autosave has reached", async () => {
    await act(async () => root.render(header()));
    await rename("First");
    await wait(800);
    expect(sent(0).patch.rev).toBe(4);

    // The Content tab opens later and binds the same draft, from data read when the rev was 4.
    await act(async () => session.bind({ versionId: "v_draft", rev: 4 }));
    await rename("Second");
    await wait(800);
    expect(sent(1).patch).toMatchObject({ rev: 5, name: "Second" });
    expect(sent(1).patch.sessionKey).toBe(sent(0).patch.sessionKey);
  });

  it("binds nothing on a version that can't be edited, and lets go of the draft when the header says so", async () => {
    await act(async () => root.render(header()));
    expect(session.getBinding()).toEqual({ versionId: "v_draft", rev: 4 });
    await act(async () => root.render(header(null)));
    expect(session.getBinding()).toBeNull();
  });
});

describe("a save the server refuses for good (I6)", () => {
  async function stopOnConflict() {
    fetchMock.mockImplementationOnce(async () => conflict());
    await act(async () => root.render(header()));
    await rename("Mine");
    await wait(800);
  }

  it("holds the page still, says the change can't be saved, and offers Reload", async () => {
    await stopOnConflict();
    expect(session.getStatus()).toEqual({
      status: "error",
      error: "Your latest changes can't be saved — this draft changed elsewhere.",
      stopped: true,
    });
    // The status stays short; the line under it says why, plainly, beside Reload.
    expect(statusText()).toBe("Not saved.");
    expect(stoppedText()).toBe("Your latest changes can't be saved — this draft changed elsewhere.");
    expect(session.getInert()).toBe(true);
    expect(nameField().readOnly).toBe(true);
    expect(reloadButton()).not.toBeNull();
    // A secondary action: the screen's one black button is Submit's.
    expect(reloadButton()!.className).toContain("border-border");
  });

  it("reloads the page from its Reload", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    await stopOnConflict();
    await act(async () => reloadButton()!.click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("sends nothing more, whatever is tried", async () => {
    await stopOnConflict();
    await act(async () => session.save({ name: "Typed anyway" }));
    await act(async () => session.flush());
    await wait(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows no Reload and holds nothing while saving just retries", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => root.render(header()));
    await rename("Offline");
    await wait(800);
    expect(statusText()).toBe("Not saved. Retrying…");
    expect(session.getInert()).toBe(false);
    expect(reloadButton()).toBeNull();
    expect(stoppedText()).toBeNull();
  });

  it("lets go when another draft is bound: its autosave starts fresh", async () => {
    await stopOnConflict();
    await act(async () => root.render(header({ versionId: "v_next", rev: 0 })));
    expect(session.getInert()).toBe(false);
    expect(session.getStatus()).toEqual({ status: "saved" });
    expect(reloadButton()).toBeNull();
  });

  it("keeps Submit's own hold apart: letting that go leaves the page held", async () => {
    await act(async () => root.render(header()));
    const letGo = session.makeInert();
    fetchMock.mockImplementationOnce(async () => conflict());
    await act(async () => session.save({ name: "Mine" }));
    await wait(800);
    await act(async () => letGo());
    expect(session.getInert()).toBe(true);
  });
});
