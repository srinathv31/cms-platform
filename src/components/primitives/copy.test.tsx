// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyText, useCopy } from "./copy";

// Copying text: the async Clipboard API, then a hidden textarea where that is unavailable; and the
// confirmation that shows for a moment after a copy that got there.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const writeText = vi.fn<(text: string) => Promise<void>>();
const execCommand = vi.fn<(command: string) => boolean>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  execCommand.mockReset().mockReturnValue(true);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("copyText", () => {
  it("uses the async clipboard when it can", async () => {
    expect(await copyText("UC-4F7K2Q")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("UC-4F7K2Q");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to a hidden textarea, leaves nothing behind and gives focus back", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    let copied = "";
    execCommand.mockImplementation(() => {
      copied = document.querySelector("textarea")?.value ?? "";
      return true;
    });

    expect(await copyText("curl -X POST")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toBe("curl -X POST");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("falls back where there is no async clipboard at all (an insecure context)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    expect(await copyText("x")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("says so when neither got it there", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    execCommand.mockReturnValue(false);
    expect(await copyText("x")).toBe(false);
    execCommand.mockImplementation(() => {
      throw new Error("unsupported");
    });
    expect(await copyText("x")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

describe("useCopy", () => {
  let root: Root;
  let container: HTMLElement;
  let api: ReturnType<typeof useCopy>;

  function Probe({ ms }: { ms?: number }) {
    api = useCopy(ms);
    return <span data-copied={api.copied} />;
  }
  const copied = () => container.querySelector("span")?.getAttribute("data-copied");

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("confirms a copy for 1.6 seconds by default", async () => {
    await act(async () => root.render(<Probe />));
    vi.useFakeTimers();
    let ok = false;
    await act(async () => {
      ok = await api.copy("UC-4F7K2Q");
    });
    expect(ok).toBe(true);
    expect(copied()).toBe("true");
    await act(async () => vi.advanceTimersByTime(1599));
    expect(copied()).toBe("true");
    await act(async () => vi.advanceTimersByTime(1));
    expect(copied()).toBe("false");
  });

  it("confirms for as long as asked, and restarts the time on another copy", async () => {
    await act(async () => root.render(<Probe ms={2000} />));
    vi.useFakeTimers();
    await act(async () => void (await api.copy("a")));
    await act(async () => vi.advanceTimersByTime(1500));
    await act(async () => void (await api.copy("b")));
    await act(async () => vi.advanceTimersByTime(1500));
    expect(copied()).toBe("true");
    await act(async () => vi.advanceTimersByTime(500));
    expect(copied()).toBe("false");
  });

  it("confirms nothing when the copy failed", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    execCommand.mockReturnValue(false);
    await act(async () => root.render(<Probe />));
    let ok = true;
    await act(async () => {
      ok = await api.copy("x");
    });
    expect(ok).toBe(false);
    expect(copied()).toBe("false");
  });

  it("takes the confirmation down on reset", async () => {
    await act(async () => root.render(<Probe />));
    await act(async () => void (await api.copy("x")));
    expect(copied()).toBe("true");
    await act(async () => api.reset());
    expect(copied()).toBe("false");
  });
});
