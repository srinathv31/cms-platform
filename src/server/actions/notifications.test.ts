import { refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications";

// The bell's actions as the BFF runs them, against the in-memory fake (decision 0068): what an action adds to
// its service is the input's parse, the answer's shape, and whether the page refreshes. What the service decides
// (whose notification it is, the read time, a second mark) is the contract suite's
// (src/server/services/contract/notifications.ts). Seed: Alex has two unread notifications.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });

beforeEach(() => {
  vi.mocked(refresh).mockClear();
});

async function unreadOf(userId: string) {
  const list = await services().notifications.list(backend.as(userId), {
    limit: 100,
  });
  if (!list.ok) throw new Error(list.code);
  return list.items.filter((n) => n.readAt === null);
}

describe("markNotificationRead", () => {
  it("answers { ok: true } and refreshes once it marked one; again, it answers the same and refreshes nothing", async () => {
    const [first] = await unreadOf("alex");
    expect(await markNotificationRead({ id: first!.id })).toEqual({
      ok: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await markNotificationRead({ id: first!.id })).toEqual({
      ok: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("answers notification_gone for an id that doesn't parse, as the service does for one that isn't the viewer's", async () => {
    const [alexs] = await unreadOf("alex");
    backend.as("maya");
    const refused = await markNotificationRead({ id: alexs!.id });
    expect(refused).toEqual({
      ok: false,
      code: REQUEST_REFUSALS.notificationGone.code,
      reason: REQUEST_REFUSALS.notificationGone.reason,
    });
    expect(await markNotificationRead({ id: "" })).toEqual(refused);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("answers signed_out when nobody is signed in", async () => {
    backend.signOut();
    expect(await markNotificationRead({ id: "nt_any" })).toMatchObject({
      ok: false,
      code: REQUEST_REFUSALS.signedOut.code,
    });
  });
});

describe("markAllNotificationsRead", () => {
  it("answers how many it marked, and refreshes only when it marked some", async () => {
    backend.as("alex");
    expect(await markAllNotificationsRead()).toEqual({ ok: true, count: 2 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await markAllNotificationsRead()).toEqual({ ok: true, count: 0 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
