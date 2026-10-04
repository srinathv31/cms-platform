// @vitest-environment happy-dom
import { Activity, StrictMode, act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftPatch } from "@/domain/types";
import { useDraftAutosave, type DraftAutosave } from "./use-draft-autosave";

// The hook is a thin wrapper, so these cover only the wiring: the mount-time session key, the
// flush on each way of leaving, and read-only mode. The scheduling is tested in autosave-scheduler.test.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: DraftAutosave;
let root: Root;
let container: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function Probe({ disabled = false }: { disabled?: boolean }) {
  const result = useDraftAutosave({ versionId: "v_abc", initialRev: 7, disabled });
  // Hand the latest result to the test; an effect, because render must not write to outer variables.
  useEffect(() => {
    api = result;
  });
  return <span data-status={result.status}>{result.error ?? result.status}</span>;
}

const answer = (rev: number) =>
  new Response(JSON.stringify({ ok: true, rev, savedAt: "2026-10-04T10:00:00.000Z" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const sent = (index: number): { url: string; init: RequestInit; patch: DraftPatch } => {
  const [url, init] = fetchMock.mock.calls[index]!;
  return { url: String(url), init: init!, patch: JSON.parse(init!.body as string) as DraftPatch };
};

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => answer(8));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setVisibility("visible");
});

describe("useDraftAutosave", () => {
  it("saves 800 ms after a change, with the initial rev and one session key per mount", async () => {
    await render(<Probe />);
    expect(api.status).toBe("saved");

    await act(async () => api.save({ name: "First" }));
    expect(api.status).toBe("unsaved");
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const first = sent(0);
    expect(first.url).toBe("/api/drafts/v_abc");
    expect(first.init.method).toBe("PUT");
    expect(first.patch).toMatchObject({ rev: 7, name: "First" });
    expect(first.patch.sessionKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.status).toBe("saved");

    await act(async () => api.save({ name: "Second" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));
    const second = sent(1);
    expect(second.patch).toMatchObject({ rev: 8, name: "Second" }); // the rev from the first answer
    expect(second.patch.sessionKey).toBe(first.patch.sessionKey);
  });

  it("starts a new session key when the last save is more than 30 minutes old", async () => {
    await render(<Probe />);
    await act(async () => api.save({ name: "Morning" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));

    await act(async () => void (await vi.advanceTimersByTimeAsync(10 * 60_000)));
    await act(async () => api.save({ name: "Ten minutes later" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));

    await act(async () => void (await vi.advanceTimersByTimeAsync(31 * 60_000)));
    await act(async () => api.save({ name: "After lunch" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));

    const keys = [0, 1, 2].map((i) => sent(i).patch.sessionKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[2]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent(2).patch.rev).toBe(8); // the rev line carries on; only the audit session changes
  });

  it("flushes with keepalive when the tab is hidden", async () => {
    await render(<Probe />);
    await act(async () => api.save({ name: "Before hiding" }));
    await act(async () => setVisibility("hidden"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0).init.keepalive).toBe(true);
    expect(sent(0).patch.name).toBe("Before hiding");
  });

  it("does not flush when the tab becomes visible again", async () => {
    await render(<Probe />);
    await act(async () => api.save({ name: "x" }));
    await act(async () => setVisibility("visible"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flushes with keepalive on pagehide", async () => {
    await render(<Probe />);
    await act(async () => api.save({ name: "Closing" }));
    await act(async () => void window.dispatchEvent(new Event("pagehide")));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0).init.keepalive).toBe(true);
  });

  it("flushes when the component unmounts", async () => {
    await render(<Probe />);
    await act(async () => api.save({ name: "Navigating away" }));
    await act(async () => root.unmount());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0).init.keepalive).toBe(true);
    root = createRoot(container); // the afterEach unmounts this one
  });

  it("flushes when Next hides the route (<Activity> runs the cleanup), and keeps saving when it is shown again", async () => {
    await render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    await act(async () => api.save({ name: "Before leaving" }));
    await render(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0).patch.name).toBe("Before leaving");

    await render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    // Same instance, same session, listeners back on.
    await act(async () => api.save({ name: "Back again" }));
    await act(async () => setVisibility("hidden"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1).patch.sessionKey).toBe(sent(0).patch.sessionKey);
    expect(sent(1).patch.name).toBe("Back again");
  });

  it("sends nothing in StrictMode's mount, cleanup, mount, and keeps one session key", async () => {
    await render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => api.save({ name: "A" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));
    await act(async () => api.save({ name: "B" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1).patch.sessionKey).toBe(sent(0).patch.sessionKey);
  });

  it("sends again on the 'online' event after a failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await render(<Probe />);
    await act(async () => api.save({ name: "Offline edit" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));
    expect(api.status).toBe("error");
    expect(api.error).toBe("Not saved. Retrying…");

    await act(async () => void window.dispatchEvent(new Event("online")));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(api.status).toBe("saved");
  });

  it("does nothing while disabled, and starts again when enabled", async () => {
    await render(<Probe disabled />);
    await act(async () => api.save({ name: "Read only" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    await act(async () => setVisibility("hidden"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.status).toBe("saved");

    setVisibility("visible");
    await render(<Probe />);
    await act(async () => api.save({ name: "Editable now" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns stable save and flush functions", async () => {
    await render(<Probe />);
    const { save, flush } = api;
    await act(async () => api.save({ name: "x" }));
    expect(api.save).toBe(save);
    expect(api.flush).toBe(flush);
  });
});
