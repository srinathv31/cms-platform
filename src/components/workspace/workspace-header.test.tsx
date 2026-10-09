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

const DRAFT: WorkspaceHeaderData = {
  id: "UC-4F7K2Q",
  name: "Spring Travel Rewards — Card Terms",
  activeName: "Spring Travel Rewards — Terms",
  teamSlug: "coral-offers",
  teamName: "Coral Offers",
  status: "draft",
  sunsetAt: null,
  versionLabel: "Based on v2",
  basedOnNumber: 2,
  activeNumber: 2,
  versionNumber: 3,
  canEdit: true,
  editable: true,
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
    const tree = await render({ ...DRAFT, activeName: null, activeNumber: null, versionLabel: null, basedOnNumber: null });
    expect(find(tree, WorkspaceShare)).toEqual([]);
  });
});
