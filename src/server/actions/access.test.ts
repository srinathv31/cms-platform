import { refresh, revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_REFUSALS } from "@/domain/access/refusals";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { services } from "@/server/services";
import { seededAccess } from "@/server/services/contract/access";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import {
  changeMemberRoles,
  decideAccessRequest,
  decideRecertItem,
  keepInactive,
  reinstateMember,
  removeMember,
  requestAccess,
  startRecertification,
  suspendInactive,
} from "./access";

// The access actions as the BFF runs them, against the in-memory fake (decision 0068): what an action adds to its
// service is the input's parse, the answer's shape, and which pages refresh. What the service decides (the
// refusals, the memberships, the notifications) is the contract suite's (src/server/services/contract/access.ts),
// which holds the fake and the database to the same cases.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });
const ids = seededAccess();

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

/** Every page reads access: the layout refreshes. */
function expectRefreshed() {
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  expect(refresh).toHaveBeenCalledTimes(1);
}

describe("each access action", () => {
  it("calls its command with the input as parsed, answers its answer, and refreshes the layout", async () => {
    backend.as("alex");
    const access = services().access;
    const calls = [
      [
        "decideRequest",
        () =>
          decideAccessRequest({
            requestId: ids.request("chris"),
            decision: "approve",
          }),
      ],
      [
        "changeRoles",
        () =>
          changeMemberRoles({
            membershipId: ids.membership("maya"),
            roles: ["author", "approver"],
          }),
      ],
      [
        "suspendInactive",
        () => suspendInactive({ membershipId: ids.membership("devon") }),
      ],
      [
        "reinstateMember",
        () => reinstateMember({ membershipId: ids.membership("devon") }),
      ],
      [
        "decideRecertItem",
        () =>
          decideRecertItem({
            recertId: ids.recert(),
            userId: "jordan",
            decision: "keep",
          }),
      ],
      [
        "removeMember",
        () => removeMember({ membershipId: ids.membership("sam") }),
      ],
    ] as const;
    for (const [command, act] of calls) {
      const spy = vi.spyOn(access, command);
      vi.mocked(refresh).mockClear();
      vi.mocked(revalidatePath).mockClear();
      expect(await act()).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledOnce();
      expectRefreshed();
    }
  });

  it("keeps a flagged member through keepInactive", async () => {
    backend.as("alex");
    const spy = vi.spyOn(services().access, "keepInactive");
    expect(
      await keepInactive({ membershipId: ids.membership("devon") }),
    ).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith(expect.anything(), {
      membershipId: ids.membership("devon"),
    });
    expectRefreshed();
  });

  it("answers the ids a request or a review it creates gets", async () => {
    backend.as("morgan");
    expect(
      await requestAccess({
        teamId: "t_coral",
        role: "author",
        reason: "Spring offers.",
      }),
    ).toEqual({ ok: true, requestId: expect.any(String) });
    expectRefreshed();

    // Alex closes the open review first, so a new one may start.
    backend.as("alex");
    for (const userId of ["dana", "devon", "jordan", "maya", "priya", "sam"])
      await decideRecertItem({
        recertId: ids.recert(),
        userId,
        decision: "keep",
      });
    vi.mocked(refresh).mockClear();
    expect(await startRecertification({ teamId: "t_coral" })).toEqual({
      ok: true,
      recertId: expect.any(String),
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("answers the service's refusal as it is, its sentence included, and refreshes nothing", async () => {
    backend.as("maya");
    expect(
      await requestAccess({
        teamId: "t_coral",
        role: "author",
        reason: "Again.",
      }),
    ).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.hasRole("author", "Coral Offers"),
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in, before anything else", async () => {
    backend.signOut();
    expect(await removeMember({ membershipId: ids.membership("sam") })).toEqual(
      { ok: false, ...REQUEST_REFUSALS.signedOut },
    );
  });
});

describe("changeMemberRoles", () => {
  it("refreshes nothing when the member already has those roles", async () => {
    backend.as("alex");
    expect(
      await changeMemberRoles({
        membershipId: ids.membership("maya"),
        roles: ["author"],
      }),
    ).toEqual({ ok: true });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks for the roles again when they don't parse, whatever else is wrong, before asking the service", async () => {
    backend.as("alex");
    const spy = vi.spyOn(services().access, "changeRoles");
    expect(
      await changeMemberRoles({
        membershipId: "",
        roles: ["owner" as "author"],
      }),
    ).toEqual({ ok: false, ...ACCESS_REFUSALS.pickRoles });
    expect(
      await changeMemberRoles({ membershipId: "", roles: ["author"] }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("input that doesn't parse", () => {
  it("is refused with the parser's first problem, before asking the service", async () => {
    backend.as("morgan");
    const spy = vi.spyOn(services().access, "requestAccess");
    expect(
      await requestAccess({
        teamId: "t_coral",
        role: "author",
        reason: "x".repeat(1001),
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await decideAccessRequest({
        requestId: ids.request("chris"),
        decision: "maybe" as "approve",
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("passes a role that can't be requested on, for the service's own refusal", async () => {
    backend.as("morgan");
    expect(
      await requestAccess({
        teamId: "t_coral",
        role: "team_admin" as "author",
        reason: "Please.",
      }),
    ).toEqual({ ok: false, ...ACCESS_REFUSALS.pickRole });
  });
});
