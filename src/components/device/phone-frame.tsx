import type { CSSProperties, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import { deviceFontVariables } from "./fonts";
import { BEZEL, BEZEL_WIDTH, SCREEN_SIZES, frameWidth, pt } from "./geometry";
import type { DeviceAppearance, DevicePlatform, DeviceWidth } from "./types";

// One generic frame for every platform: a slab with a metal rim, a black glass edge and a camera cutout.
// No maker's bezel, buttons or logo. The preview is a <figure> named by its caption; the frame itself is
// decoration.
//
// Geometry. The figure is a size container that fills its parent (give the parent a height). The phone is
// exactly its platform's width in points, and `--pt` is how many CSS px one point is: 1px while the phone
// fits, less when it doesn't, so it shrinks evenly and wraps text the same at any scale. Its height is the
// container's, up to the real screen's: like Web → Mobile, the frame is a window as tall as the preview
// well, and the screen's content is anchored to its top.

/** The camera cutout per platform: iOS's pill, Android's punch hole. Width and height in points. */
const CUTOUT: Record<DevicePlatform, { width: number; height: number; top: number }> = {
  ios: { width: 124, height: 36, top: 11 },
  android: { width: 22, height: 22, top: 12 },
};

/** The width a status bar keeps clear for the camera, in points. */
export function cutoutWidth(platform: DevicePlatform): number {
  return platform === "ios" ? CUTOUT.ios.width + 8 : CUTOUT.android.width + 8;
}

export function PhoneFrame({
  ref,
  platform,
  width,
  appearance,
  caption,
  children,
  className,
}: {
  ref?: Ref<HTMLElement>;
  platform: DevicePlatform;
  width: DeviceWidth;
  appearance: DeviceAppearance;
  /** The figure's accessible name, e.g. "Lock screen, iOS-style preview". */
  caption: string;
  children: ReactNode;
  className?: string;
}) {
  const size = SCREEN_SIZES[platform][width];
  const total = frameWidth(size);
  const cutout = CUTOUT[platform];
  return (
    <figure
      ref={ref}
      data-device={platform}
      data-appearance={appearance}
      data-width={width}
      className={cn(deviceFontVariables, "@container/device m-0 flex h-full w-full min-w-0 justify-center", className)}
    >
      <figcaption className="sr-only">{caption}</figcaption>
      <div
        data-slot="device-frame"
        style={
          {
            "--pt": `min(1px, calc(100cqw / ${total}))`,
            width: pt(total),
            maxHeight: pt(size.height + 2 * BEZEL_WIDTH),
            padding: pt(BEZEL.rim),
            borderRadius: pt(size.radius + BEZEL_WIDTH),
            boxShadow: `inset 0 0 0 ${pt(0.75)} var(--device-rim-edge)`,
          } as CSSProperties
        }
        className="h-full shrink-0 bg-(--device-rim)"
      >
        <div
          style={{ padding: pt(BEZEL.glass), borderRadius: pt(size.radius + BEZEL.glass) }}
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
    </figure>
  );
}
