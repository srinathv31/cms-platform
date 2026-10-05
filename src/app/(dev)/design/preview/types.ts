import type { ChannelId } from "../workspace/types";

export type { ChannelId };
export type VariantId = "a" | "b" | "c";
export type ModeId = "edit" | "preview";
export type DeviceId = "desktop" | "mobile";

/** A named set of sample values, canonical strings by variable key (as the editor stores them). */
export interface PreviewSet {
  id: string;
  name: string;
  values: Record<string, string>;
  /** Added by the author: its name can be edited. */
  custom?: boolean;
}

/** Everything the preview controls read and change. One object, so every variant wires the same. */
export interface PreviewControls {
  /** The channels that are on for this template, in display order. */
  channels: ChannelId[];
  channel: ChannelId;
  onChannel: (channel: ChannelId) => void;
  device: DeviceId;
  onDevice: (device: DeviceId) => void;
  sets: PreviewSet[];
  setId: string;
  onSet: (id: string) => void;
  onAddSet: () => void;
  onEditSet: (id: string, patch: Partial<Pick<PreviewSet, "name" | "values">>) => void;
}
