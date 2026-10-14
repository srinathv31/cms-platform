import { describe, expect, it } from "vitest";
import type { AnyNotificationKind } from "./access-types";
import {
  NOTIFICATION_KINDS,
  describeNotification,
  isNotificationKind,
  type NotificationFactsOf,
} from "./notifications";

// The bell's sentences, worded from the facts a notification stores (decision 0055). Each is the sentence the
// transitions used to store, so a stored notification reads as it always did.

const SPRING = "Spring Travel Rewards — Terms";

/** The words `kind` reads with to `reader`, from facts typed as the writers write them. */
function say<K extends AnyNotificationKind>(
  kind: K,
  facts: NotificationFactsOf<K>,
  reader = "reader",
) {
  return describeNotification(kind, facts as Record<string, unknown>, reader);
}

describe("the kinds", () => {
  it("knows all eighteen, and nothing else", () => {
    expect(NOTIFICATION_KINDS).toHaveLength(18);
    expect(new Set(NOTIFICATION_KINDS).size).toBe(18);
    for (const kind of NOTIFICATION_KINDS)
      expect(isNotificationKind(kind)).toBe(true);
    expect(isNotificationKind("toString")).toBe(false);
    expect(isNotificationKind("an_old_spelling")).toBe(false);
  });
});

describe("describeNotification: the lifecycle", () => {
  it("names a round in review only once its number was sent back", () => {
    const facts = {
      actorName: "Maya Chen",
      templateName: SPRING,
      number: 1,
      round: 1,
    };
    expect(say("review_requested", facts)).toEqual({
      title: `Maya Chen submitted ${SPRING} v1 for review.`,
      body: null,
    });
    expect(say("review_requested", { ...facts, round: 2 }).title).toBe(
      `Maya Chen submitted ${SPRING} v1, round 2 for review.`,
    );
  });

  it("says which stage a round waits on, after a stage's approval or a chain edit", () => {
    expect(
      say("review_requested", {
        actorName: "Alex Kim",
        templateName: SPRING,
        number: 2,
        round: 1,
        stage: "Legal",
      }).title,
    ).toBe(`${SPRING} v2 is waiting on Legal.`);
  });

  it("words a stage's approval, with the next stage on its second line", () => {
    expect(
      say("stage_approved", {
        actorName: "Jordan Ellis",
        templateName: SPRING,
        number: 1,
        round: 2,
        stage: "Team approver",
        next: "Legal",
      }),
    ).toEqual({
      title: `Jordan Ellis approved ${SPRING} v1, round 2 for Team approver.`,
      body: "Next: Legal.",
    });
  });

  it("names a released version by its number alone, whichever round it was approved on", () => {
    expect(
      say("version_live", {
        actorName: "Jordan Ellis",
        templateName: SPRING,
        number: 2,
      }),
    ).toEqual({
      title: `${SPRING} v2 is now Active.`,
      body: "Jordan Ellis approved it.",
    });
    expect(
      say("revoke_started", {
        actorName: "Jordan Ellis",
        templateName: SPRING,
        number: 1,
      }).title,
    ).toBe(`Jordan Ellis started revoking ${SPRING} v1. Confirm or cancel.`);
    expect(
      say("version_revoked", {
        actorName: "Alex Kim",
        templateName: SPRING,
        number: 1,
      }).title,
    ).toBe(`Alex Kim confirmed the revoke of ${SPRING} v1.`);
  });

  it("names a round sent back with its round, even the first", () => {
    expect(
      say("changes_requested", {
        actorName: "Jordan Ellis",
        templateName: SPRING,
        number: 1,
        round: 1,
      }).title,
    ).toBe(`Jordan Ellis requested changes on ${SPRING} v1, round 1.`);
  });

  it("words a comment on the version it was on, as it was then", () => {
    const on = (
      number: number | null,
      round: number | null,
      state: NotificationFactsOf<"comment_added">["state"],
      reply = false,
    ) =>
      say("comment_added", {
        actorName: "Jordan Ellis",
        templateName: SPRING,
        number,
        round,
        state,
        reply,
      }).title;
    expect(on(null, null, "draft")).toBe(
      `Jordan Ellis commented on the draft of ${SPRING}.`,
    );
    expect(on(3, 2, "in_review")).toBe(
      `Jordan Ellis commented on ${SPRING} v3, round 2.`,
    );
    expect(on(1, 1, "changes_requested", true)).toBe(
      `Jordan Ellis replied on ${SPRING} v1, round 1.`,
    );
    expect(on(2, 3, "active", true)).toBe(
      `Jordan Ellis replied on ${SPRING} v2.`,
    );
  });

  it("dates a sunset by its day", () => {
    expect(
      say("sunset_scheduled", {
        templateName: SPRING,
        number: 1,
        sunsetAt: "2027-03-01T05:00:00.000Z",
        sunsetDay: "2027-03-01",
        zone: "America/New_York",
      }).title,
    ).toBe(`${SPRING} v1 will stop rendering on March 1, 2027.`);
  });
});

describe("describeNotification: access", () => {
  it("words a request and its decisions", () => {
    expect(
      say("access_requested", {
        actorName: "Morgan Lee",
        teamName: "Coral Offers",
        role: "author",
      }).title,
    ).toBe("Morgan Lee asked for Author access to Coral Offers.");
    expect(
      say("access_granted", {
        actorName: "Alex Kim",
        teamName: "Coral Offers",
        role: "author",
      }).title,
    ).toBe("Alex Kim approved your Author access to Coral Offers.");
    expect(
      say("access_granted", { actorName: "Alex Kim", teamName: "Coral Offers" })
        .title,
    ).toBe("Alex Kim restored your access to Coral Offers.");
    expect(
      say("access_denied", {
        actorName: "Alex Kim",
        teamName: "Coral Offers",
        role: "approver",
      }).title,
    ).toBe(
      "Alex Kim declined your request for Approver access to Coral Offers.",
    );
  });

  it("words a member's roles, removal and appointment", () => {
    expect(
      say("roles_changed", {
        actorName: "Alex Kim",
        teamName: "Coral Offers",
        roles: ["approver", "author"],
      }).title,
    ).toBe("Alex Kim changed your roles on Coral Offers to Author & Approver.");
    expect(
      say("access_removed", { actorName: "Alex Kim", teamName: "Coral Offers" })
        .title,
    ).toBe("Alex Kim removed your access to Coral Offers.");
    // The review's quarter is worded from its deadline: no label is stored.
    expect(
      say("access_removed", {
        actorName: "Alex Kim",
        teamName: "Coral Offers",
        recertDueAt: "2027-01-15T12:00:00.000Z",
      }).title,
    ).toBe(
      "Your access to Coral Offers was removed in the Q1 2027 access review.",
    );
    expect(
      say("team_admin_appointed", {
        actorName: "Riley Brooks",
        teamName: "Home Loans",
      }).title,
    ).toBe("Riley Brooks made you Team Admin of Home Loans.");
  });

  it("says 'your access' to the member and names them to anyone else", () => {
    const lapsed = {
      userId: "sam",
      userName: "Sam Ortiz",
      teamName: "Coral Offers",
      dueAt: "2026-11-04T12:00:00.000Z",
    };
    expect(say("access_lapsed", lapsed, "sam").title).toBe(
      "Your access to Coral Offers lapsed: it wasn't recertified by November 4, 2026.",
    );
    expect(say("access_lapsed", lapsed, "alex").title).toBe(
      "Sam Ortiz's access to Coral Offers lapsed: not recertified by November 4, 2026.",
    );

    const swept = {
      userId: "devon",
      userName: "Devon Lin",
      teamName: "Coral Offers",
      daysInactive: 120,
      actorName: null,
    };
    expect(say("access_suspended", swept, "devon").title).toBe(
      "Your access to Coral Offers was suspended after 120 days without a sign-in.",
    );
    expect(say("access_suspended", swept, "alex").title).toBe(
      "Devon Lin's access to Coral Offers was suspended after 120 days without a sign-in.",
    );
    expect(
      say(
        "access_suspended",
        { ...swept, daysInactive: 95, actorName: "Alex Kim" },
        "devon",
      ).title,
    ).toBe(
      "Alex Kim suspended your access to Coral Offers after 95 days without a sign-in.",
    );
  });

  it("words inactivity and a review to the Team Admins, with the date on the second line", () => {
    expect(
      say("inactivity_flagged", {
        userId: "devon",
        userName: "Devon Lin",
        teamName: "Coral Offers",
        suspendsAt: "2026-11-03T12:00:00.000Z",
      }),
    ).toEqual({
      title: "Devon Lin hasn't signed in for 90 days.",
      body: "Access to Coral Offers is suspended automatically on November 3, 2026.",
    });
    expect(
      say("recert_due", {
        teamName: "Coral Offers",
        dueAt: "2026-11-04T12:00:00.000Z",
        members: 6,
      }),
    ).toEqual({
      title: "Q4 2026 access review for Coral Offers is due November 4, 2026.",
      body: "Confirm 6 members.",
    });
    expect(
      say("recert_due", {
        teamName: "Coral Offers",
        dueAt: "2026-11-04T12:00:00.000Z",
        members: 1,
      }).body,
    ).toBe("Confirm 1 member.");
  });

  it("tells the Platform Admins when the last Team Admin keeps their access", () => {
    expect(
      say("recert_due", {
        userId: "alex",
        userName: "Alex Kim",
        teamName: "Coral Offers",
        dueAt: "2026-11-04T12:00:00.000Z",
        keptLastAdmin: true,
      }),
    ).toEqual({
      title:
        "Alex Kim wasn't recertified by November 4, 2026, but as the last Team Admin of Coral Offers their access stays on.",
      body: null,
    });
    expect(
      say("inactivity_flagged", {
        userId: "alex",
        userName: "Alex Kim",
        teamName: "Coral Offers",
        daysInactive: 120,
        keptLastAdmin: true,
      }).title,
    ).toBe(
      "Alex Kim hasn't signed in for 120 days, but as the last Team Admin of Coral Offers their access stays on.",
    );
  });
});

describe("describeNotification: a row it can't word", () => {
  it("gives every kind its plain sentence when the facts are missing or malformed", () => {
    for (const kind of NOTIFICATION_KINDS) {
      for (const facts of [null, {}, { teamName: 42, number: "1" }]) {
        const { title, body } = describeNotification(kind, facts, "reader");
        expect(title, kind).toMatch(/^[A-Z].*[.]$/);
        expect(title, kind).not.toMatch(/undefined|null|NaN|\[object/);
        expect(body, kind).toBeNull();
      }
    }
    expect(describeNotification("access_requested", {}, "reader").title).toBe(
      "Someone asked for access to your team.",
    );
    expect(
      describeNotification(
        "access_requested",
        { teamName: "Coral Offers" },
        "reader",
      ).title,
    ).toBe("Someone asked for access to Coral Offers.");
    expect(
      describeNotification(
        "review_requested",
        { actorName: "Maya Chen", templateName: SPRING, number: 1 },
        "reader",
      ).title,
    ).toBe("A version is waiting for your review.");
    expect(
      describeNotification(
        "sunset_scheduled",
        { templateName: SPRING, number: 1, sunsetDay: "2027-02-30" },
        "reader",
      ).title,
    ).toBe("A sunset date was set.");
  });

  it("words a kind it doesn't know yet generically", () => {
    for (const kind of ["an_old_spelling", "toString", ""])
      expect(describeNotification(kind, { anything: 1 }, "reader")).toEqual({
        title: "Something changed in Stencil.",
        body: null,
      });
  });
});
