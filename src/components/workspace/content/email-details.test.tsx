// @vitest-environment happy-dom
// The Email details fields while Email is off: they stay in the editor root, so a variable renamed
// meanwhile reaches their chips (and the saved subject), and their chips still count as uses.

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorRoot, useEditorRoot } from "@/editor/components/editor-root";
import type { JSONContent, Variable } from "@/editor/model/types";
import { EmailDetails } from "./email-details";

/** The root's runtime: the test renames through it, as the variables panel's form does. */
type Runtime = ReturnType<typeof useEditorRoot>;

const session = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../session/workspace-session", () => ({ useWorkspaceSession: () => session }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VARIABLES: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const SUBJECT: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi " }, chip("first_name")] }] };

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

let host: HTMLElement;
let reactRoot: Root;
let runtime: Runtime | null = null;
const keepRuntime = (root: Runtime) => {
  runtime = root;
};

function Probe({ onRoot }: { onRoot: (root: Runtime) => void }) {
  const root = useEditorRoot("Probe");
  useLayoutEffect(() => onRoot(root), [root, onRoot]);
  return null;
}

function render(on: boolean) {
  act(() =>
    reactRoot.render(
      <EditorRoot variables={VARIABLES}>
        <Probe onRoot={keepRuntime} />
        <EmailDetails on={on} editable values={{ "email.subject": SUBJECT, "email.preheader": null }} />
      </EditorRoot>,
    ),
  );
}

const subjectField = () => host.querySelector<HTMLElement>('.ProseMirror[aria-label="Email subject"]');
const keysIn = (doc: JSONContent | undefined): string[] =>
  (doc?.content ?? []).flatMap((node) => (node.type === "variable" ? [node.attrs?.key as string] : keysIn(node)));

beforeEach(() => {
  session.save.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  reactRoot = createRoot(host);
});

afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  runtime = null;
});

/** Mounts the group and waits for the subject's live editor (it swaps in after hydration). */
async function mount(on: boolean) {
  render(on);
  await vi.waitFor(async () => {
    await wait(10);
    expect(subjectField()).not.toBeNull();
  });
}

/** The keys in the subject the session was last asked to save. */
const savedSubjectKeys = () => {
  const saved = session.save.mock.calls.map(([patch]) => patch as { "email.subject"?: JSONContent }).filter((p) => p["email.subject"]);
  return keysIn(saved.at(-1)?.["email.subject"]);
};

describe("Email details while Email is off", () => {
  it("turned off, keeps the fields in the root: a rename reaches the subject, saves it, and its chip still counts", async () => {
    await mount(true);
    render(false);
    expect(host.querySelector("section")?.hidden).toBe(true);

    act(() => void runtime!.updateVariable("first_name", { key: "given_name" }));
    runtime!.flushUsage();

    // The subject's chip counts, so deleting the variable still asks first.
    expect(runtime!.usage.getState().byKey.get("given_name")).toEqual({
      key: "given_name",
      count: 1,
      places: [{ field: "Email subject", section: null, count: 1 }],
    });
    // The saved subject carries the new key.
    expect(savedSubjectKeys()).toEqual(["given_name"]);

    // Email back on: the chip is the renamed variable, not an unknown key.
    render(true);
    await wait(10);
    expect(host.querySelector("section")?.hidden).toBe(false);
    expect(subjectField()?.querySelector('[data-variable="given_name"]')).not.toBeNull();
    expect(subjectField()?.querySelector('[data-variable="first_name"]')).toBeNull();
  });

  it("off from the start, the same: the subject counts and follows a rename", async () => {
    await mount(false);
    expect(host.querySelector("section")?.hidden).toBe(true);
    runtime!.flushUsage();
    expect(runtime!.usage.getState().byKey.get("first_name")?.count).toBe(1);

    act(() => void runtime!.updateVariable("first_name", { key: "given_name" }));
    expect(savedSubjectKeys()).toEqual(["given_name"]);
    render(true);
    await wait(10);
    expect(subjectField()?.querySelector('[data-variable="given_name"]')).not.toBeNull();
  });
});
