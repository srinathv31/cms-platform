import { describe, expect, it } from "vitest";
import { inactivity, inactivityAnchor } from "./inactivity";
import type { MembershipFacts } from "../access-types";
import { at, ago, membership } from "./fixtures";

describe("inactivity", () => {
  const m = (lastActiveAt: Date | null, extra: Partial<MembershipFacts> = {}) =>
    membership("devon", ["viewer"], { lastActiveAt, ...extra });

  it("runs from the latest of last sign-in, date added, and the last Keep", () => {
    expect(inactivityAnchor(m(ago(95))).getTime()).toBe(ago(95).getTime());
    expect(inactivityAnchor(m(null, { addedAt: ago(10) })).getTime()).toBe(ago(10).getTime());
    expect(inactivityAnchor(m(ago(95), { addedAt: ago(20) })).getTime()).toBe(ago(20).getTime());
    expect(inactivityAnchor(m(ago(95), { inactivityKeptAt: ago(3) })).getTime()).toBe(ago(3).getTime());
  });

  it("is ok one millisecond before 90 days", () => {
    const state = inactivity(m(ago(0)), at(90, -1));
    expect(state.state).toBe("ok");
    expect(state.daysInactive).toBe(89);
  });

  it("is flagged exactly at 90 days", () => {
    const state = inactivity(m(ago(0)), at(90));
    expect(state.state).toBe("flagged");
    expect(state.daysInactive).toBe(90);
    expect(state.flagAt.getTime()).toBe(at(90).getTime());
    expect(state.suspendAt.getTime()).toBe(at(120).getTime());
  });

  it("stays flagged until one millisecond before 120 days, then is due for suspension", () => {
    expect(inactivity(m(ago(0)), at(120, -1)).state).toBe("flagged");
    expect(inactivity(m(ago(0)), at(120)).state).toBe("suspend_due");
    expect(inactivity(m(ago(0)), at(120, 1)).state).toBe("suspend_due");
  });

  it("someone who never signed in counts from the day they were added", () => {
    expect(inactivity(m(null, { addedAt: ago(0) }), at(89)).state).toBe("ok");
    expect(inactivity(m(null, { addedAt: ago(0) }), at(90)).state).toBe("flagged");
  });

  it("a Keep restarts the clock", () => {
    const kept = m(ago(100), { inactivityKeptAt: ago(0) });
    expect(inactivity(kept, at(0)).state).toBe("ok");
    expect(inactivity(kept, at(90)).state).toBe("flagged");
    expect(inactivity(kept, at(120)).state).toBe("suspend_due");
  });
});
