// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle";
import type { ActionResult } from "@/domain/review-types";

// The one way the browser runs a server action (handoff review H1): in a transition, one at a time, with
// the refusal's sentence to show, a screen's own sentence when the call throws, and Next's redirect
// handed back to Next.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Next's redirect, as `unstable_rethrow` recognises it. */
class NextRedirect extends Error {
  constructor() {
    super("NEXT_REDIRECT");
  }
}
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof NextRedirect) throw error;
  },
}));

const { GENERIC_FAILURE, runAction, useActionRun } = await import("./use-action-run");

const SCREEN_FAILURE = "Couldn't open a draft. Try again.";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Api = ReturnType<typeof useActionRun>;
/** The hook as the harness last rendered it. */
const hook: { current: Api | null } = { current: null };
let root: Root;
let container: HTMLElement;

function Harness({ failure }: { failure?: string }) {
  const run = useActionRun(failure);
  useEffect(() => {
    hook.current = run;
  });
  return (
    <p data-pending={run.pending ? "" : undefined} role={run.error ? "alert" : undefined}>
      {run.error}
    </p>
  );
}

const api = () => hook.current!;

const shown = () => container.querySelector("p")!;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness failure={SCREEN_FAILURE} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("runAction", () => {
  it("answers the action's result, accepted or refused", async () => {
    expect(await runAction(async () => ({ ok: true, number: 3 }))).toEqual({ ok: true, number: 3 });
    expect(await runAction(async () => ({ ok: false, ...REFUSALS.newerInReview }))).toEqual({ ok: false, ...REFUSALS.newerInReview });
  });

  it("turns a call that throws into the code `failed` with the screen's sentence, or the generic one", async () => {
    const offline = async (): Promise<ActionResult> => {
      throw new TypeError("Failed to fetch");
    };
    expect(await runAction(offline, SCREEN_FAILURE)).toEqual({ ok: false, code: "failed", reason: SCREEN_FAILURE });
    expect(await runAction(offline)).toEqual({ ok: false, code: "failed", reason: GENERIC_FAILURE });
  });

  it("hands Next's redirect back instead of swallowing it", async () => {
    const redirect = new NextRedirect();
    await expect(
      runAction(async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
  });
});

describe("useActionRun", () => {
  it("is pending while the action runs, then calls onOk with the result", async () => {
    const answer = deferred<ActionResult<{ number: number }>>();
    const onOk = vi.fn();
    await act(async () => {
      api().run(() => answer.promise, { onOk });
    });
    expect(shown().hasAttribute("data-pending")).toBe(true);
    await act(async () => answer.resolve({ ok: true, number: 4 }));
    expect(shown().hasAttribute("data-pending")).toBe(false);
    expect(onOk).toHaveBeenCalledWith({ ok: true, number: 4 });
    expect(api().error).toBeNull();
  });

  it("shows a refusal's sentence and calls onRefused with its code", async () => {
    const onRefused = vi.fn();
    const onOk = vi.fn();
    await act(async () => {
      api().run(async () => ({ ok: false, ...REFUSALS.newerInReview }), { onOk, onRefused });
    });
    expect(shown().getAttribute("role")).toBe("alert");
    expect(shown().textContent).toBe("A newer version is in review.");
    expect(onRefused).toHaveBeenCalledWith({ ok: false, ...REFUSALS.newerInReview });
    expect(onOk).not.toHaveBeenCalled();
  });

  it("shows the screen's own sentence when the call throws", async () => {
    const onRefused = vi.fn();
    await act(async () => {
      api().run(
        async () => {
          throw new TypeError("Failed to fetch");
        },
        { onRefused },
      );
    });
    expect(shown().textContent).toBe(SCREEN_FAILURE);
    expect(onRefused).toHaveBeenCalledWith({ ok: false, code: "failed", reason: SCREEN_FAILURE });
  });

  it("runs one action at a time: a second press while one is out is ignored", async () => {
    const answer = deferred<ActionResult>();
    const action = vi.fn(() => answer.promise);
    let started: boolean[] = [];
    await act(async () => {
      started = [api().run(action), api().run(action)];
    });
    expect(started).toEqual([true, false]);
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve({ ok: true }));
    // Once it has answered, the next press goes.
    await act(async () => {
      started = [api().run(action)];
    });
    expect(started).toEqual([true]);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("clears the last refusal when the next run starts", async () => {
    await act(async () => {
      api().run(async () => ({ ok: false, ...REFUSALS.newerInReview }));
    });
    expect(shown().textContent).toBe("A newer version is in review.");
    const answer = deferred<ActionResult>();
    await act(async () => {
      api().run(() => answer.promise);
    });
    expect(shown().textContent).toBe("");
    await act(async () => answer.resolve({ ok: true }));
  });
});
