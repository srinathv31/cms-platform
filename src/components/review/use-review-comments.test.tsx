// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "@/domain/review-types";
import type { ReviewScreenData } from "@/server/queries/review-models";
import type { ThreadView } from "@/server/queries/threads";
import type { JSONContent } from "@/domain/types";
import type { DocumentEditorHandle } from "@/editor/types";
import {
  useReviewComments,
  type ReviewCommentsState,
} from "./use-review-comments";

// The review screen's comments over a document that shows two kinds of anchor: blocks of its body, and its
// email subject and preheader. The body keeps the editor's handle (or the redline's); the fields have a
// handle of their own, and a call about an anchor goes to the one that owns it.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/server/actions/comments", () => ({
  addComment: vi.fn(),
  reply: vi.fn(),
  resolveThread: vi.fn(),
  reopenThread: vi.fn(),
}));

const JORDAN: Person = {
  id: "jordan",
  name: "Jordan Ellis",
  initials: "JE",
  hue: 212,
};
const line = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const version = {
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "b_intro" },
        content: [{ type: "text", text: "Hello" }],
      },
    ],
  },
  channels: ["pdf", "email"],
  variables: [],
  channelFields: { email: { subject: line("Your terms are ready") } },
} as unknown as ReviewScreenData["version"];

function thread(id: string, blockId: string): ThreadView {
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
        id: `${id}-c`,
        author: JORDAN,
        body: "Text",
        kind: "comment",
        createdAt: "2027-02-18T10:00:00Z",
      },
    ],
    orphaned: false,
  };
}
const THREADS = [
  thread("on-subject", "email.subject"),
  thread("on-block", "b_intro"),
];

function handle(): DocumentEditorHandle & {
  [K in keyof DocumentEditorHandle]: ReturnType<typeof vi.fn>;
} {
  return {
    focus: vi.fn(),
    focusThread: vi.fn(),
    getBlockRect: vi.fn(() => null),
    getThreadRect: vi.fn(() => null),
    subscribeBlockRects: vi.fn(() => () => {}),
    requestComment: vi.fn(),
  } as never;
}

let root: Root;
let container: HTMLElement;
let state: ReviewCommentsState;
const showDocument = vi.fn();

function Probe({ onState }: { onState: (state: ReviewCommentsState) => void }) {
  onState(useReviewComments({ threads: THREADS, version, showDocument }));
  return null;
}

let editor: ReturnType<typeof handle>;
let fields: ReturnType<typeof handle>;

beforeEach(() => {
  showDocument.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe onState={(next) => (state = next)} />));
  editor = handle();
  fields = handle();
  (state.editorRef as { current: DocumentEditorHandle | null }).current =
    editor;
  (state.fieldsRef as { current: DocumentEditorHandle | null }).current =
    fields;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useReviewComments: a document's email fields beside its blocks", () => {
  it("asks the fields' handle to comment on a field, and the body's for a block", () => {
    act(() => state.requestBlockComment("email.subject"));
    expect(fields.requestComment).toHaveBeenCalledWith("email.subject");
    expect(editor.requestComment).not.toHaveBeenCalled();
    act(() => state.requestBlockComment("b_intro"));
    expect(editor.requestComment).toHaveBeenCalledWith("b_intro");
    expect(fields.requestComment).toHaveBeenCalledTimes(1);
  });

  it("brings the document to a thread chosen on a field, and scrolls the fields' handle to it", () => {
    act(() => state.activate("on-subject"));
    expect(showDocument).toHaveBeenCalledTimes(1);
    expect(fields.focusThread).toHaveBeenCalledWith("on-subject");
    expect(editor.focusThread).not.toHaveBeenCalled();
    expect(state.activeThreadId).toBe("on-subject");
    expect(state.activeBlockId).toBe("email.subject");
  });

  it("scrolls the body's handle to a thread on a block", () => {
    act(() => state.activate("on-block"));
    expect(editor.focusThread).toHaveBeenCalledWith("on-block");
    expect(fields.focusThread).not.toHaveBeenCalled();
    expect(state.activeBlockId).toBe("b_intro");
  });

  it("opens the comment box on a field from the rail's menu, and scrolls the fields to it", () => {
    act(() => state.pickBlock("email.preheader"));
    expect(state.composer?.blockId).toBe("email.preheader");
    expect(state.activeBlockId).toBe("email.preheader");
    expect(fields.focusThread).toHaveBeenCalledWith("composer");
    expect(editor.focusThread).not.toHaveBeenCalled();
  });

  it("reads the fields first in reading order, and a field's text as its card quotes it", () => {
    const order = ["email.subject", "email.preheader", "b_intro"].map((id) =>
      state.blockPosition(id),
    );
    expect(order).toEqual([0, 1, 2]);
    expect(state.blockText("email.subject")).toBe(
      "Email subject: Your terms are ready",
    );
    expect(state.blockText("email.preheader")).toBe("Email preheader");
    expect(state.blockText("b_intro")).toBe("Hello");
  });
});
