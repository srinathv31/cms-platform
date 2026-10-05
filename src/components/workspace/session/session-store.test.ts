import { describe, expect, it, vi } from "vitest";
import { createWorkspaceSession, INITIAL_PREVIEW } from "./session-store";

describe("workspace session", () => {
  it("holds changes made before the autosave host connects, then hands them over merged", () => {
    const session = createWorkspaceSession();
    session.save({ name: "First" });
    session.save({ name: "Second", channels: ["pdf"] });

    const save = vi.fn();
    session.attach(save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: "Second", channels: ["pdf"] });

    session.save({ name: "Third" });
    expect(save).toHaveBeenLastCalledWith({ name: "Third" });
  });

  it("keeps the binding when the same draft is bound again (tab switch, re-render)", () => {
    const session = createWorkspaceSession();
    const listener = vi.fn();
    session.subscribe(listener);

    session.bind({ versionId: "v_1", rev: 3 });
    session.bind({ versionId: "v_1", rev: 9 });
    expect(session.getBinding()).toEqual({ versionId: "v_1", rev: 3 });
    expect(listener).toHaveBeenCalledTimes(1);

    session.bind({ versionId: "v_2", rev: 0 });
    expect(session.getBinding()).toEqual({ versionId: "v_2", rev: 0 });
  });

  it("resets the status when a read-only page unbinds", () => {
    const session = createWorkspaceSession();
    session.bind({ versionId: "v_1", rev: 0 });
    session.publishStatus({ status: "error", error: "Not saved." });
    expect(session.getStatus().status).toBe("error");

    session.bind(null);
    expect(session.getBinding()).toBeNull();
    expect(session.getStatus()).toEqual({ status: "saved" });
  });

  it("focuses the first section through the editor handle, and is safe without one", () => {
    const session = createWorkspaceSession();
    expect(() => session.focusDocument()).not.toThrow();

    const focus = vi.fn();
    session.setEditor({
      focus,
      focusThread: () => {},
      getBlockRect: () => null,
      getThreadRect: () => null,
      subscribeBlockRects: () => () => {},
      requestComment: () => {},
    });
    session.focusDocument();
    expect(focus).toHaveBeenCalledWith("first-section");

    session.setEditor(null);
    session.focusDocument();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  describe("flush", () => {
    it("resolves at once with nothing bound", async () => {
      const session = createWorkspaceSession();
      await expect(session.flush()).resolves.toBeUndefined();
    });

    it("resolves at once when a draft is bound but nothing is held and no host has connected", async () => {
      const session = createWorkspaceSession();
      session.bind({ versionId: "v_1", rev: 0 });
      await expect(session.flush()).resolves.toBeUndefined();
    });

    it("asks the connected host to send what it has, and resolves when it has", async () => {
      const session = createWorkspaceSession();
      let finish = () => {};
      const flush = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      session.bind({ versionId: "v_1", rev: 0 });
      session.attach(vi.fn(), flush);

      let done = false;
      const flushed = session.flush().then(() => {
        done = true;
      });
      expect(flush).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      expect(done).toBe(false);

      finish();
      await flushed;
      expect(done).toBe(true);
    });

    it("hands changes held before the host connected to it, then flushes, before resolving", async () => {
      const session = createWorkspaceSession();
      session.bind({ versionId: "v_1", rev: 0 });
      session.save({ name: "First" });
      session.save({ emailSubject: null });

      const calls: string[] = [];
      let finish = () => {};
      const save = vi.fn(() => void calls.push("save"));
      const flush = vi.fn(() => {
        calls.push("flush");
        return new Promise<void>((resolve) => (finish = resolve));
      });

      let done = false;
      const flushed = session.flush().then(() => {
        done = true;
      });
      await Promise.resolve();
      expect(done).toBe(false);
      expect(save).not.toHaveBeenCalled();

      session.attach(save, flush);
      expect(save).toHaveBeenCalledWith({ name: "First", emailSubject: null });
      expect(calls).toEqual(["save", "flush"]);
      await Promise.resolve();
      expect(done).toBe(false);

      finish();
      await flushed;
      expect(done).toBe(true);
    });

    it("lets a caller waiting for a host go when the page turns read-only", async () => {
      const session = createWorkspaceSession();
      session.bind({ versionId: "v_1", rev: 0 });
      session.save({ name: "Held" });
      const flushed = session.flush();
      session.bind(null);
      await expect(flushed).resolves.toBeUndefined();
    });

    it("resolves at once again after the host disconnects with nothing held", async () => {
      const session = createWorkspaceSession();
      session.bind({ versionId: "v_1", rev: 0 });
      session.attach(vi.fn(), () => Promise.resolve());
      session.attach(null);
      await expect(session.flush()).resolves.toBeUndefined();
    });

    it("resolves even when the host's flush ended in a failure (the status reports it)", async () => {
      const session = createWorkspaceSession();
      session.bind({ versionId: "v_1", rev: 0 });
      session.attach(vi.fn(), () => Promise.resolve());
      session.publishStatus({ status: "error", error: "Not saved." });
      await expect(session.flush()).resolves.toBeUndefined();
      expect(session.getStatus().status).toBe("error");
    });
  });
  describe("preview", () => {
    it("starts closed on the Preview view, PDF, the Typical set and the desktop width", () => {
      const session = createWorkspaceSession();
      expect(session.getPreview()).toEqual({
        open: false,
        view: "preview",
        channel: "pdf",
        setId: "typical",
        device: "desktop",
      });
      expect(session.getPreview()).toBe(INITIAL_PREVIEW);
    });

    it("opens on the Preview view, even when it was closed on Variables", () => {
      const session = createWorkspaceSession();
      session.setPreview({ view: "variables" });
      session.openPreview();
      expect(session.getPreview()).toMatchObject({ open: true, view: "preview" });

      session.closePreview();
      expect(session.getPreview().open).toBe(false);
    });

    it("keeps the author's picks across a close and an open", () => {
      const session = createWorkspaceSession();
      session.openPreview();
      session.setPreview({ channel: "email", setId: "long", device: "mobile" });
      session.closePreview();
      session.openPreview();
      expect(session.getPreview()).toEqual({
        open: true,
        view: "preview",
        channel: "email",
        setId: "long",
        device: "mobile",
      });
    });

    it("hands out a new snapshot only when something changed, and tells subscribers once", () => {
      const session = createWorkspaceSession();
      const listener = vi.fn();
      session.subscribe(listener);

      const before = session.getPreview();
      session.setPreview({ channel: "pdf", device: "desktop" });
      session.closePreview();
      expect(session.getPreview()).toBe(before);
      expect(listener).not.toHaveBeenCalled();

      session.setPreview({ channel: "web", device: "mobile" });
      expect(session.getPreview()).not.toBe(before);
      expect(before.channel).toBe("pdf");
      expect(listener).toHaveBeenCalledTimes(1);

      session.openPreview();
      session.openPreview();
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("is not touched by binding a draft or a read-only page", () => {
      const session = createWorkspaceSession();
      session.openPreview();
      session.bind({ versionId: "v_1", rev: 0 });
      session.bind(null);
      expect(session.getPreview().open).toBe(true);
    });
  });

  describe("save tick", () => {
    it("starts at 0", () => {
      expect(createWorkspaceSession().getSaveTick()).toBe(0);
    });

    it("counts each save that lands, and nothing else", () => {
      const session = createWorkspaceSession();
      const listener = vi.fn();
      session.subscribe(listener);

      session.publishStatus({ status: "unsaved" });
      session.publishStatus({ status: "saving" });
      expect(session.getSaveTick()).toBe(0);
      session.publishStatus({ status: "saved" });
      expect(session.getSaveTick()).toBe(1);
      // The same status again is not a landing.
      session.publishStatus({ status: "saved" });
      expect(session.getSaveTick()).toBe(1);

      session.publishStatus({ status: "unsaved" });
      session.publishStatus({ status: "saving" });
      session.publishStatus({ status: "saved" });
      expect(session.getSaveTick()).toBe(2);
      expect(listener).toHaveBeenCalled();
    });

    it("does not count a failed save, but counts the retry that lands", () => {
      const session = createWorkspaceSession();
      session.publishStatus({ status: "saving" });
      session.publishStatus({ status: "error", error: "Not saved. Retrying…" });
      session.publishStatus({ status: "saved" });
      expect(session.getSaveTick()).toBe(0);

      session.publishStatus({ status: "saving" });
      session.publishStatus({ status: "error", error: "Not saved." });
      session.publishStatus({ status: "saving" });
      session.publishStatus({ status: "saved" });
      expect(session.getSaveTick()).toBe(1);
    });

    it("does not count a status reset (binding a different draft, or a read-only page)", () => {
      const session = createWorkspaceSession();
      session.bind({ versionId: "v_1", rev: 0 });
      session.publishStatus({ status: "saving" });
      session.bind(null);
      expect(session.getSaveTick()).toBe(0);
      session.publishStatus({ status: "saved" });
      expect(session.getSaveTick()).toBe(0);
    });

    it("notifies subscribers when it changes, so useSyncExternalStore readers update", () => {
      const session = createWorkspaceSession();
      session.publishStatus({ status: "saving" });
      const seen: number[] = [];
      session.subscribe(() => seen.push(session.getSaveTick()));
      session.publishStatus({ status: "saved" });
      expect(seen).toEqual([1]);
    });
  });
});

describe("the rail's comments view", () => {
  it("starts with no tab picked, so the rail can open on what is waiting", () => {
    expect(createWorkspaceSession().getRailTab()).toBeNull();
  });

  it("remembers the tab the author picks, and tells subscribers once", () => {
    const session = createWorkspaceSession();
    const listener = vi.fn();
    session.subscribe(listener);
    session.selectRailView("variables");
    session.selectRailView("variables");
    expect(session.getRailTab()).toBe("variables");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("changes the widened rail's view only while the preview is open, and Preview isn't a plain-rail tab", () => {
    const session = createWorkspaceSession();
    session.selectRailView("comments");
    expect(session.getPreview().view).toBe(INITIAL_PREVIEW.view);

    session.openPreview();
    session.selectRailView("variables");
    expect(session.getPreview().view).toBe("variables");
    expect(session.getRailTab()).toBe("variables");

    // Back to the output: the plain rail keeps the tab it had.
    session.selectRailView("preview");
    expect(session.getPreview().view).toBe("preview");
    expect(session.getRailTab()).toBe("variables");
  });

  it("shows the comments: the Comments tab, the widened rail's too, and the overlay where the rail is one", () => {
    const session = createWorkspaceSession();
    session.selectRailView("variables");
    session.showComments();
    expect(session.getRailTab()).toBe("comments");
    expect(session.getRailOpen()).toBe(true);

    session.openPreview();
    expect(session.getPreview().view).toBe("preview");
    session.showComments();
    expect(session.getPreview().view).toBe("comments");
  });

  it("notifies nobody when the comments are already showing", () => {
    const session = createWorkspaceSession();
    session.showComments();
    const listener = vi.fn();
    session.subscribe(listener);
    session.showComments();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("the imported original", () => {
  it("widens the rail on the Original view, keeping the preview's picks", () => {
    const session = createWorkspaceSession();
    session.setPreview({ channel: "web", setId: "edge" });
    session.openOriginal();
    expect(session.getPreview()).toMatchObject({ open: true, view: "original", channel: "web", setId: "edge" });
    session.closePreview();
    expect(session.getPreview().open).toBe(false);
  });

  it("switches between Original and the other views while widened, and isn't a plain-rail tab", () => {
    const session = createWorkspaceSession();
    session.selectRailView("variables");
    session.openOriginal();
    session.selectRailView("preview");
    expect(session.getPreview().view).toBe("preview");
    session.selectRailView("original");
    expect(session.getPreview().view).toBe("original");
    expect(session.getRailTab()).toBe("variables");
  });

  it("notifies nobody when it is already open on the Original view", () => {
    const session = createWorkspaceSession();
    session.openOriginal();
    const listener = vi.fn();
    session.subscribe(listener);
    session.openOriginal();
    expect(listener).not.toHaveBeenCalled();
  });
});
