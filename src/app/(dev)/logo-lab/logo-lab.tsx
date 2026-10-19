"use client";

import { useState, type ReactNode } from "react";
import { HomeLink } from "@/components/app-shell/home-link";
import { TeamSwitcherSkeleton } from "@/components/app-shell/skeletons";
import { CreativeArcDecoration } from "@/components/brand/creative-arc";
import {
  LogoLockup,
  STENCIL_LOGO_VARIANTS,
  StencilLogo,
  type StencilLogoVariant,
} from "@/components/brand/stencil-logo";
import { PageHeader } from "@/components/primitives/page-header";
import { Segmented } from "@/components/primitives/segmented";
import { SidebarHeader } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const ABOUT: Record<StencilLogoVariant, { name: string; note: string }> = {
  none: { name: "None", note: "The logo as it is today." },
  arc: {
    name: "1 · Creative Arc",
    note: "A pen line from the mark's corner over the wordmark, ending at a nib.",
  },
  stack: {
    name: "2 · Template Stack",
    note: "Sheets stacked behind the mark, the front one dog-eared, one tinted.",
  },
  hybrid: {
    name: "3 · Hybrid",
    note: "A compact stack, and a finer line that leaves from the dog-ear.",
  },
  "hybrid-stack": {
    name: "3b · Hybrid Stack",
    note: "Hybrid with Template Stack's sheets: tinted, three at hero, fanned.",
  },
  ultimate: {
    name: "3c · Ultimate",
    note: "Hybrid Stack with Underline's stroke under the wordmark.",
  },
  "stack-v2": {
    name: "2 v2 · Template Stack v2",
    note: "A used stack: hand-ruled, fanned at rest, dog-eared at the back, washed.",
  },
  "hybrid-v2": {
    name: "3 v2 · Hybrid v2",
    note: "The used stack, and a brushed pen line from its dog-ear.",
  },
  "ultimate-v2": {
    name: "3c v2 · Ultimate v2",
    note: "Hybrid v2 over a brushed underline.",
  },
  underline: {
    name: "Extra · Underline",
    note: "One pen stroke under the wordmark, the mark an editor makes.",
  },
  crop: {
    name: "Extra · Crop marks",
    note: "Printer's crop marks at the mark's corners: documents made to spec.",
  },
};

const ARC_VARIATIONS = [
  { name: "Nib, from the mark", tool: "nib", from: "crest" },
  { name: "Pencil, from the mark", tool: "pencil", from: "crest" },
  { name: "Nib, from the wordmark", tool: "nib", from: "wordmark" },
  { name: "Pencil, from the wordmark", tool: "pencil", from: "wordmark" },
] as const;

type Face = "newsreader" | "fallback";
type Boxes = "off" | "on";
type Fan = "rest" | "fanned";

/**
 * Every variant in the sidebar's real header (`HomeLink` over the team switcher's skeleton, on the sidebar's
 * stone), then each at nav and hero size on the canvas. "Fallback face" sets the wordmark in Georgia, which is
 * what shows before Newsreader loads: the decorations must follow the wider word. "Boxes" outlines the lockup and
 * each decoration layer. "Fanned" holds every stack where hover takes it; hovering a logo shows the animation.
 */
export function LogoLab() {
  const [face, setFace] = useState<Face>("newsreader");
  const [boxes, setBoxes] = useState<Boxes>("off");
  const [fan, setFan] = useState<Fan>("rest");

  return (
    <main
      className={cn(
        "min-h-svh bg-app px-8 py-10",
        face === "fallback" &&
          "[&_[data-slot=stencil-wordmark]]:font-[Georgia,serif]",
        boxes === "on" &&
          "[&_[data-slot=logo-decoration]]:outline-1 [&_[data-slot=logo-decoration]]:outline-warning [&_[data-slot=logo-decoration]]:outline-dashed [&_[data-slot=stencil-logo]]:outline-1 [&_[data-slot=stencil-logo]]:outline-brand [&_[data-slot=stencil-logo]]:outline-solid",
        fan === "fanned" && "[&_[data-slot=stencil-logo]]:[--logo-fan:1]",
      )}
    >
      <div className="mx-auto flex max-w-[96rem] flex-col gap-12">
        <PageHeader
          eyebrow="Dev lab"
          title="Logo lab"
          action={
            <div className="flex gap-3">
              <Segmented
                label="Wordmark face"
                value={face}
                onChange={setFace}
                options={[
                  { value: "newsreader", label: "Newsreader" },
                  { value: "fallback", label: "Fallback face" },
                ]}
              />
              <Segmented
                label="Stack"
                value={fan}
                onChange={setFan}
                options={[
                  { value: "rest", label: "At rest" },
                  { value: "fanned", label: "Fanned" },
                ]}
              />
              <Segmented
                label="Layout boxes"
                value={boxes}
                onChange={setBoxes}
                options={[
                  { value: "off", label: "No boxes" },
                  { value: "on", label: "Boxes" },
                ]}
              />
            </div>
          }
        />

        <Section title="In the sidebar">
          <div className="flex flex-wrap gap-6">
            {STENCIL_LOGO_VARIANTS.map((variant) => (
              <figure key={variant} className="flex flex-col gap-2">
                <div
                  data-testid={`sidebar-${variant}`}
                  className="w-(--sidebar-w) rounded-2xl border border-hairline bg-sidebar"
                >
                  <SidebarHeader className="gap-0 px-3 pt-5 pb-2">
                    <HomeLink variant={variant} />
                    <TeamSwitcherSkeleton />
                  </SidebarHeader>
                </div>
                <figcaption className="text-[13px] text-text-muted">
                  {ABOUT[variant].name}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>

        <Section title="Nav and hero">
          <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-canvas">
            {STENCIL_LOGO_VARIANTS.map((variant) => (
              <Row
                key={variant}
                name={ABOUT[variant].name}
                note={ABOUT[variant].note}
              >
                <Swatch tone="app" testId={`nav-${variant}`}>
                  <StencilLogo variant={variant} size="nav" />
                </Swatch>
                <Swatch tone="canvas" testId={`hero-${variant}`}>
                  <StencilLogo variant={variant} size="hero" />
                </Swatch>
              </Row>
            ))}
          </div>
        </Section>

        <Section title="Arc variations">
          <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-canvas">
            {ARC_VARIATIONS.map((v) => (
              <Row key={v.name} name={v.name}>
                <Swatch tone="app" testId={`arc-nav-${v.tool}-${v.from}`}>
                  <LogoLockup size="nav">
                    <CreativeArcDecoration
                      size="nav"
                      tool={v.tool}
                      from={v.from}
                    />
                  </LogoLockup>
                </Swatch>
                <Swatch tone="canvas" testId={`arc-hero-${v.tool}-${v.from}`}>
                  <LogoLockup size="hero">
                    <CreativeArcDecoration
                      size="hero"
                      tool={v.tool}
                      from={v.from}
                    />
                  </LogoLockup>
                </Swatch>
              </Row>
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="caps-label">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  name,
  note,
  children,
}: {
  name: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[14rem_18rem_1fr] items-center gap-8 px-6 py-8">
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-medium">{name}</span>
        {note && <span className="text-[13px] text-text-muted">{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** Room around the logo for decorations that reach past its box. */
function Swatch({
  tone,
  testId,
  children,
}: {
  tone: "app" | "canvas";
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-center rounded-xl px-16",
        tone === "app" ? "h-28 bg-app" : "h-64 bg-canvas",
      )}
    >
      {children}
    </div>
  );
}
