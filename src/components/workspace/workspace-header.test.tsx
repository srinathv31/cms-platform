import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceHeaderData } from "@/server/queries/workspace";

// The header with a renamed draft open on a live template: its name field edits the draft's name, and
// the SHARE ring's sheet (what consumers get) carries the Active version's. The name is versioned
// (docs/decisions/0016-the-name-is-versioned.md).

const header = vi.hoisted(() => ({ data: null as WorkspaceHeaderData | null }));
vi.mock("@/server/queries/workspace", () => ({ getWorkspaceHeader: vi.fn(async () => header.data) }));
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => new Date("2026-10-04T12:00:00.000Z")) }));

const { WorkspaceHeader } = await import("./workspace-header");
const { NameField } = await import("./name-field");
const { WorkspaceShare } = await import("./workspace-share");
const { BindDraft } = await import("./session/workspace-session");
const { SaveStopped } = await import("./save-status");

const DRAFT: WorkspaceHeaderData = {
  id: "UC-4F7K2Q",
  name: "Spring Travel Rewards — Card Terms",
  activeName: "Spring Travel Rewards — Terms",
  teamSlug: "coral-offers",
  teamName: "Coral Offers",
  status: "draft",
  sunsetDay: null,
  versionLabel: "Based on v2",
  basedOn: { label: "v2", active: true },
  activeNumber: 2,
  versionNumber: 3,
  round: 1,
  inReview: null,
  canEdit: true,
  editable: true,
  draft: { versionId: "v_draft3", rev: 7 },
  canStartDraft: false,
  canSubmit: true,
};

/** Every element of a rendered tree of a given component, depth first. */
function find<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child) => find<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === type ? [node as ReactElement<P>] : [];
  return [...own, ...find<P>(node.props.children, type)];
}

async function render(data: WorkspaceHeaderData) {
  header.data = data;
  return WorkspaceHeader({ params: Promise.resolve({ team: data.teamSlug, templateId: data.id }) });
}

describe("WorkspaceHeader names", () => {
  it("edits the draft's name, and shares the Active version's", async () => {
    const tree = await render(DRAFT);
    expect(find<{ name: string; editable: boolean }>(tree, NameField).map((el) => el.props)).toEqual([
      { name: "Spring Travel Rewards — Card Terms", editable: true },
    ]);
    expect(find<{ templateName: string; activeVersion: number }>(tree, WorkspaceShare).map((el) => el.props)).toEqual([
      { templateId: "UC-4F7K2Q", templateName: "Spring Travel Rewards — Terms", activeVersion: 2 },
    ]);
  });

  it("has no SHARE ring when nothing is Active", async () => {
    const tree = await render({ ...DRAFT, activeName: null, activeNumber: null, versionLabel: null, basedOn: null });
    expect(find(tree, WorkspaceShare)).toEqual([]);
  });
});

// The header is in the layout, on every tab, so it binds the autosave session: a rename on Versions,
// Usage or Activity saves like one on Content (handoff review I1).
describe("WorkspaceHeader binding", () => {
  it("binds the session to the draft it shows, with the rev autosave starts from", async () => {
    const tree = await render(DRAFT);
    expect(find<{ draft: unknown }>(tree, BindDraft).map((el) => el.props)).toEqual([{ draft: { versionId: "v_draft3", rev: 7 } }]);
  });

  it("unbinds on a version that can't be edited", async () => {
    const tree = await render({ ...DRAFT, status: "in_review", editable: false, draft: null, canSubmit: false });
    expect(find<{ draft: unknown }>(tree, BindDraft).map((el) => el.props)).toEqual([{ draft: null }]);
  });

  // A save refused for good says why and offers Reload on a line of its own (handoff review I6).
  it("keeps a line across the header, under the status row, for a save that stopped: on an editable draft only", async () => {
    expect(find<{ className: string }>(await render(DRAFT), SaveStopped).map((el) => el.props.className)).toEqual(["col-span-3 col-start-1 row-start-3"]);
    expect(find(await render({ ...DRAFT, editable: false, draft: null }), SaveStopped)).toEqual([]);
  });
});
