// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelFieldsOf } from "@/domain/channel-fields";
import type { Person } from "@/domain/review-types";
import type { ThreadView } from "@/server/queries/threads";
import { FieldCommentControls, type FieldComments } from "./field-comments";

// The comments on a document's email subject and preheader in the author's rail: a marker for the open
// threads on a field, and a button that starts one.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 212 };
const [SUBJECT, PREHEADER] = channelFieldsOf("email");

function thread(id: string, blockId: string, patch: Partial<ThreadView> = {}, comments = 1): ThreadView {
  return {
    id,
    blockId,
    quote: null,
    status: "open",
    originVersionNumber: 1,
    originRound: 1,
    originLabel: "v1",
    comments: Array.from({ length: comments }, (_, i) => ({
      id: `${id}-${i}`,
      author: JORDAN,
      body: "Text",
      kind: "comment" as const,
      createdAt: "2027-02-18T10:00:00Z",
    })),
    orphaned: false,
    ...patch,
  };
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(threads: ThreadView[], over: Partial<FieldComments> = {}, field = SUBJECT) {
  const comments: FieldComments = { threads, activeThreadId: null, onActivate: vi.fn(), onRequestComment: vi.fn(), ...over };
  act(() => root.render(<FieldCommentControls field={field} comments={comments} />));
  return comments;
}
const marker = () => container.querySelector<HTMLButtonElement>("[data-field-marker]");
const add = () => container.querySelector<HTMLButtonElement>('[data-slot="field-comment"]');

describe("FieldCommentControls", () => {
  it("offers a button that starts a comment on the field, named for it", () => {
    const { onRequestComment } = render([]);
    expect(add()?.getAttribute("aria-label")).toBe("Comment on the email subject");
    act(() => add()!.click());
    expect(onRequestComment).toHaveBeenCalledWith("email.subject");
    expect(marker(), "no thread, no marker").toBeNull();
  });

  it("names the preheader's button for the preheader", () => {
    render([], {}, PREHEADER);
    expect(add()?.getAttribute("aria-label")).toBe("Comment on the email preheader");
  });

  it("marks the field's open threads with the number of comments on it, and none from another field", () => {
    render([thread("t1", "email.subject", {}, 2), thread("t2", "email.subject"), thread("t3", "email.preheader", {}, 4)]);
    expect(marker()?.getAttribute("aria-label")).toBe("3 comments on the email subject");
    expect(marker()?.textContent).toBe("3");
  });

  it("leaves out resolved threads and threads on removed content", () => {
    render([thread("done", "email.subject", { status: "resolved" }), thread("gone", "email.subject", { orphaned: true })]);
    expect(marker()).toBeNull();
  });

  it("opens the thread when the marker is chosen, and the next one on each further press", () => {
    const onActivate = vi.fn();
    const threads = [thread("t1", "email.subject"), thread("t2", "email.subject")];
    render(threads, { onActivate });
    act(() => marker()!.click());
    expect(onActivate).toHaveBeenLastCalledWith("t1");
    render(threads, { onActivate, activeThreadId: "t1" });
    expect(marker()?.getAttribute("aria-pressed")).toBe("true");
    act(() => marker()!.click());
    expect(onActivate).toHaveBeenLastCalledWith("t2");
  });

  it("shows the marker but no button to someone who can't comment", () => {
    render([thread("t1", "email.subject")], { onRequestComment: undefined });
    expect(marker()).not.toBeNull();
    expect(add()).toBeNull();
  });

  it("draws nothing when there is nothing to mark and no right to comment", () => {
    render([], { onRequestComment: undefined });
    expect(container.innerHTML).toBe("");
  });
});
