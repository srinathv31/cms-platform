// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_THREAD, type Person, type ThreadView } from "@/domain/review-types";
import { ThreadList, type ThreadListProps } from "./thread-list";
import { useReviewThreads } from "./use-review-threads";

const actions = vi.hoisted(() => ({
  addComment: vi.fn(),
  reply: vi.fn(),
  resolveThread: vi.fn(),
  reopenThread: vi.fn(),
}));
vi.mock("@/server/actions/comments", () => actions);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAYA: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 28 };
const JORDAN: Person = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 212 };
const NOW = "2027-02-18T15:00:00Z";

function thread(id: string, blockId: string, patch: Partial<ThreadView> = {}): ThreadView {
  return {
    id,
    blockId,
    quote: patch.quote ?? null,
    status: "open",
    originVersionNumber: 1,
    comments: [{ id: `c-${id}`, author: JORDAN, body: `Comment ${id}`, kind: "comment", createdAt: "2027-02-18T13:00:00Z" }],
    orphaned: false,
    ...patch,
  };
}

const THREADS: ThreadView[] = [
  thread("doc", DOCUMENT_THREAD, {
    comments: [{ id: "c-doc", author: JORDAN, body: "Two things to fix.", kind: "change_request", createdAt: "2027-02-16T13:00:00Z" }],
  }),
  thread("spend", "b2", { quote: "$4,000 on purchases" }),
  thread("apr", "b5", { quote: null }),
  thread("gone", "b99", { orphaned: true, quote: "old wording" }),
  thread("old-1", "b3", { status: "resolved", resolvedBy: JORDAN, resolvedAt: "2027-02-17T09:00:00Z" }),
  thread("old-2", "b4", { status: "resolved", resolvedBy: MAYA, resolvedAt: "2027-02-17T10:00:00Z" }),
];

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  Object.values(actions).forEach((fn) => fn.mockReset());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const base: Omit<ThreadListProps, "threads"> = {
  activeThreadId: null,
  onActivate: () => {},
  canComment: true,
  composer: null,
  onComposerClose: () => {},
  templateId: "UC-4F7K2Q",
  versionId: "v_draft",
  viewer: MAYA,
  now: NOW,
};

/** The thread cards in the order they are on screen. */
const order = () => Array.from(container.querySelectorAll<HTMLElement>("[data-thread]")).map((el) => el.dataset.thread);
const card = (id: string) => container.querySelector<HTMLElement>(`[data-thread="${id}"]`)!;
const button = (within: ParentNode, name: RegExp | string) =>
  Array.from(within.querySelectorAll<HTMLElement>("button")).find((b) =>
    typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? "") || name.test(b.getAttribute("aria-label") ?? ""),
  )!;
const click = (el: HTMLElement) => act(() => el.click());
const flush = () => act(() => Promise.resolve());

/** A promise the test settles by hand: the server's answer. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("ThreadList: what is listed, and in what order", () => {
  beforeEach(() => act(() => root.render(<ThreadList {...base} threads={THREADS} />)));

  it("lists the change request first, then open threads in document order, then orphaned ones", () => {
    expect(order()).toEqual(["doc", "spend", "apr", "gone"]);
  });

  it("labels the orphaned ones quietly, apart from the rest", () => {
    const section = container.querySelector('[aria-label="Comments on removed content"]')!;
    expect(section.textContent).toContain("On removed content");
    expect(section.querySelector('[data-thread="gone"]')).toBeTruthy();
  });

  it("keeps the resolved ones collapsed under Resolved (N), and shows them when it is opened", () => {
    const toggle = button(container, /Resolved \(2\)/);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(order()).not.toContain("old-1");
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(order().slice(-2)).toEqual(["old-1", "old-2"]);
    expect(card("old-1").textContent).toContain("Resolved by Jordan Ellis");
  });

  it("writes the quote, the author and the time of each comment", () => {
    expect(card("spend").textContent).toContain("$4,000 on purchases");
    expect(card("spend").textContent).toContain("Jordan Ellis");
    expect(card("spend").textContent).toContain("2 hours ago");
    expect(card("doc").textContent).toContain("Changes requested");
  });

  it("is quiet when nothing is open", () => {
    act(() => root.render(<ThreadList {...base} threads={THREADS.filter((t) => t.status === "resolved")} />));
    expect(container.textContent).toContain("No open comments.");
    expect(container.textContent).toContain("Resolved (2)");
  });
});

describe("ThreadList: choosing and composing", () => {
  it("activates a thread when its card is clicked, and shows the active one selected", () => {
    const onActivate = vi.fn();
    act(() => root.render(<ThreadList {...base} threads={THREADS} onActivate={onActivate} activeThreadId="apr" />));
    expect(card("apr").hasAttribute("data-active")).toBe(true);
    expect(card("spend").hasAttribute("data-active")).toBe(false);
    click(card("spend"));
    expect(onActivate).toHaveBeenCalledWith("spend");
  });

  it("selects a thread when focus arrives in its card (the keyboard path)", () => {
    const onActivate = vi.fn();
    act(() => root.render(<ThreadList {...base} threads={THREADS} onActivate={onActivate} />));
    act(() => button(card("apr"), /Reply/).focus());
    expect(onActivate).toHaveBeenCalledWith("apr");
  });

  it("puts the composer above every thread", () => {
    act(() => root.render(<ThreadList {...base} threads={THREADS} composer={{ blockId: "b2", quote: "bonus points" }} />));
    const list = container.querySelector('[data-slot="thread-list"]')!;
    expect(list.firstElementChild?.hasAttribute("data-compose")).toBe(true);
    expect(list.firstElementChild?.textContent).toContain("bonus points");
  });

  it("offers no reply, resolve or reopen to someone who can't comment", () => {
    act(() => root.render(<ThreadList {...base} canComment={false} threads={THREADS} />));
    expect(button(container, "Resolve")).toBeUndefined();
    expect(container.querySelector('button[aria-label^="Reply"]')).toBeNull();
  });
});

/** A host that does what the page does: it owns the server's list and the optimistic layer, and replaces the list when the server answers. */
function Host({ initial, onList }: { initial: ThreadView[]; onList?: (apply: (next: ThreadView[]) => void) => void }) {
  const [server, setServer] = useState(initial);
  onList?.(setServer);
  const review = useReviewThreads(server);
  return (
    <ThreadList
      {...base}
      threads={review.threads}
      onMutate={review.mutate}
      activeThreadId={review.activeThreadId}
      onActivate={review.setActive}
      composer={review.composer}
      onComposerClose={review.closeComposer}
    />
  );
}

describe("ThreadList: changes show at once, and the server's answer settles them", () => {
  it("moves a resolved thread to Resolved before the server answers, and keeps it there when it does", async () => {
    const answer = deferred<{ ok: true }>();
    actions.resolveThread.mockReturnValue(answer.promise);
    let setServer!: (next: ThreadView[]) => void;
    act(() => root.render(<Host initial={THREADS} onList={(apply) => (setServer = apply)} />));
    expect(order()).toContain("spend");

    click(button(card("spend"), "Resolve"));
    await flush();
    // Pending: it left the open list and the count moved.
    expect(order()).not.toContain("spend");
    expect(container.textContent).toContain("Resolved (3)");
    expect(actions.resolveThread).toHaveBeenCalledWith({ threadId: "spend" });

    // The server confirms (refresh() brings the new list, then the action returns).
    await act(async () => {
      setServer(THREADS.map((t) => (t.id === "spend" ? { ...t, status: "resolved" as const, resolvedBy: MAYA, resolvedAt: NOW } : t)));
      answer.resolve({ ok: true });
    });
    expect(order()).not.toContain("spend");
    expect(container.textContent).toContain("Resolved (3)");
  });

  it("puts a refused resolve back and says why, at the card", async () => {
    actions.resolveThread.mockResolvedValue({ ok: false, reason: "Only authors and approvers on this team can comment." });
    act(() => root.render(<Host initial={THREADS} />));
    click(button(card("spend"), "Resolve"));
    await flush();
    await flush();
    expect(order()).toContain("spend");
    expect(card("spend").querySelector('[role="alert"]')?.textContent).toBe("Only authors and approvers on this team can comment.");
  });

  it("reopens a resolved thread at once, into the open list", async () => {
    const answer = deferred<{ ok: true }>();
    actions.reopenThread.mockReturnValue(answer.promise);
    act(() => root.render(<Host initial={THREADS} />));
    click(button(container, /Resolved \(2\)/));
    click(button(card("old-1"), "Reopen"));
    await flush();
    expect(container.textContent).toContain("Resolved (1)");
    expect(order()).toContain("old-1");
    expect(card("old-1").hasAttribute("data-active")).toBe(false);
    expect(card("old-1").textContent).not.toContain("Resolved by");
    await act(async () => answer.resolve({ ok: true }));
  });

  it("shows a reply in its card at once, under the viewer's name", async () => {
    const answer = deferred<{ ok: true }>();
    actions.reply.mockReturnValue(answer.promise);
    act(() => root.render(<Host initial={THREADS} />));
    click(button(card("spend"), /Reply/));
    const field = card("spend").querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Added the variable.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(button(card("spend"), "Reply"));
    await flush();
    expect(card("spend").textContent).toContain("Added the variable.");
    expect(card("spend").textContent).toContain("Maya Chen");
    expect(card("spend").textContent).toContain("just now");
    expect(actions.reply).toHaveBeenCalledWith({ threadId: "spend", body: "Added the variable." });
    await act(async () => answer.resolve({ ok: true }));
  });
});

describe("ThreadList: a new thread", () => {
  /** The page's side of the composer: it opens on the anchor and closes when told. */
  function ComposerHost({ onClosed }: { onClosed: () => void }) {
    const review = useReviewThreads(THREADS);
    return (
      <>
        <button data-open onClick={() => review.openComposer({ blockId: "b2", quote: "bonus points" })}>
          open
        </button>
        <ThreadList
          {...base}
          threads={review.threads}
          onMutate={review.mutate}
          activeThreadId={review.activeThreadId}
          onActivate={review.setActive}
          composer={review.composer}
          onComposerClose={() => {
            review.closeComposer();
            onClosed();
          }}
        />
      </>
    );
  }
  const type = (el: HTMLTextAreaElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const compose = () => container.querySelector<HTMLElement>("[data-compose]")!;

  it("posts on the version on screen, shows the thread at once, and closes the composer when the server answers", async () => {
    const answer = deferred<{ ok: true; threadId: string }>();
    actions.addComment.mockReturnValue(answer.promise);
    const onClosed = vi.fn();
    act(() => root.render(<ComposerHost onClosed={onClosed} />));
    click(container.querySelector<HTMLElement>("[data-open]")!);
    expect(compose()).toBeTruthy();
    type(compose().querySelector("textarea")!, "Name the bonus.");
    click(button(compose(), "Comment"));
    await flush();

    expect(actions.addComment).toHaveBeenCalledWith({
      templateId: "UC-4F7K2Q",
      versionId: "v_draft",
      blockId: "b2",
      quote: "bonus points",
      body: "Name the bonus.",
    });
    // On its way: the composer is out of sight and the thread is in the list, in the viewer's name.
    expect(compose().hidden).toBe(true);
    const created = container.querySelector<HTMLElement>('[data-thread^="optimistic-thread"]')!;
    expect(created.textContent).toContain("Name the bonus.");
    expect(created.textContent).toContain("Maya Chen");
    // It can't be replied to or resolved until the server has it.
    expect(button(created, "Resolve").hasAttribute("disabled")).toBe(true);

    await act(async () => answer.resolve({ ok: true, threadId: "th_1" }));
    expect(onClosed).toHaveBeenCalled();
    expect(container.querySelector("[data-compose]")).toBeNull();
  });

  it("brings the composer back with its text and the reason when the post is refused", async () => {
    actions.addComment.mockResolvedValue({ ok: false, reason: "That block isn't in this version any more." });
    act(() => root.render(<ComposerHost onClosed={() => {}} />));
    click(container.querySelector<HTMLElement>("[data-open]")!);
    type(compose().querySelector("textarea")!, "Name the bonus.");
    click(button(compose(), "Comment"));
    await flush();
    await flush();
    expect(compose().hidden).toBe(false);
    expect(compose().querySelector("textarea")!.value).toBe("Name the bonus.");
    expect(compose().querySelector('[role="alert"]')?.textContent).toBe("That block isn't in this version any more.");
    expect(container.querySelector('[data-thread^="optimistic-thread"]')).toBeNull();
  });

  it("leaves a thread that nobody wrote anything in unposted", () => {
    act(() => root.render(<ComposerHost onClosed={() => {}} />));
    click(container.querySelector<HTMLElement>("[data-open]")!);
    expect(button(compose(), "Comment").hasAttribute("disabled")).toBe(true);
  });

  it("cancels on Cancel and on Escape", () => {
    const onClosed = vi.fn();
    act(() => root.render(<ComposerHost onClosed={onClosed} />));
    click(container.querySelector<HTMLElement>("[data-open]")!);
    click(button(compose(), "Cancel"));
    expect(container.querySelector("[data-compose]")).toBeNull();
    click(container.querySelector<HTMLElement>("[data-open]")!);
    act(() => {
      compose().querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(container.querySelector("[data-compose]")).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(2);
    expect(actions.addComment).not.toHaveBeenCalled();
  });
});

// ── Focus, drafts, and the document changing under the threads ────────────────────────────────────

/** A real press: the button takes focus first (as it does under a pointer or the keyboard), then it is clicked. */
const press = (el: HTMLElement) =>
  act(() => {
    el.focus();
    el.click();
  });
const typeInto = (el: HTMLTextAreaElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const esc = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
/** Animation frames, for the focus a list returns after a host has had its turn. */
const frames = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80)));
const replyOf = (id: string) => card(id).querySelector<HTMLElement>('[data-slot="reply"]')!;
const OPEN = THREADS.filter((t) => t.status === "open");

/** The page: the server's list in state (so a test can send the refreshed one), the shared hook, and a button that opens the composer. */
function Page({
  initial = THREADS,
  onList,
  onClose,
  withOpener = true,
}: {
  initial?: ThreadView[];
  onList?: (set: (next: ThreadView[]) => void, review: ReturnType<typeof useReviewThreads>) => void;
  onClose?: (outcome?: string) => void;
  withOpener?: boolean;
}) {
  const [server, setServer] = useState(initial);
  const review = useReviewThreads(server);
  onList?.(setServer, review);
  return (
    <>
      {withOpener ? (
        <button data-opener onClick={() => review.openComposer({ blockId: "b2", quote: "bonus points" })}>
          opener
        </button>
      ) : null}
      <ThreadList
        {...base}
        threads={review.threads}
        onMutate={review.mutate}
        activeThreadId={review.activeThreadId}
        onActivate={review.setActive}
        composer={review.composer}
        onComposerClose={(outcome) => {
          review.closeComposer();
          onClose?.(outcome);
        }}
        blockText={(blockId) => (blockId === "b5" ? "Annual percentage rate for purchases, set by the prime rate and a margin." : null)}
      />
    </>
  );
}

describe("ThreadList: focus never falls to the page", () => {
  /** The server's list after it resolved a thread. */
  const resolvedIn = (list: ThreadView[], id: string) =>
    list.map((t) => (t.id === id ? { ...t, status: "resolved" as const, resolvedBy: MAYA, resolvedAt: NOW } : t));

  it("after Resolve, moves to the next open card's Reply, and stays there when the server answers", async () => {
    const answer = deferred<{ ok: true }>();
    actions.resolveThread.mockReturnValue(answer.promise);
    let send!: (next: ThreadView[]) => void;
    act(() => root.render(<Page onList={(set) => (send = set)} />));
    press(button(card("spend"), "Resolve"));
    await flush();
    expect(order()).not.toContain("spend");
    expect(document.activeElement).toBe(replyOf("apr"));
    // Focus moved there; the document didn't follow it to another thread.
    expect(card("apr").hasAttribute("data-active")).toBe(false);
    await act(async () => {
      send(resolvedIn(THREADS, "spend"));
      answer.resolve({ ok: true });
    });
    expect(document.activeElement).toBe(replyOf("apr"));
  });

  it("after resolving the last open card of several, moves to the one before it", async () => {
    actions.resolveThread.mockReturnValue(deferred<{ ok: true }>().promise);
    act(() => root.render(<Page initial={OPEN.filter((t) => t.id !== "gone")} />));
    press(button(card("apr"), "Resolve"));
    await flush();
    expect(order()).not.toContain("apr");
    expect(document.activeElement).toBe(replyOf("spend"));
  });

  it("when none are left open, moves to the Resolved (N) toggle", async () => {
    actions.resolveThread.mockReturnValue(deferred<{ ok: true }>().promise);
    act(() => root.render(<Page initial={[THREADS[1]]} />));
    press(button(card("spend"), "Resolve"));
    await flush();
    const toggle = container.querySelector<HTMLElement>('[data-slot="resolved-toggle"]')!;
    expect(toggle.textContent).toContain("Resolved (1)");
    expect(document.activeElement).toBe(toggle);
  });

  it("doesn't take focus from where the person has gone since", async () => {
    const answer = deferred<{ ok: true }>();
    actions.resolveThread.mockReturnValue(answer.promise);
    act(() => root.render(<Page />));
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    press(button(card("spend"), "Resolve"));
    act(() => elsewhere.focus());
    await act(async () => answer.resolve({ ok: true }));
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("after Reopen, follows the card into the open list", async () => {
    actions.reopenThread.mockReturnValue(deferred<{ ok: true }>().promise);
    act(() => root.render(<Page />));
    click(button(container, /Resolved \(2\)/));
    press(button(card("old-1"), "Reopen"));
    await flush();
    expect(order()).toContain("old-1");
    expect(document.activeElement).toBe(card("old-1"));
  });

  it("after a post, moves to the new thread's card once it has its real id", async () => {
    const answer = deferred<{ ok: true; threadId: string }>();
    actions.addComment.mockReturnValue(answer.promise);
    let send!: (next: ThreadView[]) => void;
    act(() => root.render(<Page onList={(set) => (send = set)} />));
    press(container.querySelector<HTMLElement>("[data-opener]")!);
    typeInto(container.querySelector<HTMLElement>("[data-compose]")!.querySelector("textarea")!, "Name the bonus.");
    press(button(container.querySelector<HTMLElement>("[data-compose]")!, "Comment"));
    await flush();
    // On its way the card shows under a temporary id; nothing is focused yet.
    expect(container.querySelector('[data-thread^="optimistic-thread"]')).toBeTruthy();

    // The server answers: the composer closes, and its list (with the thread under its real id) arrives with it.
    const created = thread("th_1", "b2", { quote: "bonus points" });
    await act(async () => {
      send([...THREADS.slice(0, 2), created, ...THREADS.slice(2)]);
      answer.resolve({ ok: true, threadId: "th_1" });
    });
    await flush();
    expect(container.querySelector("[data-compose]")).toBeNull();
    expect(document.activeElement).toBe(card("th_1"));
    expect(card("th_1").hasAttribute("data-active")).toBe(true);
  });

  it("waits for the real id when the list comes after the answer", async () => {
    actions.addComment.mockResolvedValue({ ok: true, threadId: "th_2" });
    let send!: (next: ThreadView[]) => void;
    act(() => root.render(<Page onList={(set) => (send = set)} />));
    press(container.querySelector<HTMLElement>("[data-opener]")!);
    typeInto(container.querySelector<HTMLElement>("[data-compose]")!.querySelector("textarea")!, "Name the bonus.");
    press(button(container.querySelector<HTMLElement>("[data-compose]")!, "Comment"));
    await flush();
    await flush();
    expect(container.querySelector("[data-compose]")).toBeNull();
    expect(document.activeElement).toBe(document.body);
    await act(async () => send([...THREADS, thread("th_2", "b2", { quote: "bonus points" })]));
    expect(document.activeElement).toBe(card("th_2"));
  });

  it("after Esc, returns to the control that opened the box", async () => {
    act(() => root.render(<Page />));
    const opener = container.querySelector<HTMLElement>("[data-opener]")!;
    press(opener);
    const field = container.querySelector<HTMLElement>("[data-compose] textarea")!;
    expect(document.activeElement).toBe(field);
    esc(field);
    await frames();
    expect(container.querySelector("[data-compose]")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("after Cancel, with the opener gone, falls back to the list", async () => {
    act(() => root.render(<Page />));
    press(container.querySelector<HTMLElement>("[data-opener]")!);
    // The opener goes (a selection's Comment button closes with the box).
    act(() => root.render(<Page withOpener={false} initial={THREADS} />));
    expect(container.querySelector("[data-opener]")).toBeNull();
    press(button(container.querySelector<HTMLElement>("[data-compose]")!, "Cancel"));
    await frames();
    expect(document.activeElement).toBe(container.querySelector('[data-slot="thread-list"]'));
  });

  it("leaves the caret to the host when the box came from the document", async () => {
    // A stand-in for the editor: the opener is inside a .ProseMirror.
    const host = document.createElement("div");
    host.className = "ProseMirror";
    host.tabIndex = 0;
    document.body.append(host);
    function FromDocument() {
      const review = useReviewThreads(THREADS);
      return (
        <>
          <button data-open onClick={() => review.openComposer({ blockId: "b2", quote: "bonus points" })}>
            open
          </button>
          <ThreadList {...base} threads={review.threads} composer={review.composer} onComposerClose={review.closeComposer} onMutate={review.mutate} />
        </>
      );
    }
    act(() => root.render(<FromDocument />));
    act(() => host.focus());
    click(container.querySelector<HTMLElement>("[data-open]")!); // opened while the "editor" has focus
    esc(container.querySelector<HTMLElement>("[data-compose] textarea")!);
    await frames();
    // The host puts the caret back (the list doesn't): with nobody doing it, nothing is focused.
    expect(document.activeElement).toBe(document.body);
    host.remove();
  });

  it("doesn't take focus back from where the person went in the meantime", async () => {
    act(() => root.render(<Page />));
    press(container.querySelector<HTMLElement>("[data-opener]")!);
    const field = container.querySelector<HTMLElement>("[data-compose] textarea")!;
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    esc(field);
    act(() => elsewhere.focus());
    await frames();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

describe("ThreadList: what was typed isn't lost", () => {
  const compose = () => container.querySelector<HTMLElement>("[data-compose]")!;
  const field = () => compose().querySelector("textarea")!;

  it("keeps the text when the box is closed with Esc, and puts it back on the same anchor", async () => {
    act(() => root.render(<Page />));
    const opener = container.querySelector<HTMLElement>("[data-opener]")!;
    press(opener);
    typeInto(field(), "Name the bonus, and say how it is earned.");
    esc(field());
    expect(container.querySelector("[data-compose]")).toBeNull();
    press(opener);
    expect(field().value).toBe("Name the bonus, and say how it is earned.");
    // The caret is after it, not before.
    expect(field().selectionStart).toBe(field().value.length);
    expect(button(compose(), "Comment").hasAttribute("disabled")).toBe(false);
  });

  it("keeps it through Cancel too, and per anchor", async () => {
    function TwoAnchors() {
      const review = useReviewThreads(THREADS);
      return (
        <>
          <button data-a onClick={() => review.openComposer({ blockId: "b2", quote: "bonus points" })}>a</button>
          <button data-b onClick={() => review.openComposer({ blockId: "b5" })}>b</button>
          <ThreadList {...base} threads={review.threads} composer={review.composer} onComposerClose={review.closeComposer} onMutate={review.mutate} />
        </>
      );
    }
    act(() => root.render(<TwoAnchors />));
    click(container.querySelector<HTMLElement>("[data-a]")!);
    typeInto(field(), "About the bonus.");
    // Switching to another anchor (without closing) keeps what was written on the first.
    click(container.querySelector<HTMLElement>("[data-b]")!);
    expect(field().value).toBe("");
    typeInto(field(), "About the rate.");
    click(button(compose(), "Cancel"));
    click(container.querySelector<HTMLElement>("[data-a]")!);
    expect(field().value).toBe("About the bonus.");
    click(button(compose(), "Cancel"));
    click(container.querySelector<HTMLElement>("[data-b]")!);
    expect(field().value).toBe("About the rate.");
  });

  it("closes an empty box without keeping anything, and drops a draft once it is posted", async () => {
    actions.addComment.mockResolvedValue({ ok: true, threadId: "th_9" });
    act(() => root.render(<Page />));
    const opener = container.querySelector<HTMLElement>("[data-opener]")!;
    press(opener);
    esc(field());
    press(opener);
    expect(field().value).toBe("");

    typeInto(field(), "Posted text.");
    press(button(compose(), "Comment"));
    await flush();
    await flush();
    expect(container.querySelector("[data-compose]")).toBeNull();
    press(opener);
    expect(field().value).toBe("");
  });

  it("keeps a reply that was closed without sending", () => {
    act(() => root.render(<Page />));
    click(replyOf("spend"));
    const reply = card("spend").querySelector("textarea")!;
    typeInto(reply, "Will do.");
    esc(reply);
    expect(card("spend").querySelector("textarea")).toBeNull();
    click(replyOf("spend"));
    expect(card("spend").querySelector("textarea")!.value).toBe("Will do.");
  });
});

describe("ThreadList: the document changes under the threads", () => {
  const para = (id: string) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text: "x" }] });
  const docOf = (...ids: string[]) => ({ type: "doc", content: ids.map(para) });

  it("moves a thread to On removed content when its block is deleted, and back when it returns", () => {
    let review!: ReturnType<typeof useReviewThreads>;
    act(() =>
      root.render(
        <Page
          onList={(_set, r) => {
            review = r;
          }}
        />,
      ),
    );
    expect(container.querySelector('[aria-label="Comments on removed content"] [data-thread="spend"]')).toBeNull();
    expect(order()).toEqual(["doc", "spend", "apr", "gone"]);

    // The author deletes the block "spend" is about (b2). The others stay.
    act(() => review.trackDocument(docOf("b5")));
    const removed = container.querySelector('[aria-label="Comments on removed content"]')!;
    expect(removed.querySelector('[data-thread="spend"]')).toBeTruthy();
    expect(order()).toEqual(["doc", "apr", "spend", "gone"]);

    // Undo brings it back: the thread returns to the document's order, and "gone" (b99) stays where it was.
    act(() => review.trackDocument(docOf("b2", "b5")));
    expect(container.querySelector('[aria-label="Comments on removed content"] [data-thread="spend"]')).toBeNull();
    expect(order()).toEqual(["doc", "spend", "apr", "gone"]);
  });
});

describe("ThreadList: a card about a whole block says what block", () => {
  it("shows the start of the block's text where a quote would be, quieter and on one line", () => {
    act(() => root.render(<Page />));
    const snippet = card("apr").querySelector<HTMLElement>('[data-slot="block-snippet"]')!;
    expect(snippet.textContent).toBe("Annual percentage rate for purchases, set by the prime rate and a margin.");
    expect(snippet.querySelector("span")!.className).toContain("truncate");
    expect(card("apr").querySelector('[data-slot="quote"]')).toBeNull();
  });

  it("leaves a quoted card on its quote, and the change request and orphaned ones without a line", () => {
    act(() => root.render(<Page />));
    expect(card("spend").querySelector('[data-slot="quote"]')?.textContent).toBe("$4,000 on purchases");
    expect(card("spend").querySelector('[data-slot="block-snippet"]')).toBeNull();
    expect(card("doc").querySelector('[data-slot="block-snippet"]')).toBeNull();
    expect(card("gone").querySelector('[data-slot="block-snippet"]')).toBeNull();
  });

  it("shows it in the composer too, when the comment is about the whole block", () => {
    function Block() {
      const review = useReviewThreads(THREADS);
      return (
        <>
          <button data-open onClick={() => review.openComposer({ blockId: "b5" })}>open</button>
          <ThreadList {...base} threads={review.threads} composer={review.composer} onComposerClose={review.closeComposer} onMutate={review.mutate} blockText={() => "Annual percentage rate"} />
        </>
      );
    }
    act(() => root.render(<Block />));
    click(container.querySelector<HTMLElement>("[data-open]")!);
    expect(container.querySelector("[data-compose] [data-slot='block-snippet']")?.textContent).toBe("Annual percentage rate");
  });
});
