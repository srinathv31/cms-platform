import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AccessEffect } from "@/domain/access-types";
import type { EffectContext, LifecycleEffect } from "@/domain/review-types";
import type { Db } from "@/server/db/client";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { writeAccessEffects } from "../local/access-effects";
import { writeEffects } from "../local/effects";
import { localServices } from "../local/index";
import { inTransaction } from "../local/transaction";
import type { StoredNotification } from "../notifications";
import type { RequestContext } from "../types";
import { writeFakeAccessEffects } from "./access-effects";
import { writeFakeEffects } from "./effects";
import { fakeServices } from "./index";
import { cloneState, seededState, type SeededState } from "./state";
import { FakeStore } from "./store";

// The fake's effects writers against the local ones: the same effects, written by each into its own copy of the
// seed, reach the same people with the same facts, bodies and links (placed by team id), as each
// implementation's bell lists them. The commands that write them reach both through the contract suite as they
// move behind the seam; this holds the two writers to each other for every recipient rule meanwhile.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-fake-effects-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const AT = new Date(BASE.getTime() + 60_000);
const PEOPLE = ["alex", "jordan", "maya", "priya", "naomi", "riley", "morgan"];

const templates = seededDatabasePerTest({ base: BASE });
let db: Db;
let seeded: SeededState;
const contexts: Record<string, RequestContext> = {};

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
  seeded = seededState(BASE);
  for (const userId of PEOPLE)
    contexts[userId] = {
      viewer: await loadPersona(db, userId),
      correlationId: "req_test",
      credential: { kind: "in_process", userId },
    };
}, 60_000);

/** Writes the effects with both writers, then each implementation's bell for everyone, ids aside. */
async function bothWrite(write: {
  lifecycle?: { effects: LifecycleEffect[]; ctx: EffectContext };
  access?: { effects: AccessEffect[]; actorId: string | null };
}) {
  const state = cloneState(seeded.state);
  const store = new FakeStore(state);
  const { lifecycle, access } = write;
  await inTransaction(db, async (tx) => {
    if (lifecycle) await writeEffects(tx, lifecycle.effects, lifecycle.ctx);
    if (access)
      await writeAccessEffects(tx, access.effects, {
        now: AT,
        actorId: access.actorId,
      });
  });
  store.command((tx) => {
    if (lifecycle) writeFakeEffects(tx, lifecycle.effects, lifecycle.ctx);
    if (access)
      writeFakeAccessEffects(tx, access.effects, {
        now: AT,
        actorId: access.actorId,
      });
  });
  const clock = async () => AT;
  const bells = async (
    services: ReturnType<typeof localServices>,
  ): Promise<Record<string, Bell>> => {
    const out: Record<string, Bell> = {};
    for (const userId of PEOPLE) {
      const list = await services.notifications.list(contexts[userId]!, {
        limit: 100,
      });
      if (!list.ok) throw new Error(list.code);
      // Ids differ by implementation: compare the rest.
      out[userId] = list.items.map((n) => ({ ...n, id: undefined }));
    }
    return out;
  };
  return {
    local: await bells(localServices({ clock })),
    fake: await bells(fakeServices(state, { clock })),
  };
}

/** A person's bell, ids aside: each writer draws its own. */
type Bell = Omit<StoredNotification, "id">[];

/** What a writer added to a person's bell: the notifications created at `AT`. */
const added = (bell: Bell | undefined) =>
  (bell ?? []).filter((n) => n.createdAt === AT.toISOString());
const kinds = (bell: Bell | undefined) => added(bell).map((n) => n.kind);

describe("the fake's effects writers", () => {
  it("place lifecycle notifications as the local writer does: the team's recipients, the actor left out, a stage reviewer's link in their own space", async () => {
    const templateId = templates["balance-transfer"]!;
    const named = {
      actorName: "Jordan Ellis",
      templateName: "Balance Transfer Intro — Terms",
    };
    const { local, fake } = await bothWrite({
      lifecycle: {
        ctx: {
          at: AT,
          actorId: "jordan",
          teamId: "t_coral",
          templateId,
          versionId: "v_test",
        },
        effects: [
          {
            kind: "notification",
            notification: "review_requested",
            to: {
              kind: "team_role",
              role: "approver",
              exceptUserIds: ["maya"],
            },
            facts: { ...named, number: 3, round: 2, stage: "Legal" },
            link: { to: "review", templateId, versionNumber: 3, round: 2 },
          },
          ...["naomi", "riley", "maya", "jordan"].map(
            (userId): LifecycleEffect => ({
              kind: "notification",
              notification: "comment_added",
              to: { kind: "user", userId },
              facts: {
                ...named,
                number: 2,
                round: 1,
                state: "superseded",
                reply: true,
              },
              body: "Looks right to me.",
              link: {
                to: "template",
                templateId,
                reviewVersion: { number: 2 },
              },
            }),
          ),
        ],
      },
    });
    expect(fake).toEqual(local);
    // Jordan acted: nobody tells him. Naomi (Deposits only) opens v2's review in her own space.
    expect(added(local.jordan)).toEqual([]);
    expect(kinds(local.alex)).toEqual(["review_requested"]);
    expect(added(local.naomi)).toEqual([
      expect.objectContaining({
        link: {
          to: "review",
          teamId: "t_deposits",
          templateId,
          versionNumber: 2,
        },
      }),
    ]);
  });

  it("send access notifications as the local writer does: a team's admins, the Platform Admins, a person, the actor left out", async () => {
    const { local, fake } = await bothWrite({
      access: {
        actorId: "morgan",
        effects: [
          {
            kind: "notification",
            notification: "access_requested",
            to: {
              kind: "team_admins",
              teamId: "t_coral",
              exceptUserIds: ["morgan"],
            },
            teamId: "t_coral",
            facts: {
              actorName: "Morgan Lee",
              teamName: "Coral Offers",
              role: "author",
            },
            body: "Drafting the spring offers.",
            link: {
              to: "settings",
              teamId: "t_coral",
              section: "access-requests",
            },
          },
          {
            kind: "notification",
            notification: "inactivity_flagged",
            to: { kind: "platform_admins" },
            teamId: "t_deposits",
            facts: {
              userId: "naomi",
              userName: "Naomi Park",
              teamName: "Deposits",
              daysInactive: 120,
              keptLastAdmin: true,
            },
            link: { to: "platform", section: "teams" },
            at: AT,
          },
          {
            kind: "notification",
            notification: "access_denied",
            to: { kind: "user", userId: "morgan" }, // the actor: left out
            teamId: "t_coral",
            facts: {
              actorName: "Alex Kim",
              teamName: "Coral Offers",
              role: "approver",
            },
            body: "Ask Jordan first.",
            link: { to: "request-access" },
          },
        ],
      },
    });
    expect(fake).toEqual(local);
    expect(kinds(local.alex)).toEqual(["access_requested"]);
    expect(kinds(local.riley)).toEqual(["inactivity_flagged"]);
    expect(added(local.morgan)).toEqual([]);
  });
});
