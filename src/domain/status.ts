import type { VersionState } from "./types";

// One source of truth for how a state looks and reads — everywhere.
// `tone` maps to the --status-<tone>-* tokens; `icon` is a key the UI maps to a lucide icon.

export interface StatusMeta {
  label: string;
  tone: "draft" | "review" | "changes" | "active" | "superseded" | "revoked";
  icon: "dot" | "clock" | "corner-up-left" | "check" | "archive" | "ban";
  /** Renders for consumers? (build plan, lifecycle table) */
  renders: "no" | "preview" | "yes" | "until-sunset";
}

export const STATUS_META: Record<VersionState, StatusMeta> = {
  draft: { label: "Draft", tone: "draft", icon: "dot", renders: "preview" },
  in_review: { label: "In review", tone: "review", icon: "clock", renders: "preview" },
  changes_requested: {
    label: "Changes requested",
    tone: "changes",
    icon: "corner-up-left",
    renders: "no",
  },
  active: { label: "Active", tone: "active", icon: "check", renders: "yes" },
  superseded: { label: "Superseded", tone: "superseded", icon: "archive", renders: "until-sunset" },
  revoked: { label: "Revoked", tone: "revoked", icon: "ban", renders: "no" },
};

export function statusLabel(state: VersionState): string {
  return STATUS_META[state].label;
}
