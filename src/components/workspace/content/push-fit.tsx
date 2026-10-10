"use client";

import { useState } from "react";
import { PushPreview, SCREEN_SIZES, frameWidth, type DeviceSettings, type PushContent, type PushMeasure } from "@/components/device";
import { PUSH_PLATFORMS, type PushPlatform } from "@/domain/messages/push";
import type { LockScreenFit } from "@/domain/messages/truncation";

// Where each phone's lock screen cuts the push, measured from the phone kit itself, so a warning in the
// composer says exactly what that phone draws. Two phones the author never sees, one per platform, sit
// off screen (aria-hidden, inert, invisible but laid out), always at the lock screen, the standard
// width and the default text size, whatever the preview shows and whether or not it is open.
//
// Each one's `onMeasure` reports how its fields fit whenever that changes. It reports from a layout
// effect, so a new text and its measurement reach the screen in the same paint; a text that changes
// nothing on screen (typing past where the body is cut) reports nothing, and the last fit still holds.

/** The phone the warnings are measured on: the most common one, not the preview's choice. */
const MEASURED: Omit<DeviceSettings, "platform"> = {
  appearance: "light",
  previewsHidden: false,
  textSize: "default",
  width: "standard",
};

/** The lock screens' fit for `content` (null: nothing to measure), and the hidden phones that measure it. */
export function usePushFit(content: PushContent | null): { fits: LockScreenFit[]; probe: React.ReactNode } {
  const [measured, setMeasured] = useState<Partial<Record<PushPlatform, PushMeasure>>>({});

  const fits = content
    ? PUSH_PLATFORMS.flatMap((platform) => {
        const fit = measured[platform];
        return fit ? [{ platform, title: fit.title, subtitle: fit.subtitle, body: fit.body }] : [];
      })
    : [];

  const probe = content ? (
    <div aria-hidden inert data-slot="push-fit" className="pointer-events-none invisible fixed top-0 left-[-10000px]">
      {PUSH_PLATFORMS.map((platform) => {
        const size = SCREEN_SIZES[platform].standard;
        return (
          <div key={platform} style={{ width: frameWidth(size), height: size.height }}>
            <PushPreview
              settings={{ platform, ...MEASURED }}
              screen="lock"
              content={content}
              onMeasure={(measure) => setMeasured((all) => ({ ...all, [platform]: measure }))}
            />
          </div>
        );
      })}
    </div>
  ) : null;

  return { fits, probe };
}
