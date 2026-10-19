import type { ComponentType, ReactNode } from "react";
import { Component } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreativeArcDecoration } from "./creative-arc";
import { CropMarksDecoration } from "./crop-marks";
import { HybridDecoration } from "./hybrid";
import { HybridStackDecoration } from "./hybrid-stack";
import { HybridV2Decoration } from "./hybrid-v2";
import type { DecorationProps, StencilLogoSize } from "./sketch";
import { StackV2Decoration } from "./stack-v2";
import { TemplateStackDecoration } from "./template-stack";
import { UltimateDecoration } from "./ultimate";
import { UltimateV2Decoration } from "./ultimate-v2";
import { UnderlineDecoration } from "./underline";

export type { StencilLogoSize } from "./sketch";

/** "none" is the logo as it was. Each other variant is one decoration, in its own file. */
export const STENCIL_LOGO_VARIANTS = [
  "none",
  "arc",
  "stack",
  "hybrid",
  "hybrid-stack",
  "ultimate",
  "stack-v2",
  "hybrid-v2",
  "ultimate-v2",
  "underline",
  "crop",
] as const;
export type StencilLogoVariant = (typeof STENCIL_LOGO_VARIANTS)[number];

const DECORATIONS: Record<
  Exclude<StencilLogoVariant, "none">,
  ComponentType<DecorationProps>
> = {
  arc: CreativeArcDecoration,
  stack: TemplateStackDecoration,
  hybrid: HybridDecoration,
  "hybrid-stack": HybridStackDecoration,
  ultimate: UltimateDecoration,
  "stack-v2": StackV2Decoration,
  "hybrid-v2": HybridV2Decoration,
  "ultimate-v2": UltimateV2Decoration,
  underline: UnderlineDecoration,
  crop: CropMarksDecoration,
};

/** The lockup's font-size, which is the mark's side: 32px in the sidebar, 80px on a page of its own. */
const SIZE: Record<StencilLogoSize, string> = {
  nav: "text-[2rem]",
  hero: "text-[5rem]",
};

/**
 * `--logo-fan` goes from 0 to 1 while the logo is hovered, or the link around it is hovered or focused from the
 * keyboard, and each stacked sheet reads it to swing out (`fan` in page-stack.tsx). It is registered as a number
 * in globals.css, so it animates. A transform never moves layout, and reduced motion makes the swing instant.
 */
const FAN =
  "[--logo-fan:0] transition-[--logo-fan] duration-(--dur-slow) ease-(--ease-out-soft) hover:[--logo-fan:1] [a:hover_&]:[--logo-fan:1] [a:focus-visible_&]:[--logo-fan:1]";

export interface StencilLogoProps {
  variant?: StencilLogoVariant;
  size?: StencilLogoSize;
  className?: string;
}

/** The product's logo: the mark, the wordmark, and the variant's decoration. */
export function StencilLogo({
  variant = "none",
  size = "nav",
  className,
}: StencilLogoProps) {
  const Decoration = variant === "none" ? null : DECORATIONS[variant];
  return (
    <LogoLockup size={size} className={className}>
      {Decoration && <Decoration size={size} />}
    </LogoLockup>
  );
}

/**
 * The mark and the wordmark, with any decoration as `children`. One font-size sets the lockup: the mark is 1em
 * square, the wordmark 0.6875em (22px beside a 32px mark), the gap 0.375em, and every decoration is placed in
 * em. The box is the mark and the wordmark only; decorations are absolute, so they never move the layout, and
 * `isolate` keeps a decoration drawn behind the mark above whatever the lockup sits on.
 */
export function LogoLockup({
  size,
  className,
  children,
}: {
  size: StencilLogoSize;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      data-slot="stencil-logo"
      className={cn(
        "relative isolate inline-flex shrink-0 items-center gap-[0.375em] leading-none",
        FAN,
        SIZE[size],
        className,
      )}
    >
      <LogoMark />
      <span
        data-slot="stencil-wordmark"
        className="relative font-display text-[0.6875em] leading-none tracking-[-0.01em] text-text"
      >
        Stencil
      </span>
      {children}
    </span>
  );
}

/**
 * The product's mark: a 1em tile. It stands in for TD's crest, which isn't in the repo yet. When it is, render
 * the crest's image here at `size-[1em]`, with `alt=""` (the link around the logo names it): the decorations
 * are placed against this square, so none of them change.
 */
function LogoMark() {
  return (
    <span className="relative grid size-[1em] shrink-0 place-items-center rounded-[0.25em] bg-primary text-primary-foreground">
      <Component aria-hidden strokeWidth={1.75} className="size-[0.5625em]" />
    </span>
  );
}
