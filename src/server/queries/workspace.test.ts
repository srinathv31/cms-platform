import { describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import type { WorkspaceActions } from "@/domain/lifecycle/version-actions";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Person } from "@/domain/review-types";
import { refusal } from "@/server/services/results";
import type {
  WorkspaceDocumentFacts,
  WorkspaceHeaderFacts,
} from "@/server/services/workspace";
import {
  getWorkspaceDocument,
  getWorkspaceHeader,
  workspaceDocumentData,
  workspaceHeaderData,
} from "./workspace";

// The workspace's read models as the BFF builds them: facts in (what the template service answers), the header's
// and the Content tab's data out. The shaping functions are pure, so their tests hand them facts directly; what the
// service decides (which version the workspace shows, `can`) is the contract suite's
// (src/server/services/contract/workspace.ts). The `get…` read models are checked for the space and Not found.

const env = vi.hoisted(() => ({
  header: undefined as unknown,
  document: undefined as unknown,
}));
vi.mock("@/server/context/request", () => ({
  requireRequestContext: async () => ({
    viewer: { userId: "maya" },
    correlationId: "req_test",
  }),
}));
vi.mock("@/server/services", () => ({
  services: () => ({
    templates: {
      workspaceHeader: async () => env.header,
      workspaceDocument: async () => env.document,
    },
  }),
}));
vi.mock("./spaces", () => ({
  requireSpace: async (slug: string) => ({
    slug,
    teamId: slug === "all" ? null : `t_${slug}`,
  }),
}));

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ASOF = "2026-10-04T12:00:00.000Z";
const ALL_OK: WorkspaceActions = {
  edit: { ok: true },
  startDraft: { ok: true },
  submit: { ok: true },
};
const MAYA: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 5 };

/** The header's facts: Annual Fee Waiver's open draft, based on v1 sent back, unless `over` says otherwise. */
function header(
  over: Partial<WorkspaceHeaderFacts> = {},
): WorkspaceHeaderFacts {
  return {
    asOf: ASOF,
    template: {
      id: "UC-FEE001",
      teamId: "t_coral",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
    },
    shown: {
      id: "v_draft",
      number: null,
      round: null,
      state: "draft",
      name: "Annual Fee Waiver — Terms",
      sunsetDay: null,
      sunsetPassed: false,
      rev: 7,
    },
    numbered: { number: 1, round: 2 },
    basedOn: { number: 1, round: 1, state: "changes_requested" },
    active: null,
    inReview: null,
    can: ALL_OK,
    ...over,
  };
}

describe("workspaceHeaderData", () => {
  it("on an open draft: what it was based on, the number its submit takes, and the draft autosave binds to", () => {
    expect(workspaceHeaderData(header())).toEqual({
      id: "UC-FEE001",
      name: "Annual Fee Waiver — Terms",
      activeName: null,
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      status: "draft",
      sunsetDay: null,
      sunsetPassed: false,
      versionLabel: "Based on v1 · Round 1",
      basedOn: { label: "v1, round 1", active: false },
      activeNumber: null,
      versionNumber: 1,
      round: 2,
      inReview: null,
      editable: true,
      draft: { versionId: "v_draft", rev: 7 },
      can: ALL_OK,
      now: ASOF,
    });
  });

  it("binds no draft for someone who may not edit it: the header says View only", () => {
    const viewOnly = workspaceHeaderData(
      header({
        can: {
          edit: { ok: false, ...REASONS.generic },
          startDraft: { ok: false, ...REASONS.generic },
          submit: { ok: false, ...REASONS.generic },
        },
      }),
    );
    expect([viewOnly.editable, viewOnly.draft]).toEqual([false, null]);
  });

  it("on a submitted version: its own label, the Active version's name for the SHARE ring, and nothing to bind", () => {
    const data = workspaceHeaderData(
      header({
        shown: {
          id: "v_3_2",
          number: 3,
          round: 2,
          state: "in_review",
          name: "Cash Back Welcome Bonus — Terms",
          sunsetDay: null,
          sunsetPassed: false,
          rev: 4,
        },
        numbered: { number: 3, round: 2 },
        basedOn: null,
        active: { number: 2, name: "Cash Back — Terms" },
        inReview: { number: 3, round: 2, state: "in_review" },
        can: {
          ...ALL_OK,
          startDraft: { ok: false, ...REFUSALS.newerInReview },
          submit: { ok: false, ...REQUEST_REFUSALS.noDraftToSubmit },
        },
      }),
    );
    expect(data).toMatchObject({
      name: "Cash Back Welcome Bonus — Terms",
      status: "in_review",
      versionLabel: "v3 · Round 2",
      basedOn: null,
      activeName: "Cash Back — Terms",
      activeNumber: 2,
      inReview: { number: 3, round: 2, state: "in_review" },
      editable: false,
      draft: null,
    });
  });
});

describe("getWorkspaceHeader", () => {
  it("is Not found in another team's space, or when the service refuses", async () => {
    env.header = { ok: true, ...header() };
    expect((await getWorkspaceHeader("coral", "UC-FEE001")).id).toBe(
      "UC-FEE001",
    );
    expect((await getWorkspaceHeader("all", "UC-FEE001")).id).toBe("UC-FEE001");
    await expect(getWorkspaceHeader("deposits", "UC-FEE001")).rejects.toThrow(
      NOT_FOUND,
    );
    env.header = refusal(404, REQUEST_REFUSALS.templateUnavailable);
    await expect(getWorkspaceHeader("coral", "UC-FEE001")).rejects.toThrow(
      NOT_FOUND,
    );
  });
});

/** The Content tab's facts: an imported alert's open draft, with one thread. */
function document(
  over: Partial<WorkspaceDocumentFacts> = {},
): WorkspaceDocumentFacts {
  return {
    asOf: ASOF,
    template: {
      id: "UC-ALERT1",
      teamId: "t_coral",
      teamName: "Coral Offers",
      family: "message",
      allowedChannels: ["push", "sms"],
    },
    version: {
      id: "v_draft",
      number: null,
      round: null,
      state: "draft",
      rev: 3,
      body: { type: "doc", content: [] },
      variables: [],
      channels: ["sms"],
      channelFields: {},
      sampleSets: [],
    },
    baseline: [],
    messageRules: { smsFooter: "Reply STOP to end.", smsMaxParts: 3 },
    senders: { appName: "Coral", smsSender: "12345" },
    threads: [
      {
        id: "th_1",
        blockId: "sms.text",
        quote: null,
        status: "open",
        origin: null,
        comments: [
          {
            id: "c_1",
            authorId: "maya",
            body: "Shorter?",
            kind: "comment",
            createdAt: "2026-10-04T11:00:00.000Z",
          },
        ],
        resolvedBy: null,
        resolvedAt: null,
        orphaned: false,
      },
    ],
    can: { edit: { ok: true }, comment: { ok: true } },
    importOriginal: {
      uploadId: "up_1",
      filename: "alert.txt",
      kind: "txt",
      size: 120,
      uploadedAt: "2026-09-30T12:00:00.000Z",
      uploadedBy: "maya",
    },
    people: [MAYA],
    ...over,
  };
}

describe("workspaceDocumentData", () => {
  it("lays the document out for the Content tab, with its margin, who is looking, and today from the backend's instant", () => {
    const data = workspaceDocumentData(document(), "maya");
    expect(data).toMatchObject({
      templateId: "UC-ALERT1",
      teamName: "Coral Offers",
      versionId: "v_draft",
      versionNumber: null,
      round: null,
      rev: 3,
      family: "message",
      allowedChannels: ["push", "sms"],
      today: "2026-10-04",
      editable: true,
      can: { comment: { ok: true } },
      viewer: MAYA,
      now: ASOF,
      importOriginal: {
        uploadId: "up_1",
        filename: "alert.txt",
        kind: "txt",
        size: 120,
        uploadedAt: "2026-09-30T12:00:00.000Z",
        uploadedByName: "Maya Chen",
      },
    });
    expect(data.threads).toEqual([
      expect.objectContaining({
        id: "th_1",
        originVersionNumber: null,
        originLabel: null,
        comments: [expect.objectContaining({ author: MAYA })],
      }),
    ]);
  });

  it("is read-only on a submitted version, and for someone who may not edit", () => {
    expect(
      workspaceDocumentData(
        document({
          version: {
            ...document().version,
            number: 1,
            round: 1,
            state: "in_review",
          },
        }),
        "maya",
      ).editable,
    ).toBe(false);
    expect(
      workspaceDocumentData(
        document({
          can: {
            edit: { ok: false, ...REASONS.generic },
            comment: { ok: false, ...REASONS.generic },
          },
        }),
        "sam",
      ).editable,
    ).toBe(false);
  });
});

describe("getWorkspaceDocument", () => {
  it("is Not found in another team's space, or when the service refuses", async () => {
    env.document = { ok: true, ...document() };
    expect((await getWorkspaceDocument("coral", "UC-ALERT1")).viewer).toEqual(
      MAYA,
    );
    await expect(getWorkspaceDocument("deposits", "UC-ALERT1")).rejects.toThrow(
      NOT_FOUND,
    );
    env.document = refusal(404, REQUEST_REFUSALS.templateUnavailable);
    await expect(getWorkspaceDocument("coral", "UC-ALERT1")).rejects.toThrow(
      NOT_FOUND,
    );
  });
});
