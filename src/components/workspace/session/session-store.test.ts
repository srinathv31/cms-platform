import { describe, expect, it, vi } from "vitest";
import { createWorkspaceSession } from "./session-store";

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
    session.setEditor({ focus });
    session.focusDocument();
    expect(focus).toHaveBeenCalledWith("first-section");

    session.setEditor(null);
    session.focusDocument();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
