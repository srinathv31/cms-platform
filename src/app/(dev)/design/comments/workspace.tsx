"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Eye, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TemplateId } from "@/components/primitives/template-id";
import { SaveIndicator } from "@/components/workspace/autosave/save-indicator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TitleField } from "../workspace/header-parts";
import type { TabId, TemplateModel } from "../workspace/types";
import { RailBody } from "../preview/rail-content";
import { RailToggle } from "../preview/tab-bar";
import type { ChannelId } from "../preview/types";
import { RailTabs, CommentsList, type RailView } from "./comments-list";
import { DocFrame } from "./doc-frame";
import { TEMPLATE_NAME, draftModel } from "./fixtures";
import { CloseRail, MARGIN_NEED, MarginColumn, RailStrip } from "./margin-c";
import { useStore } from "./store";
import type { VariantId } from "./types";
import { BlockPopover, ComposePopover, VersionStrip } from "./variant-b";

/*
 * The template workspace with the Rail layout (header, tabs, document, the right rail), drawn the way
 * the Preview mock draws it, and one of three ways to show review comments in it. The main pane is
 * the document: a text column up to 760px with the block handle hanging in its left gutter. Between
 * the text and the rail there is a 40px gutter: that is where A and B hang their markers.
 */

export const RAIL_W = 320;
/** The canvas pad (3rem) plus the handle gutter (1.25rem): where the title, the tabs and the text start. */
const PAD_L = 68;
const GUTTER = 40;
/** 56rem of workspace: the rail's breakpoint (the real grid switches at 53rem of grid width). */
const NARROW_BELOW = 896;
const SPAN = "mx-auto w-full max-w-(--doc-width)";
const RAIL_STRIP =
  "h-full w-80 shrink-0 overflow-y-auto overscroll-contain border-l border-hairline bg-canvas px-3 pt-[17px] pb-14";

function useWidth(ref: React.RefObject<HTMLElement | null>, fallback: number) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

// ── Header and tab bar (as in the Preview mock) ──────────────────

function HeaderBand({ model, onName }: { model: TemplateModel; onName: (name: string) => void }) {
  return (
    <header className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5 pb-6">
      <div className="col-span-2 col-start-1 row-start-1 min-w-0">
        <TitleField model={model} onName={onName} />
      </div>
      <div className="col-start-1 row-start-2 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5 self-end">
        <StatusBadge state={model.status} />
        {model.versionLabel ? <span className="text-[14px] leading-6 text-text-muted">{model.versionLabel}</span> : null}
        <span aria-hidden className="-mx-1.5 text-text-subtle">
          ·
        </span>
        <SaveIndicator status="saved" />
      </div>
      <TemplateId id={model.id} className="col-start-2 row-start-2 ml-8 -mb-0.5 self-end" />
    </header>
  );
}

const TABS: { id: TabId; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "versions", label: "Versions" },
  { id: "usage", label: "Usage" },
  { id: "activity", label: "Activity" },
];

/**
 * The tab bar. In C it also holds the Comments toggle; the Preview button then gives way to its icon
 * a little earlier (a bar under 38rem), so the row still fits the narrower text column.
 */
function TabBar({
  comments,
  railToggle,
}: {
  comments?: { count: number; pressed: boolean; onToggle: () => void };
  /** Below the rail's breakpoint: the button that opens the rail over the document. */
  railToggle?: ReactNode;
}) {
  const [tab, setTab] = useState<TabId>("content");
  return (
    <div className="@container/bar">
      <div className="flex items-start justify-between gap-4 border-b border-hairline bg-canvas">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="min-w-0">
          <TabsList variant="line" className="gap-6 p-0 group-data-horizontal/tabs:h-11 @max-[34rem]/bar:gap-4">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="h-full flex-none px-0 text-[15px] group-data-horizontal/tabs:after:-bottom-px data-active:font-medium"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex h-11 shrink-0 items-center gap-2">
          {railToggle}
          {comments ? (
            <Button
              variant="outline"
              size="lg"
              aria-label="Comments"
              title="Comments"
              aria-pressed={comments.pressed}
              onClick={comments.onToggle}
              className="gap-1.5 px-3 aria-pressed:bg-selected"
            >
              <MessageSquare data-icon="inline-start" strokeWidth={1.75} />
              <span className="tabular-nums">{comments.count}</span>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="lg"
            aria-label="Preview"
            title="Preview"
            className={cn(
              "px-3.5 @max-[34rem]/bar:w-9 @max-[34rem]/bar:px-0",
              comments && "@max-[38rem]/bar:w-9 @max-[38rem]/bar:px-0",
            )}
          >
            <Eye data-icon="inline-start" strokeWidth={1.75} />
            <span className={cn("@max-[34rem]/bar:sr-only", comments && "@max-[38rem]/bar:sr-only")}>Preview</span>
          </Button>
          <Button size="lg" className="px-4" aria-label="Submit for review">
            <span>
              Submit<span className="@max-[28rem]/bar:hidden"> for review</span>
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── The workspace ────────────────────────────────────────────────

export interface WorkspaceProps {
  variant: VariantId;
  doc: ReactNode;
  resolvedOpen: boolean;
  onResolvedOpen: (open: boolean) => void;
}

export function AuthorWorkspace({ variant, doc, resolvedOpen, onResolvedOpen }: WorkspaceProps) {
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref, 1162);
  const [name, setName] = useState(TEMPLATE_NAME);
  const [channels, setChannels] = useState<ChannelId[]>(["pdf", "web"]);
  const model: TemplateModel = { ...draftModel(name, channels), versionLabel: "Based on v1" };

  // Below the rail's breakpoint (a workspace under 56rem) the rail is an overlay behind a toggle, as in
  // the real workspace. There is no room for margin cards either: C falls back to A's list.
  const narrow = W < NARROW_BELOW;
  const v: VariantId = narrow && variant === "c" ? "a" : variant;

  // A: the rail's Comments | Variables switch. It opens on Comments while there is something to do.
  const [railView, setRailView] = useState<RailView>(store.open.length > 0 || store.pending ? "comments" : "variables");
  // C: the margin. And the rail over the page (C's strip opens it; so does the toggle below the breakpoint).
  const [marginOn, setMarginOn] = useState(true);
  const [overlay, setOverlay] = useState(false);
  // Anything that points at a comment (a marker, a quote, a new comment) brings it into view: A's rail
  // switches to Comments (and, narrow, opens), C's margin opens.
  const focusNonce = store.focus?.nonce;
  const [seenNonce, setSeenNonce] = useState(focusNonce);
  if (focusNonce !== seenNonce) {
    setSeenNonce(focusNonce);
    if (v === "a") {
      setRailView("comments");
      if (narrow) setOverlay(true);
    }
    if (v === "c") setMarginOn(true);
  }
  const margin = v === "c" && marginOn;
  const withRail = W - RAIL_W;
  const textFull = Math.min(760, withRail - PAD_L - GUTTER);
  const fits = withRail - PAD_L - textFull >= MARGIN_NEED;
  const folded = margin && !fits;
  const showOverlay = overlay && (narrow || folded);
  useEffect(() => {
    if (!showOverlay) return;
    const onKey = (event: KeyboardEvent) => {
      // A composer or a popover takes its own Escape first.
      if (event.key === "Escape" && !event.defaultPrevented && !store.pending) setOverlay(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showOverlay, store.pending]);

  const padRight = margin ? MARGIN_NEED : GUTTER;
  const pad = { paddingRight: padRight };
  const padClass = "transition-[padding-right] duration-(--dur-base) ease-(--ease-out-soft)";

  const close = <CloseRail onClose={() => setOverlay(false)} />;
  const OVERLAY = "absolute inset-y-0 right-0 z-30 shadow-pop";

  const aRail = (overlaid: boolean) => (
    <aside
      aria-label="Comments and variables"
      data-rail=""
      className={cn(RAIL_STRIP, "px-5", overlaid && OVERLAY)}
    >
      <RailTabs value={railView} onChange={setRailView} count={store.open.length} end={overlaid ? close : undefined} />
      {railView === "comments" ? (
        <CommentsList className="mt-5" resolvedOpen={resolvedOpen} onResolvedOpen={onResolvedOpen} />
      ) : (
        <div className="-mx-2 mt-6">
          <RailBody channels={channels} onChannels={setChannels} />
        </div>
      )}
    </aside>
  );
  const plainRail = (overlaid: boolean) => (
    <aside aria-label="Channels and variables" data-rail="" className={cn(RAIL_STRIP, overlaid && OVERLAY)}>
      <RailBody channels={channels} onChannels={setChannels} closeSlot={overlaid ? close : undefined} />
    </aside>
  );
  const railFor = (overlaid: boolean) => (v === "a" ? aRail(overlaid) : plainRail(overlaid));

  return (
    <div ref={ref} data-workspace="" data-variant={v} data-narrow={narrow ? "" : undefined} className="relative flex min-h-0 flex-1">
      <div data-main="" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <div className={cn("shrink-0 pl-[68px]", padClass)} style={pad}>
          <div className={SPAN}>
            <HeaderBand model={model} onName={setName} />
          </div>
        </div>
        <div className={cn("sticky top-0 z-20 shrink-0 bg-canvas pl-[68px]", padClass)} style={pad}>
          <div className={SPAN}>
            <TabBar
              railToggle={narrow ? <RailToggle open={overlay} onClick={() => setOverlay((o) => !o)} /> : undefined}
              comments={
                v === "c" ? { count: store.open.length, pressed: marginOn, onToggle: () => setMarginOn((on) => !on) } : undefined
              }
            />
          </div>
        </div>
        <div className={cn("pl-[68px]", padClass)} style={pad}>
          <div className="mx-auto max-w-(--doc-width)">
            {v === "a" ? (
              <DocFrame doc={doc} mode="author" markers="button" />
            ) : v === "b" ? (
              <DocFrame
                doc={doc}
                mode="author"
                markers="popover"
                popover={(threads) => <BlockPopover threads={threads} />}
                composePopover={<ComposePopover />}
                above={<VersionStrip resolvedOpen={resolvedOpen} onResolvedOpen={onResolvedOpen} />}
              />
            ) : (
              <DocFrame
                doc={doc}
                mode="author"
                markers="none"
                margin={margin ? (geo) => <MarginColumn geo={geo} resolvedOpen={resolvedOpen} onResolvedOpen={onResolvedOpen} /> : undefined}
              />
            )}
          </div>
        </div>
      </div>
      {narrow ? null : folded ? <RailStrip onOpen={() => setOverlay(true)} /> : railFor(false)}
      {showOverlay ? railFor(true) : null}
    </div>
  );
}
