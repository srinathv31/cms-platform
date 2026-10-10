"use client";

import { PhoneFrame } from "./phone-frame";
import type { DeviceSettings, PhoneFit } from "./types";

/**
 * A phone with nothing on its screen yet, for a loading state: the frame itself, at the size and in the
 * place of the phone that replaces it, with a quiet pulse on the screen. Decoration, hidden from
 * assistive tech.
 */
export function PhoneSkeleton({
  settings,
  fit,
  className,
}: {
  settings: Pick<DeviceSettings, "platform" | "width" | "appearance">;
  fit?: PhoneFit;
  className?: string;
}) {
  return (
    <PhoneFrame platform={settings.platform} width={settings.width} appearance={settings.appearance} caption={null} fit={fit} className={className}>
      <div data-slot="skeleton" className="absolute inset-0 animate-pulse bg-(--device-bg)" />
    </PhoneFrame>
  );
}
