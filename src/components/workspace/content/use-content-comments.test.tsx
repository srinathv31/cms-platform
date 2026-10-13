// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_THREAD_ID } from "@/components/comments/use-review-threads";
import {
  CHANNEL_FIELD_IDS,
  type ChannelFieldValues,
} from "@/domain/channel-fields";
import { createLiveDraft } from "../session/live-draft";
import {
  createWorkspaceSession,
  type WorkspaceSession,
} from "../session/session-store";
import type { JSONContent } from "@/domain/types";
import type { DocumentEditorHandle } from "@/editor/types";
import type { ThreadView } from "@/server/queries/threads";
import {
  useBlockText,
  useContentComments,
  type ContentCommentsState,
} from "./use-content-comments";

// The Content tab's comments, as the hook ties them to the document and the rail: which clicks show the rail's
// Comments view, where the caret goes when the comment box closes, where a new thread slots in, and how a
// thread follows its block as the document changes. The session is the real one with its two calls spied; the
// editor is a handle whose calls the test records.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const JORDAN = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 212 };
function thread(
  id: string,
  blockId: string,
  patch: Partial<ThreadView> = {},
): ThreadView {
  return {
    id,
    blockId,
    quote: null,
    status: "open",
    originVersionNumber: 1,
    originRound: 1,
    originLabel: "v1",
    comments: [
      {
        id: `c-${id}`,
        author: JORDAN,
        body: `Comment ${id}`,
        kind: "comment",
        createdAt: "2027-02-18T13:00:00Z",
      },
    ],
    orphaned: false,
    ...patch,
  };
}

const block = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
const doc = (...blocks: ReturnType<typeof block>[]): JSONContent => ({
  type: "doc",
  content: blocks,
});
const BODY = doc(block("b1", "Terms"), block("b2", "The rate is fixed."));

const THREADS = [
  thread("spend", "b2"),
  thread("subject", "email.subject"),
  thread("old", "b1", { status: "resolved" }),
];

let root: Root;
let container: HTMLElement;
let session: WorkspaceSession;
let showComments: ReturnType<typeof vi.fn>;
/** The hook as the probe last rendered it. */
const hook: { current: ContentCommentsState | null } = { current: null };
const state = () => hook.current!;
let editor: {
  focus: ReturnType<typeof vi.fn>;
  focusThread: ReturnType<typeof vi.fn>;
  getBlockRect: ReturnType<typeof vi.fn>;
};
let frames: (() => void)[];

function Probe({
  threads = THREADS,
  canComment = true,
  message = false,
}: {
  threads?: ThreadView[];
  canComment?: boolean;
  message?: boolean;
}) {
  const result = useContentComments({
    session,
    threads,
    canComment,
    body: BODY,
    message,
  });
  useEffect(() => {
    hook.current = result;
  });
  return null;
}

const show = (props: Parameters<typeof Probe>[0] = {}) =>
  act(async () => root.render(<Probe {...props} />));
/** The editor mounts and hands its handle over, as `DocumentBody`'s ref does. */
const mountEditor = () =>
  act(() => state().setEditor(editor as unknown as DocumentEditorHandle));
const byId = (id: string) => state().threads.find((t) => t.id === id)!;
/** Animation frames the page has asked for run now, and any they ask for in turn. */
const runFrames = () =>
  act(() => {
    while (frames.length) frames.shift()!();
  });

beforeEach(() => {
  session = createWorkspaceSession();
  showComments = vi.fn();
  session.showComments = showComments as unknown as () => void;
  editor = {
    focus: vi.fn(),
    focusThread: vi.fn(),
    getBlockRect: vi.fn((id: string) => (id === "b2" ? { top: 240 } : null)),
  };
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("showing a thread", () => {
  it("makes a clicked highlight or marker active, and brings the rail's Comments view", async () => {
    await show();
    await mountEditor();
    act(() => state().onThreadClick("spend"));
    expect(state().activeThreadId).toBe("spend");
    expect(showComments).toHaveBeenCalledTimes(1);
  });

  it("ignores a click on the quote the comment box is about: it isn't a thread", async () => {
    await show();
    act(() => state().onThreadClick(COMPOSER_THREAD_ID));
    expect(state().activeThreadId).toBeNull();
    expect(showComments).not.toHaveBeenCalled();
  });

  it("follows the caret through quotes without taking the rail away from Variables", async () => {
    await show();
    act(() => state().onCaretThreadChange("spend"));
    expect(state().activeThreadId).toBe("spend");
    act(() => state().onCaretThreadChange(null));
    expect(state().activeThreadId).toBeNull();
    act(() => state().onCaretThreadChange(COMPOSER_THREAD_ID));
    expect(state().activeThreadId).toBeNull();
    expect(showComments).not.toHaveBeenCalled();
  });

  it("shows the document the thread once it is active, whoever made it active", async () => {
    await show();
    await mountEditor();
    expect(editor.focusThread).not.toHaveBeenCalled();
    act(() => state().setActive("spend"));
    expect(editor.focusThread).toHaveBeenCalledExactlyOnceWith("spend");
    act(() => state().setActive(null));
    expect(editor.focusThread).toHaveBeenCalledTimes(1);
  });

  it("hands the session the editor's handle too, for the name field", async () => {
    const setEditor = vi.fn();
    session.setEditor = setEditor;
    await show();
    await mountEditor();
    expect(setEditor).toHaveBeenCalledExactlyOnceWith(editor);
  });
});

describe("starting a thread", () => {
  it("opens the comment box on the anchor and brings the Comments view, from the document and from a field", async () => {
    await show();
    act(() => state().onRequestComment!({ blockId: "b2", quote: "fixed" }));
    expect(state().composer).toMatchObject({ blockId: "b2", quote: "fixed" });
    expect(showComments).toHaveBeenCalledTimes(1);

    act(() => state().fieldComments.onRequestComment!("email.subject"));
    expect(state().composer).toMatchObject({ blockId: "email.subject" });
    expect(showComments).toHaveBeenCalledTimes(2);

    act(() => state().onRequestBlockComment!("b1"));
    expect(state().composer).toMatchObject({ blockId: "b1" });
  });

  it("offers no way to start one to someone who can't comment", async () => {
    await show({ canComment: false });
    expect(state().onRequestComment).toBeUndefined();
    expect(state().onRequestBlockComment).toBeUndefined();
    expect(state().fieldComments.onRequestComment).toBeUndefined();
  });

  it("counts the open threads, and has comments while there are threads or a box is open", async () => {
    await show();
    expect(state().openCount).toBe(2);
    expect(state().hasComments).toBe(true);

    await show({ threads: [] });
    expect(state().openCount).toBe(0);
    expect(state().hasComments).toBe(false);
    act(() => state().onRequestComment!({ blockId: "b1" }));
    expect(state().hasComments).toBe(true);
  });

  it("gives the field markers the threads, the active one, and a way to show one", async () => {
    await show();
    act(() => state().setActive("subject"));
    expect(state().fieldComments.threads).toBe(state().threads);
    expect(state().fieldComments.activeThreadId).toBe("subject");
    act(() => state().fieldComments.onActivate("spend"));
    expect(state().activeThreadId).toBe("spend");
    expect(showComments).toHaveBeenCalledTimes(1);
  });

  it("marks the box's quote in the editor with a thread of its own, which no list shows", async () => {
    await show();
    act(() => state().onRequestComment!({ blockId: "b2", quote: "fixed" }));
    expect(state().threadsForEditor.map((t) => t.id)).toContain(
      COMPOSER_THREAD_ID,
    );
    expect(state().editorActiveThreadId).toBe(COMPOSER_THREAD_ID);
    expect(state().threads.map((t) => t.id)).not.toContain(COMPOSER_THREAD_ID);
    expect(state().threadField(COMPOSER_THREAD_ID)).toBe("b2");
    expect(state().threadField("subject")).toBe("email.subject");
    expect(state().threadField("nothing")).toBeNull();
  });
});

describe("closing the comment box", () => {
  /** A selection inside the editor, as TipTap leaves it when it focuses. */
  function selectInEditor() {
    const prose = document.createElement("div");
    prose.className = "ProseMirror";
    prose.textContent = "The rate is fixed.";
    document.body.append(prose);
    select(prose.firstChild!);
    return prose;
  }
  /** Some of a text node selected, as a person drags: the anchor is the text, not its element. */
  function select(text: Node) {
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  it("puts the caret back in the document when it is cancelled, and collapses the selection after the editor's two frames", async () => {
    await show();
    await mountEditor();
    act(() => state().onRequestComment!({ blockId: "b2", quote: "fixed" }));
    selectInEditor();
    act(() => state().onComposerClose("cancelled"));
    expect(state().composer).toBeNull();
    expect(editor.focus).toHaveBeenCalledTimes(1);
    // TipTap focuses on the next frame, which would bring the format bubble back: the page waits two.
    expect(window.getSelection()!.isCollapsed).toBe(false);
    await runFrames();
    expect(window.getSelection()!.isCollapsed).toBe(true);
  });

  it("leaves a selection alone that is not in the editor", async () => {
    await show();
    await mountEditor();
    act(() => state().onRequestComment!({ blockId: "b2" }));
    const outside = document.createElement("p");
    outside.textContent = "Elsewhere";
    document.body.append(outside);
    select(outside.firstChild!);
    act(() => state().onComposerClose("cancelled"));
    await runFrames();
    expect(window.getSelection()!.isCollapsed).toBe(false);
  });

  it("keeps the caret out of it when it was posted: focus goes to the new thread's card", async () => {
    await show();
    await mountEditor();
    act(() => state().onRequestComment!({ blockId: "b2" }));
    act(() => state().onComposerClose("posted"));
    expect(state().composer).toBeNull();
    expect(editor.focus).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  it("closes a box that came from a field in the rail without moving focus: the list puts it back where it began", async () => {
    await show();
    await mountEditor();
    act(() => state().fieldComments.onRequestComment!("email.subject"));
    act(() => state().onComposerClose("cancelled"));
    expect(state().composer).toBeNull();
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it("puts the caret back for a message's field, which has no rail to put it in", async () => {
    await show({ message: true });
    await mountEditor();
    act(() => state().fieldComments.onRequestComment!("email.subject"));
    act(() => state().onComposerClose("cancelled"));
    expect(editor.focus).toHaveBeenCalledTimes(1);
  });

  it("does nothing to the editor when there is none on screen", async () => {
    await show();
    act(() => state().onRequestComment!({ blockId: "b2" }));
    act(() => state().onComposerClose("cancelled"));
    expect(state().composer).toBeNull();
    await runFrames();
  });
});

describe("where a new thread slots in", () => {
  it("puts a document's email fields before every block, in the registry's order", async () => {
    await show();
    await mountEditor();
    const subject = state().blockPosition("email.subject")!;
    const preheader = state().blockPosition("email.preheader")!;
    expect(subject).toBeLessThan(preheader);
    expect(preheader).toBeLessThan(-1_000_000);
    expect(editor.getBlockRect).not.toHaveBeenCalled();
  });

  it("puts a block where the editor draws it, and nowhere before the editor is there", async () => {
    await show();
    expect(state().blockPosition("b2")).toBeNull();
    await mountEditor();
    expect(state().blockPosition("b2")).toBe(240);
    expect(state().blockPosition("b9")).toBeNull();
  });

  it("asks the editor about a message's fields, which are blocks of the composer", async () => {
    await show({ message: true });
    await mountEditor();
    editor.getBlockRect.mockReturnValue({ top: 12 });
    expect(state().blockPosition("push.title")).toBe(12);
    expect(editor.getBlockRect).toHaveBeenCalledWith("push.title");
  });
});

describe("a thread follows its block", () => {
  it("moves to On removed content when its block is deleted, and back when undo restores it", async () => {
    await show();
    expect(byId("spend").orphaned).toBe(false);
    act(() => state().bodyChanged(doc(block("b1", "Terms"))));
    expect(byId("spend").orphaned).toBe(true);
    expect(byId("subject").orphaned, "a field isn't in the body").toBe(false);
    act(() => state().bodyChanged(BODY));
    expect(byId("spend").orphaned).toBe(false);
  });

  it("remembers the document as it is now, for a card that quotes a block", async () => {
    await show();
    expect(state().liveBody.current).toBe(BODY);
    const next = doc(block("b1", "Terms"), block("b2", "The rate floats."));
    act(() => state().bodyChanged(next));
    expect(state().liveBody.current).toBe(next);
  });

  it("remembers a message's body but tracks no blocks: its threads are on its fields", async () => {
    await show({ message: true });
    const next = doc(block("b1", "Terms"));
    act(() => state().bodyChanged(next));
    expect(state().liveBody.current).toBe(next);
    expect(byId("spend").orphaned).toBe(false);
  });
});

describe("useBlockText", () => {
  const quote: { current: ((blockId: string) => string | null) | null } = {
    current: null,
  };
  const text = (blockId: string) => quote.current!(blockId);
  function Quote({
    liveBody,
    fields,
  }: {
    liveBody: { current: JSONContent };
    fields: ChannelFieldValues;
  }) {
    const read = useBlockText(
      liveBody,
      [
        {
          key: "rate",
          label: "Rate",
          type: "percent",
          required: true,
          sample: "21.99",
        },
      ],
      createLiveDraft({ fields, sampleSets: [] }),
    );
    useEffect(() => {
      quote.current = read;
    });
    return null;
  }
  // Every field of the registry, empty, but the email subject.
  const fields: ChannelFieldValues = {
    ...(Object.fromEntries(
      CHANNEL_FIELD_IDS.map((id) => [id, null]),
    ) as ChannelFieldValues),
    "email.subject": {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Your rate: " },
            { type: "variable", attrs: { key: "rate" } },
          ],
        },
      ],
    },
  };

  it("reads a channel field as typed, a chip as its label, and a block from the document as it is now", async () => {
    const liveBody = { current: BODY };
    await act(async () =>
      root.render(<Quote liveBody={liveBody} fields={fields} />),
    );
    expect(text("email.subject")).toBe("Email subject: Your rate: Rate");
    expect(text("b2")).toBe("The rate is fixed.");
    liveBody.current = doc(block("b2", "Typed since"));
    expect(text("b2"), "reads the ref when asked, not when it was built").toBe(
      "Typed since",
    );
  });

  it("is null for a block that is gone or says nothing", async () => {
    await act(async () =>
      root.render(<Quote liveBody={{ current: BODY }} fields={fields} />),
    );
    expect(text("b9")).toBeNull();
  });
});
