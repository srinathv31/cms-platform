// @vitest-environment happy-dom
import { StrictMode, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderError } from "@/domain/render/types";
import { validateValues } from "@/domain/render/validate";
import type { Channel, Variable } from "@/domain/types";
import { renderPreview, type PreviewOutput, type RenderPreviewResult } from "./render-preview";
import { sameOutput, usePreviewRender, VALUES_DEBOUNCE_MS, type UsePreviewRender, type UsePreviewRenderOptions } from "./use-preview-render";

vi.mock("./render-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render-preview")>()),
  renderPreview: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = vi.mocked(renderPreview);

let root: Root;
let container: HTMLElement;
let api: UsePreviewRender;
let flush: ReturnType<typeof vi.fn<() => Promise<void>>>;
const session = { flush: () => flush() };

const variable = (key: string, type: Variable["type"], required: boolean): Variable => ({
  key,
  label: key,
  type,
  required,
  sample: "",
});
const VARIABLES = [variable("first_name", "text", true), variable("purchase_apr", "percent", false)];

const web = (html: string): PreviewOutput => ({ kind: "web", html });
const err = (code: RenderError["code"], message: string): RenderPreviewResult => ({ kind: "error", error: { code, message } });

const base: UsePreviewRenderOptions = {
  templateId: "UC-4F7K2Q",
  version: "draft",
  channel: "web",
  values: { first_name: "Maya" },
  variables: VARIABLES,
  enabled: true,
  saveTick: 0,
  session,
};

function Probe(props: UsePreviewRenderOptions) {
  const result = usePreviewRender(props);
  useEffect(() => {
    api = result;
  });
  return null;
}

async function mount(props: UsePreviewRenderOptions) {
  await act(async () => {
    root.render(
      <StrictMode>
        <Probe {...props} />
      </StrictMode>,
    );
  });
}

/** Lets timers and the promises behind them run. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  flush = vi.fn(() => Promise.resolve());
  render.mockReset();
  render.mockResolvedValue(web("<p>one</p>"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("usePreviewRender", () => {
  it("does nothing while it is not enabled", async () => {
    await mount({ ...base, enabled: false });
    await settle(1000);
    expect(render).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(api.rendering).toBe(false);
  });

  it("sends the pending save before its first render, then renders what the request names", async () => {
    const order: string[] = [];
    flush.mockImplementation(async () => void order.push("flush"));
    render.mockImplementation(async () => {
      order.push("render");
      return web("<p>one</p>");
    });
    await mount(base);
    await settle();

    expect(order).toEqual(["flush", "render"]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]![0]).toMatchObject({
      templateId: "UC-4F7K2Q",
      version: "draft",
      channel: "web",
      values: { first_name: "Maya" },
    });
    expect(api.slots.web).toEqual({ output: web("<p>one</p>"), error: null });
    expect(api.rendering).toBe(false);
  });

  it("renders again at once when a save lands", async () => {
    await mount(base);
    await settle();
    render.mockResolvedValue(web("<p>two</p>"));
    await mount({ ...base, saveTick: 1 });
    await settle();

    expect(render).toHaveBeenCalledTimes(2);
    expect(api.slots.web?.output).toEqual(web("<p>two</p>"));
  });

  it("waits a moment for more typing when only the values changed", async () => {
    await mount(base);
    await settle();
    expect(render).toHaveBeenCalledTimes(1);

    await mount({ ...base, values: { first_name: "Ma" } });
    await settle(VALUES_DEBOUNCE_MS - 10);
    await mount({ ...base, values: { first_name: "May" } });
    await settle(VALUES_DEBOUNCE_MS - 10);
    expect(render).toHaveBeenCalledTimes(1);

    await settle(20);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1]![0].values).toEqual({ first_name: "May" });
  });

  it("does not wait when the channel changes", async () => {
    await mount(base);
    await settle();
    await mount({ ...base, channel: "email" as Channel });
    await settle();
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1]![0].channel).toBe("email");
  });

  it("aborts the render a newer one replaces, and shows only the newer", async () => {
    const signals: AbortSignal[] = [];
    render.mockImplementation(({ signal, values }) => {
      signals.push(signal!);
      return new Promise((resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        setTimeout(() => resolve(web(`<p>${String(values.first_name)}</p>`)), 100);
      });
    });
    await mount(base);
    await settle(10);
    await mount({ ...base, saveTick: 1, values: { first_name: "Newer" } });
    await settle(200);

    expect(signals.some((signal) => signal.aborted)).toBe(true);
    expect(signals.at(-1)!.aborted).toBe(false);
    expect(api.slots.web?.output).toEqual(web("<p>Newer</p>"));
    expect(api.rendering).toBe(false);
  });

  it("keeps the last good output on screen while the next renders, and under an error", async () => {
    await mount(base);
    await settle();

    let finish: (r: RenderPreviewResult) => void = () => {};
    render.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await mount({ ...base, saveTick: 1 });
    await settle();
    expect(api.rendering).toBe(true);
    expect(api.slots.web?.output).toEqual(web("<p>one</p>"));

    await act(async () => finish(err("invalid_values", "purchase_apr must be a percentage, like 21.99.")));
    await settle();
    expect(api.slots.web?.error?.message).toBe("purchase_apr must be a percentage, like 21.99.");
    expect(api.slots.web?.output).toEqual(web("<p>one</p>"));

    render.mockResolvedValue(web("<p>three</p>"));
    await mount({ ...base, saveTick: 2 });
    await settle();
    expect(api.slots.web).toEqual({ output: web("<p>three</p>"), error: null });
  });

  it("keeps the same output object when a render comes back identical", async () => {
    await mount(base);
    await settle();
    const first = api.slots.web?.output;
    render.mockResolvedValue(web("<p>one</p>"));
    await mount({ ...base, saveTick: 1 });
    await settle();
    expect(api.slots.web?.output).toBe(first);
  });

  it("keeps each channel's output apart", async () => {
    await mount(base);
    await settle();
    render.mockResolvedValue({ kind: "email", subject: "S", preheader: "P", html: "<p>mail</p>", text: "mail" });
    await mount({ ...base, channel: "email" });
    await settle();
    expect(api.slots.web?.output).toEqual(web("<p>one</p>"));
    expect(api.slots.email?.output).toMatchObject({ kind: "email", subject: "S" });
  });

  it("flushes again each time it is turned back on", async () => {
    await mount(base);
    await settle();
    await mount({ ...base, enabled: false });
    await settle();
    await mount(base);
    await settle();
    expect(flush).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledTimes(2);
  });

  describe("never sends a render the route will refuse", () => {
    const missing = { first_name: "" };

    it("names missing required variables as the route words them, and sends nothing", async () => {
      await mount({ ...base, values: missing });
      await settle(1000);

      expect(render).not.toHaveBeenCalled();
      expect(flush).not.toHaveBeenCalled();
      expect(api.slots.web?.error).toEqual({
        code: "missing_variables",
        message: "Missing required variables: first_name.",
        details: { missing: ["first_name"], invalid: [] },
      });
      expect(api.rendering).toBe(false);
    });

    it("gives the exact error the route's own validation gives", async () => {
      const values = { first_name: "", purchase_apr: "twelve" };
      const expected = validateValues(VARIABLES, values);
      expect(expected.ok).toBe(false);

      await mount({ ...base, values });
      await settle();

      expect(render).not.toHaveBeenCalled();
      expect(api.slots.web?.error).toEqual(expected.ok ? null : expected.error);
      expect(api.slots.web?.error?.message).toBe(
        "Missing required variables: first_name. purchase_apr must be a percentage, like 21.99.",
      );
    });

    it("names a value of the wrong type", async () => {
      await mount({ ...base, values: { first_name: "Maya", purchase_apr: "twelve" } });
      await settle();

      expect(render).not.toHaveBeenCalled();
      expect(api.slots.web?.error).toMatchObject({
        code: "invalid_values",
        message: "purchase_apr must be a percentage, like 21.99.",
      });
    });

    it("lets an empty optional value through", async () => {
      await mount({ ...base, values: { first_name: "Maya", purchase_apr: "" } });
      await settle();
      expect(render).toHaveBeenCalledTimes(1);
      expect(api.slots.web?.error).toBeNull();
    });

    it("keeps the last good output under the message, and renders again once the values are whole", async () => {
      await mount(base);
      await settle();
      expect(api.slots.web?.output).toEqual(web("<p>one</p>"));

      await mount({ ...base, values: missing });
      await settle(VALUES_DEBOUNCE_MS);
      expect(render).toHaveBeenCalledTimes(1);
      expect(api.slots.web?.error?.code).toBe("missing_variables");
      expect(api.slots.web?.output).toEqual(web("<p>one</p>"));
      expect(api.rendering).toBe(false);

      render.mockResolvedValue(web("<p>two</p>"));
      await mount({ ...base, values: { first_name: "Priya" } });
      await settle(VALUES_DEBOUNCE_MS);
      expect(render).toHaveBeenCalledTimes(2);
      expect(api.slots.web).toEqual({ output: web("<p>two</p>"), error: null });
    });

    it("drops a request that is in flight when the values become invalid", async () => {
      let signal: AbortSignal | undefined;
      render.mockImplementation((request) => {
        signal = request.signal;
        return new Promise(() => {});
      });
      await mount(base);
      await settle();
      expect(api.rendering).toBe(true);

      await mount({ ...base, values: missing });
      await settle(VALUES_DEBOUNCE_MS);
      expect(signal?.aborted).toBe(true);
      expect(api.rendering).toBe(false);
      expect(api.slots.web?.error?.code).toBe("missing_variables");
    });

    it("checks a variable added in the panel before it is saved", async () => {
      const added = [...VARIABLES, variable("annual_fee", "currency", true)];
      await mount({ ...base, variables: added });
      await settle();
      expect(render).not.toHaveBeenCalled();
      expect(api.slots.web?.error?.message).toBe("Missing required variables: annual_fee.");
    });
  });

  describe("waits for the save before every request", () => {
    it("holds a channel's request until the save that turns the channel on has landed", async () => {
      await mount(base);
      await settle();
      expect(render).toHaveBeenCalledTimes(1);

      // Email was just toggled on: its save is pending, and the author opens the Email tab at once.
      const order: string[] = [];
      let landed: () => void = () => {};
      flush.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            landed = () => {
              order.push("saved");
              resolve();
            };
          }),
      );
      render.mockImplementation(async () => {
        order.push("render");
        return { kind: "email", subject: "S", preheader: "", html: "<p>m</p>", text: "m" };
      });

      await mount({ ...base, channel: "email" });
      await settle(1000);
      expect(render).toHaveBeenCalledTimes(1); // nothing asked for Email yet
      expect(api.rendering).toBe(true);

      await act(async () => landed());
      await settle();
      expect(order).toEqual(["saved", "render"]);
      expect(render).toHaveBeenCalledTimes(2);
      expect(render.mock.calls[1]![0].channel).toBe("email");
      expect(api.slots.email?.error).toBeNull();
      expect(api.slots.email?.output).toMatchObject({ kind: "email" });
    });

    it("flushes once per request, whatever caused it", async () => {
      await mount(base);
      await settle();
      await mount({ ...base, channel: "pdf" });
      await settle();
      await mount({ ...base, channel: "pdf", saveTick: 1 });
      await settle();
      expect(flush).toHaveBeenCalledTimes(3);
      expect(render).toHaveBeenCalledTimes(3);
    });

    it("does not send a request a newer one has already replaced while it waited", async () => {
      let landed: () => void = () => {};
      flush.mockImplementationOnce(() => new Promise<void>((resolve) => (landed = resolve)));
      await mount(base);
      await settle();
      await mount({ ...base, channel: "email" });
      await settle();
      await act(async () => landed());
      await settle();
      expect(render).toHaveBeenCalledTimes(1);
      expect(render.mock.calls[0]![0].channel).toBe("email");
    });

    it("shows a refusal the route still gives (a real 4xx) and does not retry it", async () => {
      render.mockResolvedValueOnce(err("channel_not_enabled", "Version 2 doesn't render to Email. Its channels are PDF and Web."));
      await mount({ ...base, channel: "email" });
      await settle(1000);

      expect(render).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(api.slots.email?.error?.code).toBe("channel_not_enabled");
      expect(api.rendering).toBe(false);
    });

    it("shows a 5xx from the route as it comes", async () => {
      render.mockResolvedValueOnce(err("render_failed", "The email couldn't be rendered. Try again."));
      await mount({ ...base, channel: "email" });
      await settle();
      expect(api.slots.email?.error).toEqual({ code: "render_failed", message: "The email couldn't be rendered. Try again." });
    });
  });

  it("renders again on retry", async () => {
    render.mockResolvedValueOnce(err("render_failed", "The PDF couldn't be rendered. Try again."));
    await mount(base);
    await settle();
    expect(api.slots.web?.error?.code).toBe("render_failed");

    await act(async () => api.retry());
    await settle();
    expect(render).toHaveBeenCalledTimes(2);
    expect(api.slots.web?.error).toBeNull();
  });
});

describe("sameOutput", () => {
  it("compares text for Web and Email, and bytes for PDF", () => {
    expect(sameOutput(web("a"), web("a"))).toBe(true);
    expect(sameOutput(web("a"), web("b"))).toBe(false);
    const pdf = (bytes: number[], filename = "f.pdf"): PreviewOutput => ({ kind: "pdf", bytes: new Uint8Array(bytes), filename });
    expect(sameOutput(pdf([1, 2]), pdf([1, 2]))).toBe(true);
    expect(sameOutput(pdf([1, 2]), pdf([1, 3]))).toBe(false);
    expect(sameOutput(pdf([1, 2]), pdf([1, 2, 3]))).toBe(false);
    expect(sameOutput(pdf([1]), pdf([1], "g.pdf"))).toBe(false);
    const email = (subject: string): PreviewOutput => ({ kind: "email", subject, preheader: "", html: "h", text: "t" });
    expect(sameOutput(email("a"), email("a"))).toBe(true);
    expect(sameOutput(email("a"), email("b"))).toBe(false);
    expect(sameOutput(web("a"), email("a"))).toBe(false);
  });
});
