import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftPatch, DraftSaveError, DraftSaveResponse, JSONContent } from "@/domain/types";
import {
  OFFLINE,
  RETRYING,
  createAutosave,
  failureMessage,
  mergeFields,
  type AutosaveOptions,
  type SendOptions,
} from "./autosave-scheduler";

const doc = (text: string): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const saved = (rev: number): DraftSaveResponse => ({ ok: true, rev, savedAt: "2026-10-04T10:00:00.000Z" });
const refused = (error: DraftSaveError, message = "msg", rev?: number): DraftSaveResponse =>
  rev === undefined ? { ok: false, error, message } : { ok: false, error, rev, message };

interface Call {
  patch: DraftPatch;
  options: SendOptions;
  /** Fake-clock time (ms since the test began) at which the request was sent. */
  at: number;
  resolve: (response: DraftSaveResponse) => void;
  reject: (reason?: unknown) => void;
}

const SESSION = "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21";

function setup(options: Partial<AutosaveOptions> = {}) {
  const calls: Call[] = [];
  const start = Date.now();
  const autosave = createAutosave({
    initialRev: 3,
    sessionKey: SESSION,
    send: (patch, sendOptions) =>
      new Promise<DraftSaveResponse>((resolve, reject) => {
        calls.push({ patch, options: sendOptions, at: Date.now() - start, resolve, reject });
      }),
    ...options,
  });
  const statuses = [autosave.getState().status];
  autosave.subscribe(() => statuses.push(autosave.getState().status));

  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  // Requests are answered in the order they were sent.
  let cursor = 0;
  const answer = async (response: DraftSaveResponse) => {
    calls[cursor++]!.resolve(response);
    await tick(0);
  };
  const fail = async () => {
    calls[cursor++]!.reject(new TypeError("Failed to fetch"));
    await tick(0);
  };
  return { autosave, calls, statuses, tick, answer, fail };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("mergeFields", () => {
  it("lets later values win per field and keeps the rest", () => {
    expect(mergeFields({ body: doc("a"), name: "A" }, { body: doc("b") })).toEqual({ body: doc("b"), name: "A" });
  });

  it("ignores undefined but takes null", () => {
    expect(mergeFields({ name: "A", "email.subject": doc("s") }, { name: undefined, "email.subject": null })).toEqual({
      name: "A",
      "email.subject": null,
    });
  });

  it("does not change its inputs", () => {
    const base = { name: "A" };
    mergeFields(base, { name: "B" });
    expect(base).toEqual({ name: "A" });
  });
});

describe("failureMessage", () => {
  it("says the same thing for each refusal, in a few words", () => {
    expect(failureMessage("conflict", "x")).toBe("Your latest changes can't be saved — this draft changed elsewhere.");
    expect(failureMessage("invalid", "The name must be 1 to 120 characters.")).toBe("Not saved. The name must be 1 to 120 characters.");
  });

  it("says plainly that what wasn't saved never will be, when saving stops, with no instruction (Reload is a control)", () => {
    for (const error of ["conflict", "forbidden", "not_draft", "not_found"] as const) {
      expect(failureMessage(error, "x")).toMatch(/^Your latest changes can't be saved — /);
      expect(failureMessage(error, "x")).not.toMatch(/reload/i);
    }
  });
});

describe("a plain save", () => {
  it("starts out saved and sends nothing", async () => {
    const { autosave, calls, tick } = setup();
    expect(autosave.getState()).toEqual({ status: "saved" });
    await tick(60_000);
    expect(calls).toHaveLength(0);
  });

  it("waits 800 ms after the change, then sends the fields with the rev and the session key", async () => {
    const { autosave, calls, tick } = setup();
    autosave.save({ body: doc("hello") });
    expect(autosave.getState().status).toBe("unsaved");

    await tick(799);
    expect(calls).toHaveLength(0);
    await tick(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.patch).toEqual({ body: doc("hello"), rev: 3, sessionKey: SESSION });
    expect(calls[0]!.options).toEqual({ keepalive: false });
  });

  it("goes unsaved, saving, saved", async () => {
    const { autosave, statuses, tick, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await answer(saved(4));
    expect(statuses).toEqual(["saved", "unsaved", "saving", "saved"]);
    expect(autosave.getState()).toEqual({ status: "saved" });
  });

  it("uses the rev the server returned for the next save", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await answer(saved(9)); // the server may have moved on by more than one
    autosave.save({ name: "B" });
    await tick(800);
    expect(calls[1]!.patch.rev).toBe(9);
    expect(calls[1]!.patch.sessionKey).toBe(SESSION);
  });

  it("ignores a save with no fields", async () => {
    const { autosave, calls, tick } = setup();
    autosave.save({});
    autosave.save({ body: undefined });
    await tick(10_000);
    expect(calls).toHaveLength(0);
    expect(autosave.getState().status).toBe("saved");
  });

  it("keeps the same state object until something changes", async () => {
    const { autosave, tick } = setup();
    const first = autosave.getState();
    autosave.save({ name: "A" });
    const second = autosave.getState();
    autosave.save({ name: "B" });
    expect(autosave.getState()).toBe(second);
    expect(second).not.toBe(first);
    await tick(0);
  });

  it("stops telling a listener once it unsubscribes", async () => {
    const { autosave, tick } = setup();
    const seen: string[] = [];
    const off = autosave.subscribe(() => seen.push(autosave.getState().status));
    autosave.save({ name: "A" });
    off();
    autosave.save({ name: "B" });
    await tick(800);
    expect(seen).toEqual(["unsaved"]);
  });
});

describe("debounce and max wait", () => {
  it("restarts the wait on every change and sends once, with the fields merged", async () => {
    const { autosave, calls, tick } = setup();
    autosave.save({ body: doc("one"), name: "Keep" });
    await tick(500);
    autosave.save({ body: doc("two") });
    await tick(500);
    autosave.save({ body: doc("three"), variables: [] });
    await tick(799);
    expect(calls).toHaveLength(0);
    await tick(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.at).toBe(1800);
    expect(calls[0]!.patch).toEqual({ body: doc("three"), name: "Keep", variables: [], rev: 3, sessionKey: SESSION });
  });

  it("sends at 5 s at the latest while the author keeps typing", async () => {
    const { autosave, calls, tick } = setup();
    for (let i = 0; i < 12; i++) {
      autosave.save({ body: doc(`keystroke ${i}`) });
      await tick(500);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.at).toBe(5000);
    // The request carries what was typed up to that moment.
    expect(calls[0]!.patch.body).toEqual(doc("keystroke 9"));
  });

  it("counts the max wait from the first unsaved change, not from the last request", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await answer(saved(4));
    await tick(10_000); // a long quiet spell must not make the next change send early or late
    autosave.save({ name: "B" });
    await tick(799);
    expect(calls).toHaveLength(1);
    await tick(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at).toBe(800 + 10_000 + 800);
  });
});

describe("one request at a time", () => {
  it("holds changes made during a request and sends them in the next one", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ body: doc("first") });
    await tick(800);
    expect(calls).toHaveLength(1);

    autosave.save({ body: doc("second"), name: "N" });
    await tick(5000);
    expect(calls).toHaveLength(1); // still waiting for the answer
    expect(autosave.getState().status).toBe("saving");

    await answer(saved(4));
    // The change is already older than the debounce, so it goes straight out.
    await tick(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.patch).toEqual({ body: doc("second"), name: "N", rev: 4, sessionKey: SESSION });
    expect(autosave.getState().status).toBe("saving");

    await answer(saved(5));
    expect(autosave.getState().status).toBe("saved");
  });

  it("still debounces a change made just before the answer arrives", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await tick(1000);
    autosave.save({ name: "B" });
    await tick(100);
    await answer(saved(4));
    expect(calls).toHaveLength(1);
    await tick(699);
    expect(calls).toHaveLength(1);
    await tick(1);
    expect(calls).toHaveLength(2);
  });

  it("never has two requests out, however many changes arrive", async () => {
    let out = 0;
    let peak = 0;
    const { autosave, tick } = setup({
      send: (patch) =>
        new Promise<DraftSaveResponse>((resolve) => {
          out += 1;
          peak = Math.max(peak, out);
          setTimeout(() => {
            out -= 1;
            resolve(saved(patch.rev + 1));
          }, 1500);
        }),
    });
    for (let i = 0; i < 40; i++) {
      autosave.save({ body: doc(`n${i}`) });
      await tick(400);
    }
    await tick(20_000);
    expect(peak).toBe(1);
    expect(autosave.getState().status).toBe("saved");
  });
});

describe("network failures", () => {
  it("keeps the fields, says it is retrying, and retries after 1 s, 2 s and 5 s", async () => {
    const { autosave, calls, tick, fail } = setup();
    autosave.save({ body: doc("keep me") });
    await tick(800);
    await fail();
    expect(autosave.getState()).toEqual({ status: "error", error: RETRYING });

    await tick(999);
    expect(calls).toHaveLength(1);
    await tick(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.patch).toEqual({ body: doc("keep me"), rev: 3, sessionKey: SESSION });
    // The error stays on screen during the retry rather than flickering to "Saving…".
    expect(autosave.getState()).toEqual({ status: "error", error: RETRYING });

    await fail();
    await tick(2000);
    expect(calls).toHaveLength(3);
    await fail();
    await tick(5000);
    expect(calls).toHaveLength(4);
    await fail();

    expect(autosave.getState()).toEqual({ status: "error", error: OFFLINE });
    await tick(120_000);
    expect(calls).toHaveLength(4); // no retry loop
  });

  it("is saved again once a retry gets through", async () => {
    const { autosave, calls, tick, fail, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await fail();
    await tick(1000);
    await answer(saved(4));
    expect(autosave.getState()).toEqual({ status: "saved" });
    expect(calls).toHaveLength(2);
    await tick(60_000);
    expect(calls).toHaveLength(2);
  });

  it("puts newer changes over the failed ones when it retries", async () => {
    const { autosave, calls, tick, fail } = setup();
    autosave.save({ body: doc("old"), name: "Name" });
    await tick(800);
    autosave.save({ body: doc("new"), variables: [] }); // typed while the request was out
    await fail();
    await tick(1000);
    expect(calls[1]!.patch).toEqual({ body: doc("new"), name: "Name", variables: [], rev: 3, sessionKey: SESSION });
  });

  it("carries changes made while waiting to retry into the retry", async () => {
    const { autosave, calls, tick, fail } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await fail();
    await tick(300);
    autosave.save({ body: doc("typed during backoff") });
    expect(autosave.getState()).toEqual({ status: "error", error: RETRYING });
    await tick(700);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.patch).toMatchObject({ name: "A", body: doc("typed during backoff") });
  });

  it("starts a fresh round of retries when the author types after giving up", async () => {
    const { autosave, calls, tick, fail, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await fail();
    for (const wait of [1000, 2000, 5000]) {
      await tick(wait);
      await fail();
    }
    expect(autosave.getState().error).toBe(OFFLINE);

    autosave.save({ body: doc("back online") });
    expect(autosave.getState().status).toBe("unsaved");
    await tick(800);
    expect(calls).toHaveLength(5);
    expect(calls[4]!.patch).toMatchObject({ name: "A", body: doc("back online") });
    await fail();
    expect(autosave.getState().error).toBe(RETRYING); // the budget is full again
    await tick(1000);
    await answer(saved(4));
    expect(autosave.getState().status).toBe("saved");
  });

  it("treats a send that throws straight away like any other failure", async () => {
    const send = vi
      .fn<AutosaveOptions["send"]>()
      .mockImplementationOnce(() => {
        throw new Error("sync");
      })
      .mockResolvedValue(saved(4));
    const { autosave, tick } = setup({ send });
    autosave.save({ name: "A" });
    await tick(800);
    expect(autosave.getState()).toEqual({ status: "error", error: RETRYING });
    await tick(1000);
    expect(autosave.getState()).toEqual({ status: "saved" });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("editing sessions", () => {
  const MIN = 60_000;
  let made: number;
  const rotating = (extra: Partial<AutosaveOptions> = {}) => {
    made = 0;
    return setup({ newSessionKey: () => `rotated-${++made}`, ...extra });
  };

  /** Saves one change at the current time and answers it. */
  async function saveAndAnswer(h: ReturnType<typeof setup>, name: string, rev: number) {
    h.autosave.save({ name });
    await h.tick(800);
    await h.answer(saved(rev));
  }

  it("keeps the first key for the first save, and for later saves inside 30 minutes", async () => {
    const h = rotating();
    await saveAndAnswer(h, "A", 4);
    await h.tick(10 * MIN);
    await saveAndAnswer(h, "B", 5);
    expect(h.calls.map((c) => c.patch.sessionKey)).toEqual([SESSION, SESSION]);
    expect(made).toBe(0);
  });

  it("starts a new session when the last save is more than 30 minutes old", async () => {
    const h = rotating();
    await saveAndAnswer(h, "A", 4);
    await h.tick(30 * MIN + 1);
    h.autosave.save({ name: "B" });
    await h.tick(800);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.patch.sessionKey).toBe("rotated-1");
    expect(h.calls[1]!.patch.rev).toBe(4); // same draft, same rev line: only the audit session changes

    await h.answer(saved(5));
    await saveAndAnswer(h, "C", 6);
    expect(h.calls[2]!.patch.sessionKey).toBe("rotated-1"); // inside the gap again: stays
    expect(made).toBe(1);
  });

  it("does not rotate at exactly 30 minutes", async () => {
    const h = rotating();
    await saveAndAnswer(h, "A", 4);
    // The save was acknowledged as it was sent. Idle for exactly the gap, then change and send at once.
    await h.tick(30 * MIN);
    h.autosave.save({ name: "B" });
    void h.autosave.flush();
    await h.tick(0);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.patch.sessionKey).toBe(SESSION);
  });

  it("measures the gap from the last saved change, not the first", async () => {
    const h = rotating();
    await saveAndAnswer(h, "A", 4); // t = 0.8 s
    await h.tick(20 * MIN);
    await saveAndAnswer(h, "B", 5); // t = 20 min
    await h.tick(25 * MIN);
    await saveAndAnswer(h, "C", 6); // 25 min after B, 45 min after A
    expect(h.calls.map((c) => c.patch.sessionKey)).toEqual([SESSION, SESSION, SESSION]);
    await h.tick(31 * MIN);
    await saveAndAnswer(h, "D", 7);
    expect(h.calls[3]!.patch.sessionKey).toBe("rotated-1");
  });

  it("keeps the new key through the retries of that save", async () => {
    const h = rotating();
    await saveAndAnswer(h, "A", 4);
    await h.tick(40 * MIN);
    h.autosave.save({ name: "B" });
    await h.tick(800);
    await h.fail();
    await h.tick(1000);
    await h.fail();
    await h.tick(2000);
    expect(h.calls.slice(1).map((c) => c.patch.sessionKey)).toEqual(["rotated-1", "rotated-1", "rotated-1"]);
    expect(made).toBe(1);
  });

  it("keeps the key after a request whose outcome is unknown, however long it has been", async () => {
    // That save may have landed. The server will accept a resend only under the same key.
    const h = rotating();
    await saveAndAnswer(h, "A", 4);
    await h.tick(40 * MIN);
    h.autosave.save({ name: "B" });
    await h.tick(800);
    for (const wait of [0, 1000, 2000, 5000]) {
      await h.tick(wait);
      await h.fail();
    }
    expect(h.autosave.getState().error).toBe(OFFLINE);
    await h.tick(60 * MIN);
    h.autosave.save({ name: "C" });
    await h.tick(800);
    expect(h.calls.at(-1)!.patch.sessionKey).toBe("rotated-1");
    expect(made).toBe(1);
    await h.answer(saved(5));
    // Once it has been answered, the clock starts again from that save.
    await h.tick(31 * MIN);
    await saveAndAnswer(h, "D", 6);
    expect(h.calls.at(-1)!.patch.sessionKey).toBe("rotated-2");
  });

  it("rotates on a flush too", async () => {
    const h = rotating();
    await saveAndAnswer(h, "A", 4);
    await h.tick(31 * MIN);
    h.autosave.save({ name: "B" });
    void h.autosave.flush({ keepalive: true });
    await h.tick(0);
    expect(h.calls[1]!.patch.sessionKey).toBe("rotated-1");
  });

  it("never rotates without a key maker", async () => {
    const h = setup();
    await saveAndAnswer(h, "A", 4);
    await h.tick(5 * 60 * MIN);
    await saveAndAnswer(h, "B", 5);
    expect(h.calls.map((c) => c.patch.sessionKey)).toEqual([SESSION, SESSION]);
  });

  it("takes the gap as an option", async () => {
    const h = rotating({ sessionGapMs: 5 * MIN });
    await saveAndAnswer(h, "A", 4);
    await h.tick(6 * MIN);
    await saveAndAnswer(h, "B", 5);
    expect(h.calls[1]!.patch.sessionKey).toBe("rotated-1");
  });
});

describe("a request that never comes back", () => {
  it("counts as a failure after 30 s, so saving can't stay blocked", async () => {
    const { autosave, calls, tick } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    expect(calls).toHaveLength(1);

    await tick(29_999);
    expect(autosave.getState().status).toBe("saving");
    await tick(1);
    expect(autosave.getState()).toEqual({ status: "error", error: RETRYING });

    await tick(1000);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.patch).toMatchObject({ name: "A", rev: 3 });
    await tick(0);
    // The first request is abandoned; answering the second one finishes the job.
    calls[1]!.resolve(saved(4));
    await tick(0);
    expect(autosave.getState()).toEqual({ status: "saved" });
  });

  it("ignores a late answer to the abandoned request", async () => {
    const { autosave, calls, tick } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await tick(30_000);
    calls[0]!.resolve(saved(99));
    await tick(0);
    expect(autosave.getState()).toEqual({ status: "error", error: RETRYING });
    await tick(1000);
    expect(calls[1]!.patch.rev).toBe(3);
  });

  it("does not leave a timer behind when the answer arrives in time", async () => {
    const { autosave, tick, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await answer(saved(4));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("answers that stop saving", () => {
  it.each([
    ["conflict", "Your latest changes can't be saved — this draft changed elsewhere."],
    ["forbidden", "Your latest changes can't be saved — you can no longer edit this draft."],
    ["not_draft", "Your latest changes can't be saved — this version is no longer a draft."],
    ["not_found", "Your latest changes can't be saved — this draft no longer exists."],
  ] as const)("%s: shows the message, says it has stopped, and never sends again", async (error, text) => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ body: doc("mine") });
    await tick(800);
    await answer(refused(error, "server words", 9));

    expect(autosave.getState()).toEqual({ status: "error", error: text, stopped: true });

    autosave.save({ body: doc("more typing") });
    await autosave.flush();
    await tick(120_000);
    expect(calls).toHaveLength(1);
    expect(autosave.getState()).toEqual({ status: "error", error: text, stopped: true });
  });

  it("tells listeners once when it stops, and keeps the same state object after", async () => {
    const { autosave, tick, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    const listener = vi.fn();
    autosave.subscribe(listener);
    await answer(refused("conflict"));
    expect(listener).toHaveBeenCalledTimes(1);
    const state = autosave.getState();

    autosave.save({ name: "B" });
    await autosave.flush();
    expect(autosave.getState()).toBe(state);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("isn't stopped before anything happens, by a network failure, or by a refusal the next change can fix", async () => {
    const { autosave, tick, answer, fail } = setup();
    expect(autosave.getState().stopped).toBeUndefined();
    autosave.save({ name: "A" });
    await tick(800);
    await fail();
    expect(autosave.getState()).toEqual({ status: "error", error: RETRYING });
    await tick(1_000);
    await answer(refused("invalid", "The name must be 1 to 120 characters."));
    expect(autosave.getState()).toEqual({ status: "error", error: "Not saved. The name must be 1 to 120 characters." });
  });

  it("does not adopt the rev from a conflict (that would overwrite the other edit)", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await answer(refused("conflict", "x", 12));
    autosave.save({ name: "B" });
    await tick(5000);
    expect(calls).toHaveLength(1);
  });

  it("invalid: shows the server's words, does not retry, and sends again on the next change", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ name: "x".repeat(200), body: doc("fine") });
    await tick(800);
    await answer(refused("invalid", "The name must be 1 to 120 characters."));
    expect(autosave.getState()).toEqual({ status: "error", error: "Not saved. The name must be 1 to 120 characters." });

    await tick(120_000);
    expect(calls).toHaveLength(1);

    autosave.save({ name: "Short again" });
    expect(autosave.getState().status).toBe("unsaved");
    await tick(800);
    expect(calls).toHaveLength(2);
    // The corrected name replaces the bad one; the body that was held back goes with it.
    expect(calls[1]!.patch).toEqual({ name: "Short again", body: doc("fine"), rev: 3, sessionKey: SESSION });
    await answer(saved(4));
    expect(autosave.getState()).toEqual({ status: "saved" });
  });
});

describe("flush", () => {
  it("sends at once, without waiting for the debounce, and resolves with the answer", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ name: "A" });
    let done = false;
    const flushed = autosave.flush().then(() => {
      done = true;
    });
    await tick(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.at).toBe(0);
    expect(done).toBe(false);

    await answer(saved(4));
    await flushed;
    expect(done).toBe(true);
    expect(autosave.getState().status).toBe("saved");

    await tick(10_000); // the debounce timer was cancelled: no second request
    expect(calls).toHaveLength(1);
  });

  it("asks for keepalive only when told to", async () => {
    const { autosave, calls, tick } = setup();
    autosave.save({ name: "A" });
    void autosave.flush({ keepalive: true });
    await tick(0);
    expect(calls[0]!.options).toEqual({ keepalive: true });
  });

  it("does nothing, at once, when there is nothing to save", async () => {
    const { autosave, calls } = setup();
    await autosave.flush();
    await autosave.flush({ keepalive: true });
    expect(calls).toHaveLength(0);
  });

  it("waits for a request already out, then sends what came after", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ body: doc("first") });
    await tick(800);
    autosave.save({ body: doc("second") });

    let done = false;
    const flushed = autosave.flush().then(() => {
      done = true;
    });
    await tick(0);
    expect(calls).toHaveLength(1);

    await answer(saved(4));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.patch).toMatchObject({ body: doc("second"), rev: 4 });
    expect(done).toBe(false);

    await answer(saved(5));
    await flushed;
    expect(done).toBe(true);
    expect(autosave.getState().status).toBe("saved");
  });

  it("does not send the same fields twice when called twice", async () => {
    const { autosave, calls, tick, answer } = setup();
    autosave.save({ name: "A" });
    const a = autosave.flush({ keepalive: true });
    const b = autosave.flush({ keepalive: true });
    await tick(0);
    expect(calls).toHaveLength(1);
    await answer(saved(4));
    await Promise.all([a, b]);
    expect(calls).toHaveLength(1);
  });

  it("cuts a retry wait short", async () => {
    const { autosave, calls, tick, fail, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await fail();
    expect(calls).toHaveLength(1);

    const flushed = autosave.flush();
    await tick(0);
    expect(calls).toHaveLength(2);
    await answer(saved(4));
    await flushed;
    expect(autosave.getState().status).toBe("saved");
  });

  it("tries once more after the retries ran out (the browser came back online)", async () => {
    const { autosave, calls, tick, fail, answer } = setup();
    autosave.save({ name: "A" });
    await tick(800);
    await fail();
    for (const wait of [1000, 2000, 5000]) {
      await tick(wait);
      await fail();
    }
    expect(autosave.getState().error).toBe(OFFLINE);

    const flushed = autosave.flush();
    await tick(0);
    expect(calls).toHaveLength(5);
    await answer(saved(4));
    await flushed;
    expect(autosave.getState()).toEqual({ status: "saved" });
  });

  it("resolves, not rejects, when the request fails", async () => {
    const { autosave, tick, fail } = setup();
    autosave.save({ name: "A" });
    const flushed = autosave.flush();
    await tick(0);
    await fail();
    await expect(flushed).resolves.toBeUndefined();
    expect(autosave.getState().status).toBe("error");
  });
});

describe("disabled (read-only)", () => {
  it("ignores changes and sends nothing", async () => {
    const { autosave, calls, tick } = setup();
    autosave.setDisabled(true);
    autosave.save({ body: doc("x") });
    await autosave.flush();
    await tick(60_000);
    expect(calls).toHaveLength(0);
    expect(autosave.getState().status).toBe("saved");
  });

  it("drops what was waiting when it becomes disabled", async () => {
    const { autosave, calls, tick } = setup();
    autosave.save({ body: doc("x") });
    autosave.setDisabled(true);
    await tick(60_000);
    expect(calls).toHaveLength(0);
    expect(autosave.getState().status).toBe("saved");
  });

  it("can start out disabled", async () => {
    const { autosave, calls, tick } = setup({ disabled: true });
    autosave.save({ body: doc("x") });
    await tick(60_000);
    expect(calls).toHaveLength(0);
    autosave.setDisabled(false);
    autosave.save({ body: doc("y") });
    await tick(800);
    expect(calls).toHaveLength(1);
  });

  it("saves again once re-enabled", async () => {
    const { autosave, calls, tick } = setup();
    autosave.setDisabled(true);
    autosave.setDisabled(false);
    autosave.save({ name: "A" });
    await tick(800);
    expect(calls).toHaveLength(1);
  });
});
