"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/components/motion/presets";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TemplateId } from "@/components/primitives/template-id";
import { SaveIndicator } from "@/components/workspace/autosave/save-indicator";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TitleField } from "../workspace/header-parts";
import type { TabId, TemplateModel } from "../workspace/types";
import { PreviewToolbar, RailControls } from "./controls";
import { Output } from "./outputs";
import type { Ctx } from "./render-doc";
import { RailBody } from "./rail-content";
import { PreviewTabBar, RailToggle } from "./tab-bar";
import type { ChannelId, PreviewControls, VariantId } from "./types";

/*
 * The three ways the split can sit with the Rail. They share the main column (header, tab bar and
 * the document) and the output pieces, and differ in where the preview and its controls go:
 *
 *   A  Controls in the rail    editor | output | rail (the rail now holds the controls)
 *   B  Preview replaces rail   editor | output (the rail slides away; one slim toolbar on the output)
 *   C  Rail widens             editor | rail-as-preview (Preview | Variables switch, controls, output)
 *
 * Below the rail's breakpoint (the grid under 53rem, which is a workspace width under 56rem) there is
 * no room for a split: the rail is an overlay behind a toggle, and Preview replaces the document in
 * the main pane, with the slim toolbar on top, whichever variant is chosen.
 */

// ── Geometry ─────────────────────────────────────────────────────

export const RAIL_W = 320;
/** The canvas pad (3rem) plus the handle gutter (1.25rem): where the title, the tabs and the text start. */
const PAD_L = 68;
/** The narrowest text column that is still comfortable to write in (about 52 characters). */
export const MIN_TEXT = 400;
/** 53rem of grid width is 56rem (896px) of workspace width: the rail's breakpoint. */
const NARROW_BELOW = 896;
/** Variant A needs at least this much for its output pane to be worth splitting for. */
const A_MIN_OUTPUT = 300;

export interface Geometry {
  /** Below the rail's breakpoint. */
  narrow: boolean;
  /** The output sits beside the editor. When false it replaces the editor in the main pane. */
  split: boolean;
  /** The output's pane (A, B) or the widened rail (C), in px. */
  outW: number;
}

/** `W` is the width of the workspace: the canvas panel's inside, 1162px for a 1440px window. */
export function geometry(variant: VariantId, W: number): Geometry {
  if (W < NARROW_BELOW) return { narrow: true, split: false, outW: W };
  if (variant === "a") {
    const free = W - RAIL_W;
    const out = free - (PAD_L + MIN_TEXT + 16);
    return out >= A_MIN_OUTPUT ? { narrow: false, split: true, outW: out } : { narrow: false, split: false, outW: free };
  }
  const share = variant === "b" ? 0.5 : 0.52;
  return { narrow: false, split: true, outW: Math.min(Math.round(W * share), W - PAD_L - MIN_TEXT - 24) };
}

const MOTION = { duration: duration.base, ease: ease.outSoft } as const;

// ── Small hooks ──────────────────────────────────────────────────

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

/** True while `flag` is, and for `ms` after it turns off, so a closing pane keeps its content while it slides away. */
function useLagged(flag: boolean, ms = 240) {
  const [shown, setShown] = useState(flag);
  const [prev, setPrev] = useState(flag);
  if (flag !== prev) {
    setPrev(flag);
    if (flag) setShown(true);
  }
  useEffect(() => {
    if (flag) return;
    const id = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(id);
  }, [flag, ms]);
  return flag || shown;
}

// ── What every variant shares ────────────────────────────────────

export interface Shared {
  doc: ReactNode;
  model: TemplateModel;
  tab: TabId;
  onTab: (tab: TabId) => void;
  onName: (name: string) => void;
  channels: ChannelId[];
  onChannels: (channels: ChannelId[]) => void;
  previewing: boolean;
  onPreview: (open: boolean) => void;
  ctl: PreviewControls;
  ctx: Ctx;
}

/** Name, the status row with the Template ID on its line (as the real header lays it out), then room before the tabs. */
function HeaderBand({ s }: { s: Shared }) {
  const { model } = s;
  return (
    <header className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5 pb-6">
      <div className="col-span-2 col-start-1 row-start-1 min-w-0">
        <TitleField model={model} onName={s.onName} />
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

/** The sunken surface the output is drawn on, with its own scroll. */
function OutputWell({ s, pad, inset = false }: { s: Shared; pad: string; inset?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { channel, device } = s.ctl;
  useEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [channel, device]);
  return (
    <div
      ref={ref}
      data-output-well=""
      className={cn(
        "min-h-0 flex-1 overflow-y-auto bg-surface-tinted",
        inset && "rounded-xl border border-hairline",
      )}
    >
      <m.div
        key={`${channel}:${device}`}
        initial={{ opacity: 0.3, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION}
        className={pad}
      >
        <Output channel={channel} device={device} ctx={s.ctx} />
      </m.div>
    </div>
  );
}

/**
 * The main column: header, tab bar, then the editor (and whatever sits beside it).
 *
 *  - `fixed` false: everything scrolls as one, the tab bar sticky, as in the real workspace.
 *  - `fixed` true: header and tab bar stay put and span the column, and the panes below scroll alone.
 *  - `side` is the output pane beside the editor; `swap` an overlay that replaces the editor.
 */
function MainColumn({
  s,
  fixed,
  tight,
  gap,
  side,
  swap,
  lead,
}: {
  s: Shared;
  fixed: boolean;
  /** Something sits close beside the column (a preview): the usual 2.5rem gap closes up to `gap`. */
  tight: boolean;
  /** Space between the editor's text and what is beside it, when tight. */
  gap: number;
  side?: ReactNode;
  swap?: ReactNode;
  lead?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [fixed]);

  const span = fixed ? "" : "mx-auto w-full max-w-(--doc-width)";
  const rightPad = cn("transition-[padding-right] duration-(--dur-base) ease-(--ease-out-soft)", tight ? "pr-6" : "pr-10");

  return (
    <div
      ref={scroller}
      data-main=""
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", fixed ? "overflow-hidden" : "overflow-y-auto")}
    >
      <div className={cn("shrink-0 pl-[68px]", rightPad)}>
        <div className={span}>
          <HeaderBand s={s} />
        </div>
      </div>
      <div className={cn("sticky top-0 z-20 shrink-0 bg-canvas pl-[68px]", rightPad)}>
        <div className={span}>
          <PreviewTabBar
            tab={s.tab}
            onTab={s.onTab}
            previewing={s.previewing}
            onPreview={() => s.onPreview(!s.previewing)}
            lead={lead}
          />
        </div>
      </div>
      <div className={cn("relative flex", fixed && "min-h-0 flex-1")}>
        <div data-editor="" className={cn("min-w-0 flex-1", fixed && "overflow-y-auto")}>
          <div
            className="pl-[68px] transition-[padding-right] duration-(--dur-base) ease-(--ease-out-soft)"
            style={{ paddingRight: tight ? gap : 40 }}
          >
            <div className="mx-auto max-w-(--doc-width)">
              <div
                className="wm-doc pt-8 pb-[max(3.5rem,40svh)]"
                data-heads="serif"
                style={{ "--wm-gutter": "4.25rem" } as CSSProperties}
              >
                {s.doc}
              </div>
            </div>
          </div>
        </div>
        {side}
        <AnimatePresence>{swap}</AnimatePresence>
      </div>
    </div>
  );
}

/** Replaces the editor in the main pane (Preview below the rail's breakpoint, and A where it cannot split). */
function SwapPane({ s, toolbar }: { s: Shared; toolbar: boolean }) {
  return (
    <m.div
      key="swap"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={MOTION}
      className="absolute inset-0 z-10 flex flex-col bg-canvas"
    >
      {toolbar ? (
        <div className="shrink-0 px-5 py-3">
          <PreviewToolbar ctl={s.ctl} />
        </div>
      ) : null}
      <OutputWell s={s} pad="px-5 py-5" />
    </m.div>
  );
}

/** The rail's strip: flush with the panel's edge, full height, its own scroll. */
const RAIL_STRIP = "h-full w-80 shrink-0 overflow-y-auto border-l border-hairline bg-canvas px-3 pt-[17px] pb-14";

function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // An open menu or popover takes the first Escape.
      if (document.querySelector('[data-slot="dropdown-menu-content"],[data-slot="popover-content"]')) return;
      onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

// ── Below the rail's breakpoint ──────────────────────────────────

function Narrow({ s }: { s: Shared }) {
  const [overlay, setOverlay] = useState(false);
  const showOverlay = overlay && !s.previewing;
  useEscape(showOverlay, () => setOverlay(false));
  return (
    <>
      <MainColumn
        s={s}
        fixed={s.previewing}
        tight={s.previewing}
        gap={24}
        swap={s.previewing ? <SwapPane s={s} toolbar /> : null}
        lead={s.previewing ? null : <RailToggle open={overlay} onClick={() => setOverlay((o) => !o)} />}
      />
      {showOverlay ? (
        <aside
          aria-label="Channels and variables"
          className="absolute inset-y-0 right-0 z-30 h-full w-80 overflow-y-auto border-l border-hairline bg-canvas px-3 pt-[17px] pb-14 shadow-pop"
        >
          <RailBody
            channels={s.channels}
            onChannels={s.onChannels}
            closeSlot={
              <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mr-1.5" onClick={() => setOverlay(false)}>
                <X strokeWidth={1.75} />
              </Button>
            }
          />
        </aside>
      ) : null}
    </>
  );
}

// ── A · Controls in the rail ─────────────────────────────────────

function LayoutA({ s, geo }: { s: Shared; geo: Geometry }) {
  const open = s.previewing;
  const shown = useLagged(open && geo.split);
  const splitOpen = open && geo.split;
  return (
    <>
      <MainColumn
        s={s}
        fixed={open}
        tight={open}
        gap={16}
        side={
          <m.div
            initial={false}
            animate={{ width: splitOpen ? geo.outW : 0 }}
            transition={MOTION}
            className="shrink-0 overflow-hidden"
          >
            {shown ? (
              <div data-output-pane="" style={{ width: geo.outW }} className="flex h-full flex-col border-l border-hairline">
                <OutputWell s={s} pad="px-3 py-4" />
              </div>
            ) : null}
          </m.div>
        }
        swap={open && !geo.split ? <SwapPane s={s} toolbar={false} /> : null}
      />
      <aside aria-label={open ? "Preview controls" : "Channels and variables"} data-rail="" className={RAIL_STRIP}>
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={open ? "controls" : "rail"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.fast, ease: ease.outSoft }}
          >
            {open ? <RailControls ctl={s.ctl} /> : <RailBody channels={s.channels} onChannels={s.onChannels} />}
          </m.div>
        </AnimatePresence>
      </aside>
    </>
  );
}

// ── B · Preview replaces the rail ────────────────────────────────

function LayoutB({ s, geo }: { s: Shared; geo: Geometry }) {
  const open = s.previewing;
  const shown = useLagged(open);
  return (
    <>
      <MainColumn
        s={s}
        fixed={open}
        tight={open}
        gap={24}
        side={
          <m.div
            initial={false}
            animate={{ width: open ? geo.outW : 0 }}
            transition={MOTION}
            className="shrink-0 overflow-hidden"
          >
            {shown ? (
              <div data-output-pane="" style={{ width: geo.outW }} className="flex h-full flex-col border-l border-hairline">
                <div className="shrink-0 bg-canvas px-5 py-3">
                  <PreviewToolbar ctl={s.ctl} />
                </div>
                <OutputWell s={s} pad="px-5 py-5" />
              </div>
            ) : null}
          </m.div>
        }
      />
      <m.aside
        initial={false}
        animate={{ width: open ? 0 : RAIL_W }}
        transition={MOTION}
        aria-label="Channels and variables"
        data-rail=""
        className="h-full shrink-0 overflow-hidden"
        inert={open}
      >
        <div className={RAIL_STRIP}>
          <RailBody channels={s.channels} onChannels={s.onChannels} />
        </div>
      </m.aside>
    </>
  );
}

// ── C · The rail widens into the preview ─────────────────────────

type Pane = "preview" | "variables";

function PaneSwitch({ value, onChange }: { value: Pane; onChange: (pane: Pane) => void }) {
  const item =
    "h-7 flex-1 rounded-md border-0 px-3 text-[13px] font-medium text-text-muted hover:bg-transparent hover:text-text aria-pressed:bg-surface aria-pressed:text-text aria-pressed:ring-1 aria-pressed:ring-hairline";
  return (
    <ToggleGroup
      aria-label="Rail"
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as Pane | undefined;
        if (picked) onChange(picked);
      }}
      spacing={0}
      className="h-8 w-full rounded-lg bg-selected p-0.5"
    >
      <ToggleGroupItem value="preview" className={item}>
        Preview
      </ToggleGroupItem>
      <ToggleGroupItem value="variables" className={item}>
        Variables
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function LayoutC({ s, geo }: { s: Shared; geo: Geometry }) {
  const open = s.previewing;
  const shown = useLagged(open);
  const [pane, setPane] = useState<Pane>("preview");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPane("preview");
  }
  const innerW = shown ? geo.outW : RAIL_W;

  return (
    <>
      <MainColumn s={s} fixed={false} tight={open} gap={24} />
      <m.aside
        initial={false}
        animate={{ width: open ? geo.outW : RAIL_W }}
        transition={MOTION}
        aria-label={open ? "Preview" : "Channels and variables"}
        data-rail=""
        data-output-pane=""
        className="relative h-full shrink-0 overflow-hidden border-l border-hairline bg-canvas"
      >
        <div className="absolute inset-y-0 right-0 flex flex-col" style={{ width: innerW }}>
          {shown ? (
            <m.div
              key="wide"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: duration.fast, ease: ease.outSoft }}
              className="flex min-h-0 flex-1 flex-col px-3 pt-[17px]"
            >
              <PaneSwitch value={pane} onChange={setPane} />
              {pane === "preview" ? (
                <>
                  <PreviewToolbar ctl={s.ctl} className="mt-3 shrink-0" />
                  <div className="mt-3 flex min-h-0 flex-1 flex-col pb-3">
                    <OutputWell s={s} pad="px-4 py-4" inset />
                  </div>
                </>
              ) : (
                <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-14">
                  <RailBody channels={s.channels} onChannels={s.onChannels} />
                </div>
              )}
            </m.div>
          ) : (
            <m.div
              key="rail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: duration.fast, ease: ease.outSoft }}
              className="min-h-0 flex-1 overflow-y-auto px-3 pt-[17px] pb-14"
            >
              <RailBody channels={s.channels} onChannels={s.onChannels} />
            </m.div>
          )}
        </div>
      </m.aside>
    </>
  );
}

// ── The workspace ────────────────────────────────────────────────

/** The canvas panel's inside, below its top bar: measures itself and lays out the chosen variant. */
export function Workspace({ variant, s }: { variant: VariantId; s: Shared }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref, 1162);
  const geo = geometry(variant, width);

  useEscape(s.previewing, () => s.onPreview(false));

  return (
    <div
      ref={ref}
      data-workspace=""
      data-variant={variant}
      data-split={geo.split ? "" : undefined}
      data-narrow={geo.narrow ? "" : undefined}
      className="relative flex min-h-0 flex-1"
    >
      {geo.narrow ? (
        <Narrow s={s} />
      ) : variant === "a" ? (
        <LayoutA s={s} geo={geo} />
      ) : variant === "b" ? (
        <LayoutB s={s} geo={geo} />
      ) : (
        <LayoutC s={s} geo={geo} />
      )}
    </div>
  );
}
