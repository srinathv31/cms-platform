import type { ReactNode, Ref } from "react";
import { ScaledBox } from "@/components/primitives/scaled-viewport";
import { cn } from "@/lib/utils";
import { deviceFontVariables } from "./fonts";
import { BEZEL, SCREEN_SIZES, bezelWidth, frameSize, phoneScale, pt } from "./geometry";
import type { DeviceAppearance, DevicePlatform, DeviceWidth, PhoneFit } from "./types";

// One generic frame for every platform: a slab with a metal rim, a black glass edge and a camera cutout.
// No maker's bezel, buttons or logo. The preview is a <figure> named by its caption; the frame itself is
// decoration.
//
// Geometry. The figure fills its parent (give the parent a height). Inside it, the phone is laid out at
// its real size, one point to one CSS px, and scaled with a transform to fit the figure (`phoneScale`):
// the whole phone shows, in its true proportions, centred across the figure and at its top. Its scaled
// size is reserved in the layout, so nothing overlaps it. A figure shorter than the minimum scale allows
// holds that scale and the phone runs past its bottom, for a scroller round it to scroll.

/** The camera cutout per platform: iOS's Dynamic Island, Android's punch hole. Width and height in points. */
const CUTOUT: Record<DevicePlatform, { width: number; height: number; top: number }> = {
  ios: { width: 126, height: 37, top: 11 },
  android: { width: 22, height: 22, top: 12 },
};

/** The width a status bar keeps clear for the camera, in points. */
export function cutoutWidth(platform: DevicePlatform): number {
  return CUTOUT[platform].width + 8;
}

export function PhoneFrame({
  ref,
  platform,
  width,
  appearance,
  caption,
  fit,
  children,
  className,
}: {
  ref?: Ref<HTMLElement>;
  platform: DevicePlatform;
  width: DeviceWidth;
  appearance: DeviceAppearance;
  /** The figure's accessible name, e.g. "Lock screen, iOS-style preview". Null: decoration (a skeleton), hidden. */
  caption: string | null;
  fit?: PhoneFit;
  children: ReactNode;
  className?: string;
}) {
  const size = SCREEN_SIZES[platform][width];
  const frame = frameSize(platform, width);
  const bezel = BEZEL[platform];
  const cutout = CUTOUT[platform];
  const minScale = fit?.minScale;
  return (
    <figure
      ref={ref}
      data-device={platform}
      data-appearance={appearance}
      data-width={width}
      aria-hidden={caption === null || undefined}
      className={cn(deviceFontVariables, "m-0 h-full w-full min-w-0", className)}
    >
      {caption === null ? null : <figcaption className="sr-only">{caption}</figcaption>}
      <ScaledBox
        width={frame.width}
        height={frame.height}
        scale={(box) => phoneScale(box, platform, width, minScale)}
        room={fit?.room}
        className="h-full w-full"
      >
        <div
          data-slot="device-frame"
          style={{
            width: frame.width,
            height: frame.height,
            padding: pt(bezel.rim),
            borderRadius: pt(size.radius + bezelWidth(platform)),
            boxShadow: `inset 0 0 0 ${pt(0.75)} var(--device-rim-edge)`,
          }}
          className="bg-(--device-rim)"
        >
          <div
            style={{ padding: pt(bezel.glass), borderRadius: pt(size.radius + bezel.glass) }}
            className="h-full bg-(--device-bezel)"
          >
            {/* Clipped with clip-path, not just overflow: Chrome lets a composited backdrop-filter (the expanded
                view's blur) escape an overflow clip's rounded corners. The clip also makes the screen the glass's
                Backdrop Root, so a fading wrapper outside the kit can't take the wallpaper out of its blur. */}
            <div
              data-slot="device-screen"
              style={{
                borderRadius: pt(size.radius),
                clipPath: `inset(0 round ${pt(size.radius)})`,
                fontFamily: `var(--font-device-${platform})`,
              }}
              className="relative isolate h-full overflow-hidden bg-(--device-screen) text-(--device-label)"
            >
              {children}
              <span
                aria-hidden
                data-slot="device-cutout"
                style={{ width: pt(cutout.width), height: pt(cutout.height), top: pt(cutout.top) }}
                className="pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 rounded-full bg-(--device-island)"
              />
            </div>
          </div>
        </div>
      </ScaledBox>
    </figure>
  );
}
