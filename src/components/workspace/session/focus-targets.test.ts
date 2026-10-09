// @vitest-environment happy-dom
// The focus-target registry (handoff review I15): the controls that code sends focus to register themselves,
// and callers find them by name, or wait for one to mount, instead of querying the page by label.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createFocusTargets } from "./focus-targets";
import { createWorkspaceSession } from "./session-store";

afterEach(() => {
  vi.useRealTimers();
});

const element = () => document.createElement("div");

describe("register and get", () => {
  it("finds a control by name while it is registered, and not after", () => {
    const targets = createFocusTargets();
    const row = element();
    expect(targets.get("statusRow")).toBeNull();
    const unregister = targets.register("statusRow", row, "draft");
    expect(targets.get("statusRow")).toBe(row);
    unregister();
    expect(targets.get("statusRow")).toBeNull();
  });

  it("keeps the later of two registrations under one name: the earlier one going takes nothing with it", () => {
    const targets = createFocusTargets();
    const plain = element();
    const widened = element();
    const unregisterPlain = targets.register("originalTab", plain);
    const unregisterWidened = targets.register("originalTab", widened);
    expect(targets.get("originalTab")).toBe(widened);
    unregisterPlain();
    expect(targets.get("originalTab")).toBe(widened);
    unregisterWidened();
    expect(targets.get("originalTab")).toBeNull();
  });

  it("keeps each name to itself", () => {
    const targets = createFocusTargets();
    const toggle = element();
    targets.register("previewToggle", toggle);
    expect(targets.get("previewToggle")).toBe(toggle);
    expect(targets.get("statusRow")).toBeNull();
    expect(targets.get("originalTab")).toBeNull();
  });

  it("is on every workspace session, and registering notifies none of its subscribers", () => {
    const session = createWorkspaceSession();
    const listener = vi.fn();
    session.subscribe(listener);
    const field = document.createElement("textarea");
    const unregister = session.focusTargets.register("name", field);
    expect(session.focusTargets.get("name")).toBe(field);
    unregister();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("waitFor", () => {
  it("resolves at once with the control registered now, when it is the one asked for", async () => {
    const targets = createFocusTargets();
    const row = element();
    targets.register("statusRow", row, "in_review");
    await expect(targets.waitFor("statusRow", { accept: (_, state) => state === "in_review", timeout: 3000 })).resolves.toBe(row);
  });

  it("waits for the control to register, passing over the ones it doesn't accept", async () => {
    const targets = createFocusTargets();
    const draft = element();
    const inReview = element();
    targets.register("statusRow", draft, "draft");
    const settled = vi.fn();
    const waiting = targets.waitFor("statusRow", { accept: (_, state) => state === "in_review", timeout: 3000 }).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    targets.register("statusRow", draft, "draft");
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    targets.register("statusRow", inReview, "in_review");
    await waiting;
    expect(settled).toHaveBeenCalledWith(inReview);
  });

  it("waits for another control than the one going: the header row that replaces it", async () => {
    const targets = createFocusTargets();
    const widened = element();
    const plain = element();
    const unregister = targets.register("originalTab", widened);
    const waiting = targets.waitFor("originalTab", { accept: (tab) => tab !== widened, timeout: 1000 });
    unregister();
    targets.register("originalTab", plain);
    await expect(waiting).resolves.toBe(plain);
  });

  it("takes any one when nothing narrows it", async () => {
    const targets = createFocusTargets();
    const waiting = targets.waitFor("previewToggle", { timeout: 1000 });
    const toggle = element();
    targets.register("previewToggle", toggle);
    await expect(waiting).resolves.toBe(toggle);
  });

  it("gives up with null when the control never comes, and a later registration settles nothing", async () => {
    vi.useFakeTimers();
    const targets = createFocusTargets();
    const settled = vi.fn();
    const waiting = targets.waitFor("statusRow", { accept: (_, state) => state === "in_review", timeout: 3000 }).then(settled);
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(settled).toHaveBeenCalledWith(null);

    targets.register("statusRow", element(), "in_review");
    await Promise.resolve();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("settles every caller waiting for the same control", async () => {
    const targets = createFocusTargets();
    const first = targets.waitFor("originalTab", { timeout: 1000 });
    const second = targets.waitFor("originalTab", { timeout: 1000 });
    const tab = element();
    targets.register("originalTab", tab);
    await expect(Promise.all([first, second])).resolves.toEqual([tab, tab]);
  });
});
