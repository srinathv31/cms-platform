// @vitest-environment happy-dom
// The Copilot prompt dialog: it sends the pending autosave before asking for the prompt, shows the
// prompt, copies it ("Copied" for two seconds), and says why when it can't.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/domain/review-types";
import type { CopilotPrompt } from "@/domain/import-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The copilot-prompt route as the browser reaches it: handed the URL fetched, it gives the body. */
type GetPrompt = (url: string) => Promise<ActionResult<{ prompt: CopilotPrompt }>>;

const calls: string[] = [];
const getCopilotPrompt = vi.fn<GetPrompt>();
const session = {
  flush: vi.fn(async () => {
    calls.push("flush");
  }),
  getStatus: vi.fn(() => ({ status: "saved" as const }) as { status: "saved" | "error"; error?: string }),
};

vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    const body = await getCopilotPrompt(url);
    return { status: body.ok ? 200 : 403, json: async () => body };
  }),
);
vi.mock("../session/workspace-session", () => ({ useWorkspaceSession: () => session }));

const { CopilotPromptButton } = await import("./copilot-prompt");

const PROMPT = "Help me write the body of a disclosure.\n\n## Offer details\n- {{purchase_apr}}: Purchase APR";

let root: Root;
let container: HTMLElement;
const writeText = vi.fn<(text: string) => Promise<void>>();

const button = (name: RegExp) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => name.test(b.textContent ?? ""))!;
const dialog = () => document.body.querySelector<HTMLElement>("[data-slot='scrim-dialog-content']");
const alert = () => dialog()?.querySelector("[role='alert']")?.textContent ?? "";
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function openDialog() {
  await act(async () => button(/Copilot prompt/).click());
  await settle();
  await settle();
}

beforeEach(async () => {
  calls.length = 0;
  getCopilotPrompt.mockReset().mockImplementation(async () => {
    calls.push("prompt");
    return { ok: true, prompt: { text: PROMPT, includesDraft: true } };
  });
  session.getStatus.mockReturnValue({ status: "saved" });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CopilotPromptButton templateId="UC-4F7K2Q" />));
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("Copilot prompt", () => {
  it("is a row that opens \"Prompt for Copilot\" with the prompt built after the autosave went out", async () => {
    await openDialog();
    expect(dialog()?.querySelector("[data-slot='dialog-title']")?.textContent).toBe("Prompt for Copilot");
    expect(calls).toEqual(["flush", "prompt"]);
    expect(getCopilotPrompt).toHaveBeenCalledWith("/api/templates/UC-4F7K2Q/copilot-prompt");
    expect(dialog()?.querySelector("pre")?.textContent).toBe(PROMPT);
  });

  it("Copy prompt copies the text and reads \"Copied\" for two seconds", async () => {
    await openDialog();
    vi.useFakeTimers();
    await act(async () => button(/Copy prompt/).click());
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    const copy = button(/Copy prompt/);
    const [idle, done] = [...copy.querySelectorAll("span > span")];
    expect(idle.className).toContain("invisible");
    expect(done.className).not.toContain("invisible");
    expect(dialog()?.querySelector("[role='status']")?.textContent).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(done.className).toContain("invisible");
  });

  it("Copy prompt is unusable until the prompt is there", async () => {
    let answer: (value: ActionResult<{ prompt: CopilotPrompt }>) => void = () => undefined;
    getCopilotPrompt.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await openDialog();
    expect(button(/Copy prompt/).getAttribute("aria-disabled")).toBe("true");
    await act(async () => answer({ ok: true, prompt: { text: PROMPT, includesDraft: false } }));
    expect(button(/Copy prompt/).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("a refusal or an unsaved draft shows its reason and no prompt", async () => {
    getCopilotPrompt.mockResolvedValue({ ok: false, code: "generic", reason: "Only authors on this team can edit drafts." });
    await openDialog();
    expect(alert()).toBe("Only authors on this team can edit drafts.");
    expect(dialog()?.querySelector("pre")).toBeNull();

    await act(async () => button(/^Close$/).click());
    await settle();
    session.getStatus.mockReturnValue({ status: "error" });
    await openDialog();
    expect(alert()).toBe("Your latest changes aren't saved yet.");
  });

  it("a failed copy says so and selects the prompt", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await openDialog();
    await act(async () => button(/Copy prompt/).click());
    expect(alert()).toBe("Couldn't copy. Select the prompt and copy it.");
    expect(window.getSelection()?.toString()).toBe(PROMPT);
  });
});
