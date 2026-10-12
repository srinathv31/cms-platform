import { describe, expect, it } from "vitest";
import { cancelRevoke, confirmRevoke, startRevoke } from "./revoke";
import type { Recipients } from "../review-types";
import {
  NOW,
  TEMPLATE,
  REVOKE_REASON,
  PENDING,
  CONFIRMED,
  reviewVersion,
  tryStartRevoke,
} from "./fixtures";

const APPROVERS_BUT = (userId: string): Recipients => ({
  kind: "team_role",
  role: "approver",
  exceptUserIds: [userId],
});

describe("startRevoke", () => {
  const run = (over: Partial<Parameters<typeof startRevoke>[0]> = {}) =>
    startRevoke({
      version: reviewVersion({ state: "superseded", submittedBy: "priya" }),
      actorId: "jordan",
      actorName: "Jordan Ellis",
      reason: REVOKE_REASON,
      now: NOW,
      templateName: "Balance Transfer Intro",
      ...over,
    });

  it("starts a revoke that waits for a second approver", () => {
    expect(run()).toEqual({
      ok: true,
      changes: {
        revoke: {
          reason: REVOKE_REASON,
          startedBy: "jordan",
          startedAt: "2026-10-04T12:00:00.000Z",
        },
      },
      effects: [
        {
          kind: "audit",
          action: "version.revoke_started",
          details: { number: 1, reason: REVOKE_REASON },
        },
        {
          kind: "notification",
          notification: "revoke_started",
          to: APPROVERS_BUT("jordan"),
          title:
            "Jordan Ellis started revoking Balance Transfer Intro v1. Confirm or cancel.",
          body: REVOKE_REASON,
          link: { to: "versions", templateId: TEMPLATE.id },
        },
      ],
    });
  });

  it("works on the Active version too", () => {
    expect(run({ version: reviewVersion({ state: "active" }) }).ok).toBe(true);
  });

  it("refuses while another revoke is waiting for confirmation", () => {
    expect(
      run({
        version: reviewVersion({ state: "superseded", revoke: PENDING }),
        actorId: "alex",
      }),
    ).toEqual({
      ok: false,
      code: "revoke_pending",
      reason: "A revoke is already waiting for confirmation.",
    });
  });

  it.each(["", "  ", "\n"])("refuses an empty reason (%j)", (reason) => {
    expect(run({ reason })).toEqual({
      ok: false,
      code: "reason_missing",
      reason: "Give a reason.",
    });
  });

  it("trims the reason", () => {
    const result = run({ reason: `  ${REVOKE_REASON} ` });
    expect(result.ok && result.changes.revoke.reason).toBe(REVOKE_REASON);
  });
});

describe("confirmRevoke", () => {
  const superseded = reviewVersion({
    state: "superseded",
    submittedBy: "priya",
    revoke: PENDING,
  });
  const run = (over: Partial<Parameters<typeof confirmRevoke>[0]> = {}) =>
    confirmRevoke({
      version: superseded,
      actorId: "alex",
      actorName: "Alex Kim",
      now: NOW,
      activeNumber: 2,
      templateName: "Balance Transfer Intro",
      ...over,
    });
  const notice = (activeVersion: number | null) => ({
    kind: "consumer_notice",
    notice: "revoked",
    versionId: "v_1",
    payload: { versionNumber: 1, activeVersion, reason: REVOKE_REASON },
  });
  const revoked = (to: Recipients) => ({
    kind: "notification",
    notification: "version_revoked",
    to,
    title: "Alex Kim confirmed the revoke of Balance Transfer Intro v1.",
    body: REVOKE_REASON,
    link: { to: "versions", templateId: TEMPLATE.id },
  });

  it("revokes, filling in who confirmed it and when, and tells consumers and the team", () => {
    expect(run()).toEqual({
      ok: true,
      changes: {
        state: "revoked",
        revoke: {
          ...PENDING,
          confirmedBy: "alex",
          confirmedAt: "2026-10-04T12:00:00.000Z",
        },
      },
      effects: [
        {
          kind: "audit",
          action: "version.revoked",
          details: {
            number: 1,
            reason: REVOKE_REASON,
            startedBy: "jordan",
            wasActive: false,
          },
        },
        notice(2),
        revoked(APPROVERS_BUT("alex")),
        revoked({ kind: "user", userId: "priya" }),
      ],
    });
  });

  it("refuses the approver who started it: a different approver must confirm", () => {
    expect(run({ actorId: "jordan", actorName: "Jordan Ellis" })).toEqual({
      ok: false,
      code: "own_revoke",
      reason: "You started this revoke. Another approver must confirm it.",
    });
  });

  it("leaves no Active version when it revokes the Active one: nothing is reinstated", () => {
    const result = run({
      version: { ...superseded, state: "active" },
      activeNumber: 1,
    });
    expect(result.ok && Object.keys(result).sort()).toEqual([
      "changes",
      "effects",
      "ok",
    ]);
    expect(result.ok && result.changes.state).toBe("revoked");
    expect(result.ok && result.effects[0]).toMatchObject({
      details: { wasActive: true },
    });
    expect(result.ok && result.effects[1]).toEqual(notice(null));
  });

  it("refuses when nothing is waiting for confirmation", () => {
    expect(run({ version: { ...superseded, revoke: null } })).toEqual({
      ok: false,
      code: "no_revoke_pending",
      reason: "There's no revoke waiting for confirmation.",
    });
    expect(
      run({ version: { ...superseded, state: "revoked", revoke: CONFIRMED } }),
    ).toEqual({
      ok: false,
      code: "already_revoked",
      reason: "This version is already revoked.",
    });
  });

  it("notifies only the approvers when no author is on record", () => {
    const result = run({ version: { ...superseded, submittedBy: null } });
    expect(
      result.ok && result.effects.filter((e) => e.kind === "notification"),
    ).toEqual([revoked(APPROVERS_BUT("alex"))]);
  });
});

describe("cancelRevoke", () => {
  const pending = reviewVersion({ state: "superseded", revoke: PENDING });
  const cancelled = (ownRevoke: boolean) => ({
    ok: true,
    changes: { revoke: null },
    effects: [
      {
        kind: "audit",
        action: "version.revoke_cancelled",
        details: {
          number: 1,
          reason: REVOKE_REASON,
          startedBy: "jordan",
          ownRevoke,
        },
      },
    ],
  });

  // Any approver may cancel: the starter (a mistake) or another one (the "Confirm or cancel" they were
  // sent). Cancelling keeps the version rendering, so it needs no second person.
  it("lets the approver who started it cancel", () => {
    expect(
      cancelRevoke({ version: pending, actorId: "jordan", now: NOW }),
    ).toEqual(cancelled(true));
  });

  it("lets another approver cancel", () => {
    expect(
      cancelRevoke({ version: pending, actorId: "alex", now: NOW }),
    ).toEqual(cancelled(false));
  });

  it("refuses when nothing is waiting, or the revoke is already confirmed", () => {
    expect(
      cancelRevoke({
        version: { ...pending, revoke: null },
        actorId: "alex",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      code: "no_revoke_pending",
      reason: "There's no revoke waiting for confirmation.",
    });
    expect(
      cancelRevoke({
        version: { ...pending, state: "revoked", revoke: CONFIRMED },
        actorId: "alex",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      code: "already_revoked",
      reason: "This version is already revoked.",
    });
  });

  it("allows a new revoke afterwards", () => {
    const result = cancelRevoke({
      version: pending,
      actorId: "alex",
      now: NOW,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(tryStartRevoke({ ...pending, ...result.changes }).ok).toBe(true);
  });
});
