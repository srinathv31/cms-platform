import { describe, expect, it, vi } from "vitest";
import type {
  NotificationList,
  StoredNotification,
} from "@/server/services/notifications";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import { getNotificationsData, notificationsData } from "./notifications";

// The bell's read model: stored notifications (facts and a link by team id, decision 0055) worded for the
// viewer and linked under their spaces' slugs. Its shaping is tested on facts handed to `notificationsData`; one
// case reads the seeded bell end to end on the fake.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });

const SPACES = [
  { teamId: null, slug: "all" },
  { teamId: "t_coral", slug: "coral-offers" },
  { teamId: "t_deposits", slug: "deposits" },
];

function stored(over: Partial<StoredNotification>): StoredNotification {
  return {
    id: "nt_1",
    kind: "version_live",
    facts: {
      actorName: "Jordan Ellis",
      templateName: "Cash Back Welcome Bonus — Terms",
      number: 2,
    },
    link: { to: "template", teamId: "t_coral", templateId: "UC-AAAAAA" },
    body: null,
    createdAt: "2026-10-04T11:00:00.000Z",
    readAt: null,
    ...over,
  };
}

const list = (
  items: StoredNotification[],
  asOf = BASE.toISOString(),
): NotificationList => ({
  asOf,
  items,
  unreadCount: items.filter((n) => n.readAt === null).length + 3,
});

describe("notificationsData", () => {
  it("words each notification from its facts, links it under its team's slug, and keeps the unread count", () => {
    const data = notificationsData(list([stored({})]), SPACES, "maya");
    expect(data).toEqual({
      items: [
        {
          id: "nt_1",
          kind: "version_live",
          title: "Cash Back Welcome Bonus — Terms v2 is now Active.",
          body: "Jordan Ellis approved it.",
          href: "/coral-offers/templates/UC-AAAAAA",
          createdAt: "2026-10-04T11:00:00.000Z",
          ago: "1 hour ago",
          unread: true,
        },
      ],
      unreadCount: 4,
    });
  });

  it("keeps a person's own words as the body", () => {
    const [item] = notificationsData(
      list([
        stored({
          kind: "changes_requested",
          facts: {
            actorName: "Jordan Ellis",
            templateName: "Annual Fee Waiver — Terms",
            number: 1,
            round: 1,
          },
          body: "The waiver period is missing.",
          readAt: "2026-10-04T11:30:00.000Z",
        }),
      ]),
      SPACES,
      "maya",
    ).items;
    expect(item).toMatchObject({
      title:
        "Jordan Ellis requested changes on Annual Fee Waiver — Terms v1, round 1.",
      body: "The waiver period is missing.",
      unread: false,
    });
  });

  it("words a notification about a member for whoever reads it", () => {
    const lapsed = stored({
      kind: "access_lapsed",
      facts: {
        userId: "sam",
        userName: "Sam Ortiz",
        teamName: "Coral Offers",
        dueAt: "2026-11-04T12:00:00.000Z",
      },
      link: { to: "request-access" },
    });
    expect(
      notificationsData(list([lapsed]), SPACES, "sam").items[0]!.title,
    ).toBe(
      "Your access to Coral Offers lapsed: it wasn't recertified by November 4, 2026.",
    );
    expect(
      notificationsData(list([lapsed]), SPACES, "alex").items[0]!.title,
    ).toBe(
      "Sam Ortiz's access to Coral Offers lapsed: not recertified by November 4, 2026.",
    );
  });

  it("follows the team's slug when it is read: a link stored by id survives a team rename", () => {
    const renamed = [{ teamId: "t_coral", slug: "coral-cards" }];
    expect(
      notificationsData(list([stored({})]), renamed, "maya").items[0]!.href,
    ).toBe("/coral-cards/templates/UC-AAAAAA");
  });

  it("links a team the viewer can't enter to the app's root", () => {
    const elsewhere = stored({
      link: { to: "library", teamId: "t_cards" },
    });
    expect(
      notificationsData(list([elsewhere]), SPACES, "maya").items[0]!.href,
    ).toBe("/");
  });

  it("words a kind it doesn't know yet generically, with no kind for its icon", () => {
    const [item] = notificationsData(
      list([stored({ kind: "something_new", facts: {} })]),
      SPACES,
      "maya",
    ).items;
    expect(item).toMatchObject({
      kind: null,
      title: "Something changed in Stencil.",
      body: null,
    });
  });

  it("words each time by calendar day from the list's asOf: 23:00 the night before is Yesterday at 01:00 (D9)", () => {
    const data = notificationsData(
      list(
        [
          stored({ id: "late", createdAt: "2026-10-04T23:00:00.000Z" }),
          stored({ id: "early", createdAt: "2026-10-05T00:30:00.000Z" }),
        ],
        "2026-10-05T01:00:00.000Z",
      ),
      SPACES,
      "maya",
    );
    expect(Object.fromEntries(data.items.map((n) => [n.id, n.ago]))).toEqual({
      late: "Yesterday",
      early: "30 minutes ago",
    });
  });
});

describe("getNotificationsData", () => {
  it("lists the viewer's seeded notifications newest first, worded and linked, with the unread count", async () => {
    backend.as("alex");
    const data = await getNotificationsData();
    expect(data.items.map((n) => n.kind)).toEqual([
      "access_requested",
      "recert_due",
      "inactivity_flagged",
    ]);
    expect(data.unreadCount).toBe(2);
    expect(data.items.map((n) => n.unread)).toEqual([true, true, false]);
    expect(data.items[0]).toMatchObject({
      title: "Chris Morales asked for Author access to Coral Offers.",
      href: "/coral-offers/settings/access-requests",
      ago: "Yesterday", // 1.5 days before the backend's clock: calendar days
    });
    expect(data.items[1]).toMatchObject({
      title: expect.stringMatching(
        /^Q[1-4] \d{4} access review for Coral Offers is due [A-Z][a-z]+ \d{1,2}, \d{4}\.$/,
      ),
      body: "Confirm 6 members.",
      href: "/coral-offers/settings/recertification",
    });
    expect(data.items[2]).toMatchObject({
      title: "Devon Lin hasn't signed in for 90 days.",
      body: expect.stringMatching(
        /^Access to Coral Offers is suspended automatically on /,
      ),
      href: "/coral-offers/settings/inactivity",
      ago: "5 days ago",
    });
  });
});
