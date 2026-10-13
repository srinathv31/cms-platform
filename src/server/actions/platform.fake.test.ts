import { refresh, revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORM_REFUSALS } from "@/domain/platform-config/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ApproverRule } from "@/domain/types";
import type { PlatformActions } from "@/server/queries/access-models";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import {
  createTeam,
  saveApprovalChain,
  setBusinessZone,
  setChannelRule,
  updateContentType,
} from "./platform";

// The platform actions as the BFF runs them, against the in-memory fake (decision 0068): the input's parse, the
// answer's shape, and which pages refresh. What the service decides is the contract suite's
// (src/server/services/contract/platform.ts), on the fake and the database alike.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

// The settings screens' contract (`PlatformActions` in queries/access-models.ts): the actions have these signatures.
const _contract: PlatformActions = {
  createTeam,
  updateContentType,
  setChannelRule,
  saveApprovalChain,
  setBusinessZone,
};
void _contract;

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });
const CT = "ct_disclosure";
const TEAM_RULE: ApproverRule = { kind: "team_role", role: "approver" };

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

function expectRefreshed() {
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  expect(refresh).toHaveBeenCalledTimes(1);
}

describe("createTeam", () => {
  it("answers the new team's id and slug, and refreshes every page", async () => {
    backend.as("riley");
    const created = await createTeam({
      name: "Home Loans",
      description: "",
      icon: "home",
      adminUserId: "alex",
    });
    expect(created).toEqual({
      ok: true,
      teamId: expect.any(String),
      slug: "home-loans",
    });
    expectRefreshed();
  });

  it("answers the service's refusal as it is, and refreshes nothing", async () => {
    backend.as("alex");
    expect(
      await createTeam({
        name: "Home Loans",
        description: "",
        icon: "home",
        adminUserId: "alex",
      }),
    ).toEqual({ ok: false, ...REASONS.generic });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the settings that may be saved as they are", () => {
  it("refresh every page when the service changed the setting, and nothing when it didn't", async () => {
    backend.as("riley");
    const saves = [
      () => setBusinessZone({ zone: "America/Chicago" }),
      () =>
        setChannelRule({ contentTypeId: CT, channel: "web", allowed: false }),
      () =>
        updateContentType({
          contentTypeId: CT,
          requiredSections: [{ key: "privacy", title: "Privacy" }],
        }),
      () =>
        saveApprovalChain({
          contentTypeId: CT,
          stages: [
            { id: "stage_disclosure_0", name: "Team review", rule: TEAM_RULE },
          ],
        }),
    ];
    for (const save of saves) {
      vi.mocked(refresh).mockClear();
      vi.mocked(revalidatePath).mockClear();
      expect(await save()).toEqual({ ok: true });
      expectRefreshed();
      vi.mocked(refresh).mockClear();
      expect(await save()).toEqual({ ok: true });
      expect(refresh).not.toHaveBeenCalled();
    }
  });

  it("answer the service's refusal as it is", async () => {
    backend.as("riley");
    expect(await setBusinessZone({ zone: "Europe/London" })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.pickZone,
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("input that doesn't parse", () => {
  it("is refused before asking the service: a team role other than Approver on a stage, an empty zone", async () => {
    backend.as("riley");
    const chain = vi.spyOn(services().platform, "saveApprovalChain");
    const zone = vi.spyOn(services().platform, "setBusinessZone");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          {
            id: "stage_disclosure_0",
            name: "Team approver",
            rule: { kind: "team_role", role: "viewer" } as ApproverRule,
          },
        ],
      }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.invalidInput() });
    expect(await setBusinessZone({ zone: "" })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    expect(chain).not.toHaveBeenCalled();
    expect(zone).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in, before anything else", async () => {
    backend.signOut();
    expect(await setBusinessZone({ zone: "America/Chicago" })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.signedOut,
    });
  });
});
