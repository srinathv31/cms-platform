import type { ReactNode } from "react";
import type { Variable } from "@/editor";
import type { VersionState } from "@/domain/types";

export type LayoutId = "grid" | "column" | "rail";
export type HeadsId = "serif" | "sans";
export type ViewId = "draft" | "active" | "view";
export type TabId = "content" | "versions" | "usage" | "activity";
export type ChannelId = "pdf" | "web" | "email";

/** Everything a header, tab bar or panel needs to know about the template on screen. */
export interface TemplateModel {
  name: string;
  id: string;
  status: VersionState;
  /** Never repeats the status: "Based on v2" on a draft, "v2" on an Active version. */
  versionLabel: string | null;
  /** The viewer may edit this template right now (a draft they own). */
  editing: boolean;
  /** Read-only for this viewer (no write access to the team's templates). */
  viewOnly: boolean;
  /** The viewer could start a new draft from this version. */
  canStartDraft: boolean;
  showRing: boolean;
  channels: ChannelId[];
  docKey: "coral" | "deposits";
}

export interface FrameProps {
  model: TemplateModel;
  doc: ReactNode;
  variables: Variable[];
  uses: Record<string, number>;
  heads: HeadsId;
  tab: TabId;
  onTab: (tab: TabId) => void;
  onName: (name: string) => void;
  onEdit: () => void;
  onChannels: (channels: ChannelId[]) => void;
  saving: boolean;
}
