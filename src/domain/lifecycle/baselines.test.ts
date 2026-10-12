import { describe, expect, it } from "vitest";
import { contractBaseline, renameBaseline, reviewBaseline } from "./baselines";
import type { VersionState } from "../types";
import { NOW } from "./fixtures";

describe("contractBaseline", () => {
  const DAY = 86_400_000;
  const v = (
    id: string,
    state: VersionState,
    number: number | null,
    sunsetAt: Date | null = null,
  ) => ({
    id,
    state,
    number,
    sunsetAt,
  });
  const later = new Date(NOW.getTime() + 30 * DAY);
  const passed = new Date(NOW.getTime() - DAY);

  it("is the Active version when there is one, whatever is newer or older", () => {
    expect(
      contractBaseline(
        [
          v("v1", "superseded", 1, later),
          v("v2", "active", 2),
          v("v3", "in_review", 3),
          v("d", "draft", null),
        ],
        NOW,
      )?.id,
    ).toBe("v2");
    expect(
      contractBaseline([v("v1", "revoked", 1), v("v2", "active", 2)], NOW)?.id,
    ).toBe("v2");
  });

  it("after the Active version is revoked, is the newest Superseded version that still renders", () => {
    const list = [
      v("v1", "superseded", 1, later),
      v("v2", "superseded", 2),
      v("v3", "revoked", 3),
      v("d", "draft", null),
    ];
    expect(contractBaseline(list, NOW)?.id).toBe("v2");
  });

  it("skips a Superseded version whose sunset has passed, to the next newest that still renders", () => {
    const list = [
      v("v1", "superseded", 1, later),
      v("v2", "superseded", 2, passed),
      v("v3", "revoked", 3),
    ];
    expect(contractBaseline(list, NOW)?.id).toBe("v1");
    // At the sunset's own instant it has passed, as the render rule says.
    expect(
      contractBaseline(
        [v("v1", "superseded", 1, NOW), v("v2", "revoked", 2)],
        NOW,
      ),
    ).toBeNull();
  });

  it("is null when nothing renders: no versions, only drafts, or everything revoked or past its sunset", () => {
    expect(contractBaseline([], NOW)).toBeNull();
    expect(contractBaseline([v("d", "draft", null)], NOW)).toBeNull();
    expect(
      contractBaseline(
        [
          v("v1", "superseded", 1, passed),
          v("v2", "revoked", 2),
          v("d", "draft", null),
        ],
        NOW,
      ),
    ).toBeNull();
    expect(
      contractBaseline(
        [v("v1", "changes_requested", 1), v("v2", "in_review", 2)],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("renameBaseline", () => {
  const v = (
    id: string,
    state: VersionState,
    number: number | null,
    basedOnVersionId: string | null = null,
  ) => ({
    id,
    state,
    number,
    sunsetAt: null,
    basedOnVersionId,
  });

  it("is what customers get today, and nothing on the version they get", () => {
    const list = [
      v("v1", "superseded", 1),
      v("v2", "active", 2, "v1"),
      v("v3", "in_review", 3, "v2"),
    ];
    expect(renameBaseline(list, "v3", NOW)?.id).toBe("v2");
    expect(renameBaseline(list, "v1", NOW)?.id).toBe("v2");
    expect(renameBaseline(list, "v2", NOW)).toBeNull();
    expect(renameBaseline([v("v1", "in_review", 1)], "v1", NOW)).toBeNull();
  });

  it("for a round sent back before its number went live, is what the round was drafted from", () => {
    const list = [
      v("v1", "superseded", 1),
      v("v2r1", "changes_requested", 2, "v1"),
      v("v2r2", "active", 2, "v2r1"),
    ];
    expect(renameBaseline(list, "v2r1", NOW)?.id).toBe("v1");
    expect(
      renameBaseline(
        [v("v1r1", "changes_requested", 1), v("v1r2", "active", 1, "v1r1")],
        "v1r1",
        NOW,
      ),
    ).toBeNull();
  });
});

describe("reviewBaseline", () => {
  const DAY = 86_400_000;
  const v = (
    id: string,
    state: VersionState,
    number: number | null,
    basedOnVersionId: string | null = null,
    sunsetAt: Date | null = null,
  ) => ({
    id,
    state,
    number,
    sunsetAt,
    basedOnVersionId,
  });
  const later = new Date(NOW.getTime() + 30 * DAY);
  const passed = new Date(NOW.getTime() - DAY);

  it("is the Active version when there is one, whatever the version was based on; none on the Active version itself", () => {
    const list = [
      v("v1", "revoked", 1),
      v("v2", "active", 2, "v1"),
      v("v3", "in_review", 3, "v1"),
    ];
    expect(reviewBaseline(list, "v3", NOW)?.id).toBe("v2");
    expect(
      reviewBaseline(list, "v1", NOW)?.id,
      "an older record is compared with the Active version, as before",
    ).toBe("v2");
    expect(reviewBaseline(list, "v2", NOW)).toBeNull();
  });

  it("after a revoke, is the revoked version the correction started from, not the newest that still renders", () => {
    const list = [
      v("v1", "superseded", 1, null, later),
      v("v2", "revoked", 2, "v1"),
      v("v3", "in_review", 3, "v2"),
    ];
    expect(reviewBaseline(list, "v3", NOW)).toMatchObject({
      id: "v2",
      state: "revoked",
      number: 2,
    });
    // The same when the Active version is revoked while its correction is in review.
    expect(
      reviewBaseline(
        [v("v1", "revoked", 1), v("v2", "in_review", 2, "v1")],
        "v2",
        NOW,
      )?.id,
    ).toBe("v1");
  });

  it("walks back through change-request rounds to the revoked version they all correct", () => {
    // v3's rounds 1 and 2 were sent back; round 3 is in review.
    const list = [
      v("v2", "revoked", 2),
      v("v3r1", "changes_requested", 3, "v2"),
      v("v3r2", "changes_requested", 3, "v3r1"),
      v("v3r3", "in_review", 3, "v3r2"),
    ];
    expect(reviewBaseline(list, "v3r3", NOW)?.id).toBe("v2");
  });

  it("falls back to the newest version that still renders when the based-on version is missing", () => {
    const superseded = v("v1", "superseded", 1, null, later);
    expect(
      reviewBaseline(
        [superseded, v("v2", "revoked", 2), v("v3", "in_review", 3)],
        "v3",
        NOW,
      )?.id,
      "no based-on version",
    ).toBe("v1");
    expect(
      reviewBaseline([superseded, v("v3", "in_review", 3, "v_gone")], "v3", NOW)
        ?.id,
      "a based-on row that's gone",
    ).toBe("v1");
    expect(
      reviewBaseline([superseded, v("v3", "in_review", 3, "v3")], "v3", NOW)
        ?.id,
      "never the version itself",
    ).toBe("v1");
  });

  it("compares a round sent back before its number went live with what it was drafted from, never its own release", () => {
    // High-Yield Savings: v1 Superseded; v2 sent back twice, then approved on round 3.
    const list = [
      v("v1", "superseded", 1),
      v("v2r1", "changes_requested", 2, "v1"),
      v("v2r2", "changes_requested", 2, "v2r1"),
      v("v2r3", "active", 2, "v2r2"),
    ];
    expect(reviewBaseline(list, "v2r1", NOW)?.id).toBe("v1");
    expect(reviewBaseline(list, "v2r2", NOW)?.id).toBe("v1");
    expect(reviewBaseline(list, "v2r3", NOW)).toBeNull();
    // A first version approved on round 2: its round 1 has nothing before it.
    expect(
      reviewBaseline(
        [v("v1r1", "changes_requested", 1), v("v1r2", "active", 1, "v1r1")],
        "v1r1",
        NOW,
      ),
    ).toBeNull();
    // Once a later version is Active, an old round compares with it, as every older record does.
    const later = [
      ...list.slice(0, 3),
      v("v2r3", "superseded", 2, "v2r2"),
      v("v3", "active", 3, "v2r3"),
    ];
    expect(reviewBaseline(later, "v2r1", NOW)?.id).toBe("v3");
  });

  it("is null for a first version, a change-request round of one, or when nothing renders", () => {
    expect(reviewBaseline([v("v1", "in_review", 1)], "v1", NOW)).toBeNull();
    expect(
      reviewBaseline(
        [v("v1r1", "changes_requested", 1), v("v1r2", "in_review", 1, "v1r1")],
        "v1r2",
        NOW,
      ),
      "nothing was ever released",
    ).toBeNull();
    expect(
      reviewBaseline(
        [
          v("v1", "superseded", 1, null, passed),
          v("v2", "revoked", 2),
          v("v3", "in_review", 3),
        ],
        "v3",
        NOW,
      ),
    ).toBeNull();
    // The version is itself the newest that still renders: nothing to compare it with.
    expect(
      reviewBaseline(
        [v("v1", "superseded", 1, null, later), v("v2", "revoked", 2)],
        "v1",
        NOW,
      ),
    ).toBeNull();
  });
});
