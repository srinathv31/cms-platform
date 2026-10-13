import { describe, expect, it, vi } from "vitest";
import { ACCESS_REFUSALS } from "@/domain/access/refusals";
import { runAccessSweep } from "@/server/access-sweep";
import { localContractHarness } from "../local/contract-harness";
import { settingsContract } from "./settings";

// The settings reads' contract (./settings.ts) against the local implementation, on a seeded database per test.
// The fake doesn't implement these reads (decision 0072: a read in the fake only where a case must observe a
// command), so there is no fake run; add one when a command's case needs to observe a change through them.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-settings-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

describe("local", () => {
  const h = localContractHarness({ base: BASE });
  settingsContract(h, BASE);

  // Local only: the access sweep is the backend's scheduled job, and the local harness's `runScheduledJobs` runs
  // the sunset sweep only until plan P2 adds this one. Then this case joins ./settings.ts.
  describe("after the access sweep", () => {
    it("shows a lapsed member's ended access, the closed review's lapses, and the suspension the sweep recorded", async () => {
      const at = new Date(BASE.getTime() + 31 * DAY);
      await runAccessSweep(at);
      h.setClock(at);

      const sam = await h
        .services()
        .access.requestAccessData(await h.as("sam"));
      if (!sam.ok) throw new Error(sam.code);
      expect(sam.ended).toEqual([
        {
          teamId: "t_coral",
          status: "lapsed",
          reason: "recert_unconfirmed",
          at: new Date(BASE.getTime() + 30 * DAY).toISOString(),
        },
      ]);

      const alex = await h.as("alex");
      const recert = await h
        .services()
        .access.recertification(alex, { teamId: "t_coral" });
      if (!recert.ok) throw new Error(recert.code);
      expect(recert.current).toMatchObject({
        phase: "closed",
        completedAt: new Date(BASE.getTime() + 30 * DAY).toISOString(),
      });
      expect(recert.current!.lapsedIds).toEqual([
        "dana",
        "jordan",
        "maya",
        "priya",
        "sam",
      ]);
      expect(
        recert.current!.items.map((i) => [i.userId, i.membership]),
      ).toEqual([
        ["dana", "lapsed"],
        ["devon", "suspended"],
        ["jordan", "lapsed"],
        ["maya", "lapsed"],
        ["priya", "lapsed"],
        ["sam", "lapsed"],
      ]);
      // Everyone but Alex lapsed or was suspended: nobody is left to review.
      expect(recert.can.start).toMatchObject({
        ok: false,
        code: ACCESS_REFUSALS.nobodyToReview.code,
      });

      const idle = await h
        .services()
        .access.inactivity(alex, { teamId: "t_coral" });
      if (!idle.ok) throw new Error(idle.code);
      expect(idle.suspended.map((r) => [r.userId, r.statusReason])).toEqual([
        ["devon", "inactivity_auto"],
      ]);

      const members = await h
        .services()
        .access.members(alex, { teamId: "t_coral" });
      if (!members.ok) throw new Error(members.code);
      const lapsed = members.rows.find((r) => r.userId === "sam")!;
      // A lapsed member can be restored; their roles can't change while their access isn't active.
      expect(lapsed.can.reinstate).toEqual({ ok: true });
      expect(lapsed.can.editRoles).toMatchObject({
        ok: false,
        code: ACCESS_REFUSALS.notActive.code,
      });
    });
  });
});
