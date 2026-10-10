"use client";

import { SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import {
  SCREEN_SIZES,
  SIZE_UNIT,
  pushScreenLabel,
  type DevicePlatform,
  type DeviceSettings,
  type DeviceWidth,
  type PhoneFit,
  type PushScreen,
} from "@/components/device";
import { Segmented } from "@/components/primitives/segmented";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// A mock of the preview rail's controls row and well for message channels, to settle their layout at the
// tightest well (469px on a 1280 × 800 window) before the real one is built in src/components/preview.
// The row is the preview's own: the channel at the left, the channel's controls at the right, 32px tall.

export type MockChannel = "push" | "sms";

export interface RailState {
  channel: MockChannel;
  screen: PushScreen;
  settings: DeviceSettings;
}

const SCREENS: PushScreen[] = ["lock", "banner", "expanded"];
const WIDTHS: DeviceWidth[] = ["compact", "standard", "large"];

/** The screens in the platform's words: Banner on iPhone, Heads-up on Android. */
function screenOptions(platform: DevicePlatform) {
  return SCREENS.map((value) => ({ value, label: pushScreenLabel(platform, value) }));
}

/** The widths in the platform's own sizes: 375pt · 402pt · 440pt, or 360dp · 412dp · 448dp. */
function widthOptions(platform: DevicePlatform) {
  return WIDTHS.map((value) => ({ value, label: `${SCREEN_SIZES[platform][value].width}${SIZE_UNIT[platform]}` }));
}

/** The rail's controls row: Push · SMS, then iPhone · Android and the Device options. */
export function ControlsRow({ state, onChange }: { state: RailState; onChange: (next: RailState) => void }) {
  const set = (patch: Partial<DeviceSettings>) => onChange({ ...state, settings: { ...state.settings, ...patch } });
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-3">
      <Segmented
        label="Channel"
        value={state.channel}
        options={[
          { value: "push", label: "Push" },
          { value: "sms", label: "SMS" },
        ]}
        onChange={(channel) => onChange({ ...state, channel })}
      />
      <div className="flex items-center gap-2">
        <Segmented
          label="Phone"
          value={state.settings.platform}
          options={[
            { value: "ios", label: "iPhone" },
            { value: "android", label: "Android" },
          ]}
          onChange={(platform) => set({ platform })}
        />
        <DeviceOptions state={state} onChange={onChange} />
      </div>
    </div>
  );
}

/** One labelled row of the Device popover. `blocked` greys it out and says why, at the control. */
function Row({ label, blocked, children }: { label: string; blocked?: string | null; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_auto] items-center gap-x-3">
      <span className="text-[13px] leading-5 text-text-muted">{label}</span>
      <div className={cn("flex flex-col gap-1", blocked && "opacity-50")} inert={Boolean(blocked)}>
        {children}
      </div>
      {blocked ? <span className="col-start-2 mt-1 text-[12px] leading-4 text-text-subtle">{blocked}</span> : null}
    </div>
  );
}

/** The 32px Device button and its popover: screen, appearance, previews, text size and width. */
function DeviceOptions({ state, onChange }: { state: RailState; onChange: (next: RailState) => void }) {
  const { settings, channel, screen } = state;
  const set = (patch: Partial<DeviceSettings>) => onChange({ ...state, settings: { ...settings, ...patch } });
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="icon" aria-label="Device options" title="Device options" className="bg-surface" />}
      >
        <SlidersHorizontal strokeWidth={1.75} />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-auto gap-3 rounded-xl border border-hairline bg-popover p-3 shadow-pop ring-0"
      >
        <Row label="Screen" blocked={channel === "sms" ? "Push only" : null}>
          <Segmented
            label="Screen"
            value={screen}
            options={screenOptions(settings.platform)}
            onChange={(next) => onChange({ ...state, screen: next })}
          />
        </Row>
        <Row label="Appearance">
          <Segmented
            label="Appearance"
            value={settings.appearance}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(appearance) => set({ appearance })}
          />
        </Row>
        <Row label="Previews" blocked={channel === "sms" || screen !== "lock" ? "Lock screen only" : null}>
          <Segmented
            label="Previews"
            value={settings.previewsHidden ? "hidden" : "shown"}
            options={[
              { value: "shown", label: "Shown" },
              { value: "hidden", label: "Hidden" },
            ]}
            onChange={(value) => set({ previewsHidden: value === "hidden" })}
          />
        </Row>
        <Row label="Text size">
          <Segmented
            label="Text size"
            value={settings.textSize}
            options={[
              { value: "default", label: "Default" },
              { value: "large", label: "Large" },
              { value: "ax", label: "AX" },
            ]}
            onChange={(textSize) => set({ textSize })}
          />
        </Row>
        <Row label="Width">
          <Segmented
            label="Width"
            value={settings.width}
            options={widthOptions(settings.platform)}
            onChange={(width) => set({ width })}
          />
        </Row>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The preview well at a window's size, as it holds a phone: tinted, hairline, the phone on an even 16px mat,
 * scrolling where the well is too short for the phone's smallest scale (pass the phone `WELL_FIT`).
 */
export function Well({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  return (
    <div
      style={{ width, height }}
      className={cn("shrink-0 overflow-y-auto overscroll-contain rounded-xl border border-hairline bg-surface-tinted", className)}
    >
      <div className="h-full p-4">{children}</div>
    </div>
  );
}

/** The phone in the well: 40px stay under it when the well scrolls, as in the preview (preview/well.ts). */
export const WELL_FIT: PhoneFit = { room: 40 };
