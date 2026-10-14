import { describe, expect, it } from "vitest";
import { REASONS } from "../permissions";
import { REQUEST_REFUSALS } from "../refusals";
import type { Viewer } from "../types";
import { CONFIRMED, NOW, PENDING, TOMORROW } from "./fixtures";
import { REFUSALS } from "./refusals";
import { versionActions, workspaceActions } from "./version-actions";

// What a viewer may do on a released version: the Versions tab's four controls, decided once for the local
// implementation, the fake and (ported) the Java API.

const TEAM = "t_coral";
const member = (
  userId: string,
  roles: Viewer["memberships"][number]["roles"],
): Viewer => ({
  userId,
  name: userId,
  initials: userId.slice(0, 2).toUpperCase(),
  title: "",
  platformRole: null,
  memberships: [
    {
      teamId: TEAM,
      // Never the id (decision 0053): a rule handed the slug finds nothing.
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      roles,
      status: "active",
    },
  ],
});
const jordan = member("jordan", ["approver"]);
const alex = member("alex", ["approver"]);
const maya = member("maya", ["author"]);

const superseded = {
  state: "superseded" as const,
  sunsetAt: null,
  revoke: null,
};
const active = { state: "active" as const, sunsetAt: null, revoke: null };

describe("versionActions", () => {
  it("lets an approver set a Superseded version's sunset and start a revoke; nothing is pending", () => {
    expect(versionActions(jordan, TEAM, superseded, NOW)).toEqual({
      setSunset: { ok: true },
      startRevoke: { ok: true },
      confirmRevoke: { ok: false, ...REFUSALS.noRevokePending },
      cancelRevoke: { ok: false, ...REFUSALS.noRevokePending },
    });
  });

  it("refuses an author the permission first, and an Active version its sunset", () => {
    expect(versionActions(maya, TEAM, superseded, NOW).setSunset).toEqual({
      ok: false,
      ...REASONS.generic,
    });
    expect(versionActions(jordan, TEAM, active, NOW).setSunset).toEqual({
      ok: false,
      ...REFUSALS.sunsetNotSuperseded,
    });
  });

  it("refuses a passed sunset to everyone, before the permission", () => {
    const passed = { ...superseded, sunsetAt: TOMORROW };
    expect(versionActions(jordan, TEAM, passed, NOW).setSunset).toEqual({
      ok: true,
    });
    for (const viewer of [jordan, maya])
      expect(versionActions(viewer, TEAM, passed, TOMORROW).setSunset).toEqual({
        ok: false,
        ...REFUSALS.sunsetPassed,
      });
  });

  it("with a revoke pending, the starter may cancel but not confirm; another approver may do both", () => {
    const pending = { ...active, revoke: PENDING };
    expect(versionActions(jordan, TEAM, pending, NOW)).toEqual({
      setSunset: { ok: false, ...REFUSALS.sunsetNotSuperseded },
      startRevoke: { ok: false, ...REFUSALS.revokePending },
      confirmRevoke: { ok: false, ...REASONS.ownRevoke },
      cancelRevoke: { ok: true },
    });
    const other = versionActions(alex, TEAM, pending, NOW);
    expect(other.confirmRevoke).toEqual({ ok: true });
    expect(other.cancelRevoke).toEqual({ ok: true });
  });

  it("a Revoked version can't be revoked again", () => {
    const revoked = {
      state: "revoked" as const,
      sunsetAt: null,
      revoke: CONFIRMED,
    };
    expect(versionActions(jordan, TEAM, revoked, NOW)).toMatchObject({
      startRevoke: { ok: false, ...REFUSALS.alreadyRevoked },
      confirmRevoke: { ok: false, ...REFUSALS.alreadyRevoked },
      cancelRevoke: { ok: false, ...REFUSALS.alreadyRevoked },
    });
  });
});

describe("workspaceActions", () => {
  const sam = member("sam", ["viewer"]);
  const row = (
    id: string,
    number: number | null,
    state: "draft" | "in_review" | "active" | "superseded",
  ) => ({ id, number, round: number === null ? null : 1, state });

  it("on a live template, offers Edit to an author, and nothing to someone without the edit permission", () => {
    const live = [row("v1", 1, "superseded"), row("v2", 2, "active")];
    expect(workspaceActions(maya, TEAM, live)).toEqual({
      edit: { ok: true },
      startDraft: { ok: true },
      submit: { ok: false, ...REQUEST_REFUSALS.noDraftToSubmit },
    });
    expect(workspaceActions(sam, TEAM, live)).toEqual({
      edit: { ok: false, ...REASONS.generic },
      startDraft: { ok: false, ...REASONS.generic },
      submit: { ok: false, ...REQUEST_REFUSALS.noDraftToSubmit },
    });
  });

  it("with a draft open, its author may submit it; with a newer version in review, Edit says why not", () => {
    const drafting = [row("v1", 1, "active"), row("d", null, "draft")];
    expect(workspaceActions(maya, TEAM, drafting).submit).toEqual({ ok: true });
    expect(
      workspaceActions(jordan, TEAM, drafting).submit,
      "an approver doesn't submit",
    ).toMatchObject({ ok: false });
    expect(
      workspaceActions(maya, TEAM, [
        row("v1", 1, "active"),
        row("v2", 2, "in_review"),
      ]).startDraft,
    ).toEqual({ ok: false, ...REFUSALS.newerInReview });
  });
});
