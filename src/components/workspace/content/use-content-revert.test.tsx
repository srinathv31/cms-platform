// @vitest-environment happy-dom
import { act, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, JSONContent, Variable } from "@/domain/types";
import {
  createWorkspaceSession,
  type WorkspaceSession,
} from "../session/session-store";
import type { ContentDraft } from "./content-props";
import { useContentRevert, type ContentRevert } from "./use-content-revert";

// What "Revert to when you opened it" does to the Content page: the fields remount with the values the page
// opened with (`shown.gen` is the key that remounts them), the channels and the live draft follow, the
// threads are told the document, and the canvas keeps its scroll. The session is the real one; the page's
// parts are a probe.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const doc = (text: string): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { id: "b1" },
      content: [{ type: "text", text }],
    },
  ],
});
const variable = (key: string): Variable => ({
  key,
  label: key,
  type: "text",
  required: true,
  sample: "x",
});

const OPENED_BODY = doc("As opened");
const OPENED_VARIABLES = [variable("name")];
const OPENED_CHANNELS: Channel[] = ["pdf", "web"];
const DRAFT: ContentDraft = {
  body: OPENED_BODY,
  variables: OPENED_VARIABLES,
  baseline: null,
  channels: OPENED_CHANNELS,
  allowedChannels: ["pdf", "web", "email"],
  channelFields: {},
  sampleSets: [{ id: "typical", name: "Typical", values: { name: "Maya" } }],
};

let root: Root;
let container: HTMLElement;
let session: WorkspaceSession;
/** The hook as the probe last rendered it. */
const hook: { current: ContentRevert | null } = { current: null };
const content = () => hook.current!;
let bodies: JSONContent[];
let layout: string[];

/** The fields' remount, as the editor root's: a child keyed by `gen`, whose mount lays out before the page's own layout effects. */
function Fields({ gen, onMount }: { gen: number; onMount?: () => void }) {
  useLayoutEffect(() => {
    layout.push(`fields ${gen}`);
    onMount?.();
  }, [gen, onMount]);
  return <span data-gen={gen} />;
}

function Probe({
  editable = true,
  draft = DRAFT,
  onFieldsMount,
}: {
  editable?: boolean;
  draft?: ContentDraft;
  onFieldsMount?: () => void;
}) {
  const result = useContentRevert({
    session,
    editable,
    draft,
    onBodyRestored,
  });
  useEffect(() => {
    hook.current = result;
  });
  return (
    <Fields
      key={result.shown.gen}
      gen={result.shown.gen}
      onMount={onFieldsMount}
    />
  );
}
// Stable, as the hook asks.
function onBodyRestored(body: JSONContent) {
  bodies.push(body);
}

const show = (props: Parameters<typeof Probe>[0] = {}) =>
  act(async () => root.render(<Probe {...props} />));

beforeEach(() => {
  session = createWorkspaceSession();
  session.bind({ versionId: "v1", rev: 1 });
  bodies = [];
  layout = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const revert = () => {
  let replaced = null as ReturnType<WorkspaceSession["revert"]>;
  act(() => {
    replaced = session.revert();
  });
  return replaced;
};

describe("the values the page shows", () => {
  it("are the draft as it opened, in generation 0, with the channels on and the draft as typed", async () => {
    await show();
    expect(content().shown).toMatchObject({
      gen: 0,
      body: OPENED_BODY,
      variables: OPENED_VARIABLES,
      channels: OPENED_CHANNELS,
      "email.subject": null,
      "email.preheader": null,
      sampleSets: DRAFT.sampleSets,
    });
    expect(content().channels).toEqual(OPENED_CHANNELS);
    expect(content().liveDraft.getFields()["email.subject"]).toBeNull();
    expect(content().liveDraft.getSampleSets()).toEqual(DRAFT.sampleSets);
  });

  it("are not reset by a later render with other props: a refresh doesn't take a draft being edited away", async () => {
    await show();
    await show({
      draft: { ...DRAFT, body: doc("Refreshed"), channels: ["pdf"] },
    });
    expect(content().shown.body).toBe(OPENED_BODY);
    expect(content().shown.gen).toBe(0);
    expect(content().channels).toEqual(OPENED_CHANNELS);
  });

  it("keep the channels as the author toggles them, apart from the values the fields mounted with", async () => {
    await show();
    act(() => content().setChannels(["pdf"]));
    expect(content().channels).toEqual(["pdf"]);
    expect(content().shown.channels).toEqual(OPENED_CHANNELS);
    expect(content().shown.gen).toBe(0);
  });
});

describe("Revert to when you opened it", () => {
  it("puts back what changed, remounts the fields with a new generation, and tells the document", async () => {
    await show();
    act(() => content().setChannels(["pdf"]));
    session.save({ body: doc("Edited"), channels: ["pdf"] });
    expect(session.getCanRevert()).toBe(true);

    const replaced = revert();
    expect(replaced).toEqual({ body: doc("Edited"), channels: ["pdf"] });
    expect(content().shown.gen).toBe(1);
    expect(content().shown.body).toBe(OPENED_BODY);
    expect(content().shown.channels).toBe(OPENED_CHANNELS);
    expect(content().channels).toBe(OPENED_CHANNELS);
    expect(bodies).toEqual([OPENED_BODY]);
    expect(layout).toEqual(["fields 0", "fields 1"]); // remounted, not updated
  });

  it("hands the fields a new live draft, built from the values put back", async () => {
    await show();
    const before = content().liveDraft;
    session.save({ variables: [variable("rate")] });
    revert();
    expect(content().liveDraft).not.toBe(before);
    expect(content().liveDraft.getSampleSets()).toEqual(DRAFT.sampleSets);
  });

  it("can be undone: the edited values come back, in a new generation", async () => {
    await show();
    session.save({ body: doc("Edited") });
    const replaced = revert()!;
    expect(content().shown.body).toBe(OPENED_BODY);

    act(() => {
      expect(session.restore(replaced, session.getEditGeneration())).toBe(true);
    });
    expect(content().shown.body).toEqual(doc("Edited"));
    expect(content().shown.gen).toBe(2);
    expect(bodies).toEqual([OPENED_BODY, doc("Edited")]);
  });

  it("leaves a field that wasn't changed as it is: the part of the save that goes back is only what changed", async () => {
    await show();
    session.save({ variables: [variable("rate")] });
    const replaced = revert()!;
    expect(Object.keys(replaced)).toEqual(["variables"]);
    expect(content().shown.variables).toBe(OPENED_VARIABLES);
    expect(content().shown.body).toBe(OPENED_BODY);
  });

  it("shows values handed over by Revert to a version (`replace`), as an edit", async () => {
    await show();
    act(() => {
      session.replace({ body: doc("From v3"), variables: [variable("rate")] });
    });
    expect(content().shown.body).toEqual(doc("From v3"));
    expect(content().shown.variables).toEqual([variable("rate")]);
    expect(content().shown.gen).toBe(1);
    expect(content().shown.sampleSets, "what it didn't replace stays").toBe(
      DRAFT.sampleSets,
    );
    expect(session.getCanRevert()).toBe(true);
  });

  it("is none of this page's business when only another part's field changed", async () => {
    await show();
    const name = { opening: { name: "Opened name" }, restore: vi.fn() };
    session.addRestoreTarget(name);
    session.save({ name: "Renamed" });
    revert();
    expect(name.restore).toHaveBeenCalledTimes(1);
    expect(content().shown.gen).toBe(0);
    expect(bodies).toEqual([]);
  });

  it("is not offered by a read-only page: it joins no revert and shows no new values", async () => {
    await show({ editable: false });
    expect(session.replace({ body: doc("From v3") })).toBeNull();
    act(() => {
      session.save({ body: doc("Edited") });
    });
    expect(session.getCanRevert()).toBe(false);
    expect(content().shown.gen).toBe(0);
  });

  it("joins no revert once the page turns read-only, and leaves it when the page goes", async () => {
    await show();
    expect(session.getOwnedFields()).toContain("body");
    await show({ editable: false });
    expect(session.getOwnedFields()).toBe("");

    await show();
    expect(session.getOwnedFields()).toContain("body");
    await act(async () => root.unmount());
    expect(session.getOwnedFields()).toBe("");
    root = createRoot(container); // for afterEach
  });
});

describe("the scroll", () => {
  /** The app's one scrolling element, with a browser's clamp: the old editor leaving shortens the page, and the scroll with it. */
  function canvas() {
    const el = document.createElement("div");
    el.setAttribute("data-slot", "canvas-scroll");
    let top = 0;
    Object.defineProperty(el, "scrollTop", {
      get: () => top,
      set: (value: number) => (top = value),
    });
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      top = options.top ?? 0;
    });
    el.scrollTo = scrollTo as unknown as typeof el.scrollTo;
    document.body.append(el);
    return {
      el,
      scrollTo,
      scrollBy: (value: number) => (top = value),
      clamp: () => (top = 0),
    };
  }

  it("is put back where it was after a revert, since the page shortens for a moment and the browser clamps it", async () => {
    const page = canvas();
    await show({ onFieldsMount: () => page.clamp() });
    page.scrollBy(640);
    session.save({ body: doc("Edited") });
    revert();
    // The new fields mounted and the clamp had moved the scroll to the top: the page puts it back, with no animation.
    expect(page.scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 640,
      behavior: "instant",
    });
    expect(page.el.scrollTop).toBe(640);
  });

  it("is left alone when it is where it was", async () => {
    const page = canvas();
    await show();
    page.scrollBy(640);
    session.save({ body: doc("Edited") });
    revert();
    expect(page.scrollTo).not.toHaveBeenCalled();
  });

  it("is not set at all for a render that is not a revert", async () => {
    const page = canvas();
    const clamp = () => page.clamp();
    await show({ onFieldsMount: clamp });
    page.scrollBy(300);
    await show({ onFieldsMount: clamp }); // a plain re-render
    expect(page.scrollTo).not.toHaveBeenCalled();
    expect(page.el.scrollTop).toBe(300);
  });
});
