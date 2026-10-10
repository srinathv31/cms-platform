"use client";

import type { CSSProperties, ReactNode } from "react";
import { m, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";
import { AppMark } from "../app-mark";
import { pt } from "../geometry";
import type { DeviceTextSize, PushContent, PushScreen } from "../types";
import { glass } from "./glass";
import { textStyle } from "./type";

/**
 * How many lines iOS gives each field, per screen. The text is never shortened: the OS cuts it on screen,
 * and these clamps are where. Lock screen: title 1, body 4. Banner: body 2. Expanded (long press): about 7.
 */
export const IOS_LINES: Record<PushScreen, { title: number; subtitle: number; body: number }> = {
  lock: { title: 1, subtitle: 1, body: 4 },
  banner: { title: 1, subtitle: 1, body: 2 },
  expanded: { title: 2, subtitle: 2, body: 7 },
};

/** What "Show previews: When unlocked" puts in place of the content on a locked phone. */
export const HIDDEN_PREVIEW_BODY = "Notification";

/** A box that shows `lines` lines at most and ends the last with an ellipsis. */
function clamp(lines: number): CSSProperties {
  return { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden" };
}

const ICON = 38;

/**
 * One iOS notification: the app's mark, then the title, the subtitle, the body and the time, read in that
 * order (the time is last in the DOM and placed top right by the grid). At accessibility text sizes the
 * mark moves above the text, as iOS does. With `onToggle` the card is a button that expands and collapses
 * it, as a long press does on the phone.
 */
export function NotificationCard({
  content,
  screen,
  textSize,
  previewsHidden = false,
  onToggle,
  motion,
  className,
}: {
  content: PushContent;
  screen: PushScreen;
  textSize: DeviceTextSize;
  /** Show the app and "Notification" instead of the content. */
  previewsHidden?: boolean;
  onToggle?: () => void;
  /** How the card arrives: the view's fade-rise, or the banner's drop. */
  motion: Pick<HTMLMotionProps<"div">, "initial" | "animate" | "transition">;
  className?: string;
}) {
  const lines = IOS_LINES[screen];
  const stacked = textSize === "ax";
  const subtitle = content.subtitle?.trim() ? content.subtitle : null;
  const text = textStyle("subheadline", textSize);
  const time = textStyle("footnote", textSize);

  const cells: ReactNode = (
    <>
      <span
        style={stacked ? { gridColumn: 1, gridRow: 1 } : { gridColumn: 1, gridRow: "1 / span 3", alignSelf: screen === "expanded" ? "start" : "center" }}
        className="flex"
      >
        <AppMark mark={content.appMark} size={ICON} corner={0.2237} label={content.appName} />
      </span>
      {previewsHidden ? (
        <>
          <span style={{ ...text, ...clamp(1), ...titleCell(stacked) }} className="font-semibold">
            {content.appName}
          </span>
          <span style={{ ...text, ...clamp(1), ...bodyCell(stacked) }}>{HIDDEN_PREVIEW_BODY}</span>
        </>
      ) : (
        <>
          <span
            data-field="title"
            data-max-lines={lines.title}
            style={{ ...text, ...clamp(lines.title), ...titleCell(stacked) }}
            className="font-semibold"
          >
            {content.title}
          </span>
          {subtitle ? (
            <span
              data-field="subtitle"
              data-max-lines={lines.subtitle}
              style={{ ...text, ...clamp(lines.subtitle), gridColumn: stacked ? "1 / -1" : "2 / -1", gridRow: stacked ? 3 : 2 }}
              className="font-semibold"
            >
              {subtitle}
            </span>
          ) : null}
          <span data-field="body" data-max-lines={lines.body} style={{ ...text, ...clamp(lines.body), ...bodyCell(stacked) }}>
            {content.body}
          </span>
        </>
      )}
      <span
        style={{
          ...time,
          lineHeight: stacked ? time.lineHeight : text.lineHeight,
          gridColumn: 3,
          gridRow: 1,
          alignSelf: stacked ? "center" : "start",
          paddingLeft: pt(8),
        }}
        className="justify-self-end whitespace-nowrap text-(--device-glass-ink-2) tabular-nums"
      >
        {content.time}
      </span>
    </>
  );

  const shell = {
    "data-slot": "notification",
    "data-screen": screen,
    style: {
      ...glass(screen === "lock" ? "regular" : "strong", { shadow: screen === "banner" }),
      borderRadius: pt(screen === "expanded" ? 28 : 24),
      padding: `${pt(13)} ${pt(16)} ${pt(14)} ${pt(14)}`,
      gridTemplateColumns: `${pt(ICON)} minmax(0, 1fr) auto`,
      columnGap: pt(10),
    } satisfies CSSProperties,
    className: cn(
      "grid w-full content-center text-left whitespace-pre-wrap text-(--device-glass-ink) [overflow-wrap:anywhere]",
      className,
    ),
    ...motion,
  };

  return onToggle ? (
    <m.button type="button" aria-expanded={screen === "expanded"} onClick={onToggle} {...shell}>
      {cells}
    </m.button>
  ) : (
    <m.div {...shell}>{cells}</m.div>
  );
}

function titleCell(stacked: boolean): CSSProperties {
  return stacked ? { gridColumn: "1 / -1", gridRow: 2, marginTop: pt(8) } : { gridColumn: 2, gridRow: 1 };
}

function bodyCell(stacked: boolean): CSSProperties {
  return stacked ? { gridColumn: "1 / -1", gridRow: 4 } : { gridColumn: "2 / -1", gridRow: 3 };
}
