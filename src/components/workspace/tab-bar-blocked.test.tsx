// @vitest-environment happy-dom
// The tab bar's actions while a tab shows its error (handoff review N9). The bar is in the workspace layout,
// above the tab's error boundary, so Edit, Submit for review and Preview stay on screen when the tab they act
// on didn't load. They are greyed with the reason at the control, and live again once the error goes.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const server = vi.hoisted(() => ({
  startDraft: vi.fn(),
  submitVersion: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: () => undefined,
  useSelectedLayoutSegment: () => null,
  useParams: () => ({ team: "coral-offers", templateId: "UC-ABC123" }),
}));
vi.mock("@/server/actions/templates", () => ({
  startDraft: server.startDraft,
}));
vi.mock("@/server/actions/review", () => ({
  submitVersion: server.submitVersion,
}));
vi.stubGlobal("fetch", vi.fn());

const { EditButton, PreviewToggle, RailToggle, SubmitButton } =
  await import("./workspace-actions");
const { TAB_BLOCKED, TabError } = await import("./tab-error");
const { WorkspaceSessionProvider } =
  await import("./session/workspace-session");

const TEMPLATE = "UC-ABC123";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  server.startDraft.mockReset().mockResolvedValue({ ok: true });
  server.submitVersion.mockReset();
  vi.mocked(fetch).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

/** The bar's actions, and under the same session the error view when the tab failed. Edit and Submit never show together; the test needs both. */
function Workspace({ failed }: { failed: boolean }) {
  return (
    <WorkspaceSessionProvider>
      <PreviewToggle />
      <RailToggle />
      <EditButton templateId={TEMPLATE} />
      <SubmitButton templateId={TEMPLATE} />
      {failed ? (
        <TabError error={new Error("SQLITE_BUSY")} retry={() => {}} />
      ) : null}
    </WorkspaceSessionProvider>
  );
}

const render = (failed: boolean) =>
  act(async () => root.render(<Workspace failed={failed} />));
const control = (name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label='${name}']`)!;
const edit = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === "Edit",
  )!;
const actions = () => [
  control("Preview"),
  control("Channels and variables"),
  edit(),
  control("Submit for review"),
];
const reasonOf = (button: HTMLElement) =>
  document.getElementById(button.getAttribute("aria-describedby") ?? "")
    ?.textContent;

describe("the tab bar's actions", () => {
  it("are live while the tab loaded", async () => {
    await render(false);
    for (const button of actions()) {
      expect(
        button.hasAttribute("data-disabled"),
        button.textContent ?? button.ariaLabel ?? "",
      ).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("are greyed, each with the reason at the control, while the tab shows its error", async () => {
    await render(true);
    expect(actions()).toHaveLength(4);
    for (const button of actions()) {
      const name = button.getAttribute("aria-label") ?? button.textContent;
      expect(button.hasAttribute("data-disabled"), `${name} is greyed`).toBe(
        true,
      );
      expect(
        button.getAttribute("aria-disabled"),
        `${name} is marked disabled`,
      ).toBe("true");
      expect(reasonOf(button), `${name} says why`).toBe(TAB_BLOCKED);
      // Still in the bar and reachable from the keyboard: a hidden or removed control can't say why.
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("keep their names and labels, so the bar keeps its geometry", async () => {
    await render(false);
    const live = actions().map((b) => b.textContent);
    await render(true);
    expect(actions().map((b) => b.textContent)).toEqual(live);
  });

  it("do nothing when pressed", async () => {
    await render(true);
    for (const button of actions()) await act(async () => button.click());
    expect(server.startDraft).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      document.body.querySelector("[data-slot='scrim-dialog-content']"),
    ).toBeNull();
    expect(control("Preview").getAttribute("aria-pressed")).toBe("false");
  });

  it("are live again once the error goes (Try again worked, or the person left the tab)", async () => {
    await render(true);
    await render(false);
    for (const button of actions())
      expect(button.hasAttribute("data-disabled")).toBe(false);
    await act(async () => edit().click());
    expect(server.startDraft).toHaveBeenCalledWith({ templateId: TEMPLATE });
  });
});
