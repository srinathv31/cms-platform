import type { Channel } from "@/domain/types";

export type VariantId = "a" | "b";
/** What the main pane shows. A: `redline` is the Document tab with Show changes on. B: three tabs. */
export type ViewId = "document" | "redline" | "preview";
export type DialogId = "none" | "approve" | "request";
export type PersonaId = "jordan" | "maya";
export type StageCount = 1 | 2;
/** Where Approve and Request changes sit in the rail. */
export type ActionsAt = "top" | "bottom";
export type DeviceId = "desktop" | "mobile";
export type ChannelId = Channel;

/** Where the version is in this mock. `live` is the go-live moment playing. */
export type Outcome = "review" | "live" | "active" | "returned" | "stage-approved";

export interface ReviewInitial {
  variant: VariantId;
  view: ViewId;
  dialog: DialogId;
  persona: PersonaId;
  stages: StageCount;
  actions: ActionsAt;
  changesOnly: boolean;
  /** YYYY-MM-DD: opens the Approve dialog with a sunset date already set (for screenshots). */
  sunset: string | null;
  chrome: boolean;
}
