"use client";

import type { CSSProperties, ReactNode } from "react";
import { m, type HTMLMotionProps } from "motion/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppMark } from "../app-mark";
import { pt } from "../geometry";
import type { DeviceTextSize, PushContent, PushScreen } from "../types";
import { androidText } from "./type";

/**
 * How many lines Android gives each field, per screen. The OS cuts the text on screen; these clamps are
 * where. Collapsed (lock screen, heads-up): one line of title, one of text. Expanded in the shade (the
 * long-text style): one line of title, about eight of text. Android never shows a subtitle.
 */
export const ANDROID_LINES: Record<PushScreen, { title: number; subtitle: number; body: number }> = {
  lock: { title: 1, subtitle: 0, body: 1 },
  banner: { title: 1, subtitle: 0, body: 1 },
  expanded: { title: 1, subtitle: 0, body: 8 },
};

/** What Android shows in place of the text when the lock screen hides sensitive content. */
export const ANDROID_HIDDEN_BODY = "Contents hidden";

const ICON = 40;

function clamp(lines: number): CSSProperties {
  return { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden" };
}

/**
 * A line across both of the text grid's columns (title or app name, then the time). Its own width mustn't
 * size the columns, or a long body would widen the time's column and squeeze the title: inline-size
 * containment makes it contribute none, and it still stretches across both.
 */
const SPAN: CSSProperties = { gridColumn: "1 / -1", contain: "inline-size" };

/**
 * One Android notification. Collapsed (lock screen, heads-up): the app's round icon, the title with the time
 * after it, one line of text, and the expand chip. Expanded: a header with the app's name and the time, then
 * the title and the long text. With previews hidden on the lock screen, Android still shows the app, its
 * name and the **title**, and replaces only the text with "Contents hidden": the title is what a bystander
 * reads. It reads app, title, text, time (the time is last in the DOM and placed by the grid).
 */
export function AndroidNotification({
  content,
  screen,
  textSize,
  previewsHidden = false,
  onToggle,
  motion,
  background,
  corners,
  shadow = false,
  className,
}: {
  content: PushContent;
  screen: PushScreen;
  textSize: DeviceTextSize;
  /** The lock screen's "hide sensitive content": the text gives way to "Contents hidden". */
  previewsHidden?: boolean;
  onToggle?: () => void;
  motion: Pick<HTMLMotionProps<"div">, "initial" | "animate" | "transition">;
  /** The card's fill, a token. */
  background: string;
  /** The card's border-radius, in points per corner (Material groups cards with tight inner corners). */
  corners: readonly [number, number, number, number];
  shadow?: boolean;
  className?: string;
}) {
  const lines = ANDROID_LINES[screen];
  const expanded = screen === "expanded";
  // The expanded view and a hidden preview name the app in a header row; a collapsed card doesn't.
  const header = expanded || previewsHidden;
  const title = androidText("title", textSize);
  const body = androidText("body", textSize);
  const label = androidText(header ? "label" : "body", textSize);

  const text: ReactNode = (
    <span
      className="grid min-w-0 content-center"
      style={{ gridTemplateColumns: "minmax(0, max-content) auto", columnGap: pt(4), rowGap: header ? pt(2) : 0 }}
    >
      {header ? (
        <span style={{ ...label, ...clamp(1), gridColumn: 1, gridRow: 1 }} className="text-(--device-m3-on-surface-variant)">
          {content.appName}
        </span>
      ) : null}
      <span
        data-field="title"
        data-max-lines={lines.title}
        style={{ ...title, ...clamp(lines.title), ...(header ? SPAN : { gridColumn: 1 }), gridRow: header ? 2 : 1 }}
        className="font-medium text-(--device-m3-on-surface)"
      >
        {content.title}
      </span>
      {previewsHidden ? (
        <span style={{ ...body, ...clamp(1), ...SPAN, gridRow: 3 }} className="text-(--device-m3-on-surface-variant)">
          {ANDROID_HIDDEN_BODY}
        </span>
      ) : (
        <span
          data-field="body"
          data-max-lines={lines.body}
          style={{ ...body, ...clamp(lines.body), ...SPAN, gridRow: header ? 3 : 2 }}
          className="text-(--device-m3-on-surface-variant)"
        >
          {content.body}
        </span>
      )}
      <span
        style={{ ...label, gridColumn: 2, gridRow: 1, alignSelf: "center" }}
        className="whitespace-nowrap text-(--device-m3-on-surface-variant) tabular-nums"
      >
        <span aria-hidden>• </span>
        {content.time}
      </span>
    </span>
  );

  const shell = {
    "data-slot": "notification",
    "data-screen": screen,
    style: {
      background,
      borderRadius: corners.map(pt).join(" "),
      padding: `${pt(14)} ${pt(12)} ${pt(14)} ${pt(16)}`,
      gridTemplateColumns: `${pt(ICON)} minmax(0, 1fr) auto`,
      columnGap: pt(12),
      boxShadow: shadow ? `0 ${pt(6)} ${pt(18)} ${pt(-4)} var(--device-m3-shadow)` : undefined,
    } satisfies CSSProperties,
    className: cn("grid w-full text-left whitespace-pre-wrap [overflow-wrap:anywhere]", className),
    ...motion,
  };

  const cells = (
    <>
      <span className="flex" style={{ alignSelf: header ? "start" : "center" }}>
        <AppMark mark={content.appMark} size={ICON} corner={0.5} label={header ? undefined : content.appName} />
      </span>
      {text}
      <span
        aria-hidden
        className="grid place-items-center self-start rounded-full bg-(--device-m3-surface-container-highest) text-(--device-m3-on-surface-variant)"
        style={{ width: pt(28), height: pt(24), marginTop: header ? 0 : pt(8) }}
      >
        {expanded ? (
          <ChevronUp strokeWidth={2.2} style={{ width: pt(16), height: pt(16) }} />
        ) : (
          <ChevronDown strokeWidth={2.2} style={{ width: pt(16), height: pt(16) }} />
        )}
      </span>
    </>
  );

  return onToggle ? (
    <m.button type="button" aria-expanded={expanded} onClick={onToggle} {...shell}>
      {cells}
    </m.button>
  ) : (
    <m.div {...shell}>{cells}</m.div>
  );
}
