"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId, type ReactNode } from "react";
import {
  SCREEN_SIZES,
  SIZE_UNIT,
  pushScreenLabel,
  type DevicePlatform,
  type DeviceSettings,
  type DeviceWidth,
  type PushScreen,
} from "@/components/device";
import { Segmented } from "@/components/primitives/segmented";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PUSH_PLATFORMS } from "@/domain/messages/push";
import { PLATFORM_LABELS } from "@/domain/render/errors";
import { cn } from "@/lib/utils";

// The right slot of the controls row on Push and SMS: which phone (iPhone · Android), and a 32px
// Device button whose popover sets the rest: the screen a push is on, the phone's appearance, its
// previews setting, its text size and its width. Settled on the phone kit's design page at the
// tightest well (469px). A row that doesn't apply to what is on screen stays in place, greyed, with
// why under it ("Push only"), and does nothing. The popover's geometry is the same in every state: the
// reason sits in the gap under its control, out of flow, so picking Banner (which blocks Previews) moves
// no row under the pointer, and Push and SMS open the same popover.

/** The gap between rows: room for a reason's 16px line under its control, nearer it than the next row. The last row is never blocked. */
const ROW_GAP = "gap-6";

const SCREENS: readonly PushScreen[] = ["lock", "banner", "expanded"];
const WIDTHS: readonly DeviceWidth[] = ["compact", "standard", "large"];

/** The screens in the platform's words: Banner on iPhone, Heads-up on Android. */
function screenOptions(platform: DevicePlatform) {
  return SCREENS.map((value) => ({ value, label: pushScreenLabel(platform, value) }));
}

/** The widths in the platform's own sizes: 375pt · 402pt · 440pt, or 360dp · 412dp · 448dp. */
function widthOptions(platform: DevicePlatform) {
  return WIDTHS.map((value) => ({ value, label: `${SCREEN_SIZES[platform][value].width}${SIZE_UNIT[platform]}` }));
}

export interface PhoneView {
  settings: DeviceSettings;
  /** The screen a push is on. */
  screen: PushScreen;
}

/** iPhone · Android, then the Device options. */
export function PhoneControls({
  channel,
  view,
  onChange,
}: {
  channel: "push" | "sms";
  view: PhoneView;
  onChange: (next: Partial<PhoneView>) => void;
}) {
  const set = (patch: Partial<DeviceSettings>) => onChange({ settings: { ...view.settings, ...patch } });
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Segmented
        label="Phone"
        value={view.settings.platform}
        options={PUSH_PLATFORMS.map((value) => ({ value, label: PLATFORM_LABELS[value] }))}
        onChange={(platform) => set({ platform })}
      />
      <DeviceOptions channel={channel} view={view} onChange={onChange} />
    </div>
  );
}

/** The 32px Device button and its popover. */
function DeviceOptions({
  channel,
  view,
  onChange,
}: {
  channel: "push" | "sms";
  view: PhoneView;
  onChange: (next: Partial<PhoneView>) => void;
}) {
  const { settings, screen } = view;
  const set = (patch: Partial<DeviceSettings>) => onChange({ settings: { ...settings, ...patch } });
  const sms = channel === "sms";
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
        aria-label="Device options"
        className={cn("w-auto rounded-xl border border-hairline bg-popover p-3 shadow-pop ring-0", ROW_GAP)}
      >
        <Row label="Screen" blocked={sms ? "Push only" : null}>
          {(blocked) => (
            <Segmented label="Screen" value={screen} options={screenOptions(settings.platform)} onChange={blocked((next) => onChange({ screen: next }))} />
          )}
        </Row>
        <Row label="Appearance">
          {() => (
            <Segmented
              label="Appearance"
              value={settings.appearance}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(appearance) => set({ appearance })}
            />
          )}
        </Row>
        <Row label="Previews" blocked={sms || screen !== "lock" ? "Lock screen only" : null}>
          {(blocked) => (
            <Segmented
              label="Previews"
              value={settings.previewsHidden ? "hidden" : "shown"}
              options={[
                { value: "shown", label: "Shown" },
                { value: "hidden", label: "Hidden" },
              ]}
              onChange={blocked((value) => set({ previewsHidden: value === "hidden" }))}
            />
          )}
        </Row>
        <Row label="Text size">
          {() => (
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
          )}
        </Row>
        <Row label="Width">
          {() => (
            <Segmented label="Width" value={settings.width} options={widthOptions(settings.platform)} onChange={(width) => set({ width })} />
          )}
        </Row>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One labelled row of the popover. `blocked` keeps the control where it is, greyed and still
 * focusable, with the reason under it as its description; the control's changes are dropped
 * (`children` gets a wrapper that does that).
 */
function Row({
  label,
  blocked = null,
  children,
}: {
  label: string;
  blocked?: string | null;
  children: (blocked: <T>(onChange: (value: T) => void) => (value: T) => void) => ReactNode;
}) {
  const reasonId = useId();
  const guard = <T,>(onChange: (value: T) => void) => (blocked ? () => {} : onChange);
  return (
    <div className="grid grid-cols-[5.5rem_auto] items-center gap-x-3">
      <span className="text-[13px] leading-5 text-text-muted">{label}</span>
      <div className="relative w-fit">
        <div
          role="group"
          aria-disabled={blocked ? true : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          className={cn("w-fit", blocked && "opacity-50 [&_button]:cursor-default [&_button]:hover:bg-transparent [&_button[aria-pressed=true]]:hover:bg-selected")}
        >
          {children(guard)}
        </div>
        {/* Out of flow, in the gap under the control (ROW_GAP), so a row that turns blocked moves nothing. */}
        {blocked ? (
          <span id={reasonId} data-slot="row-reason" className="absolute top-full left-0 mt-0.5 text-[12px] leading-4 whitespace-nowrap text-text-subtle">
            {blocked}
          </span>
        ) : null}
      </div>
    </div>
  );
}
