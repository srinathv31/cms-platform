"use client";

import { Check, Eye, FileText, Globe, Mail, PanelRight, Pencil, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TemplateId } from "@/components/primitives/template-id";
import { ShareRing } from "@/components/signature/share-ring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ChannelId, TabId, TemplateModel } from "./types";

/*
 * Header pieces shared by every layout. A layout decides WHERE they go; what each one says and
 * looks like is the same everywhere, so the three layouts differ only in composition.
 *
 * Header label: the badge says the state, the version label never repeats it.
 *   Draft   [Draft]  Based on v2   ✓ Saved
 *   Active  [Active] v2
 *   Viewer  [Active] v3   [View only]
 */

/** Height of the identity band: the SHARE ring (72px) sets it, so Active and Draft headers match. It only grows if the status row has to wrap (narrow canvas, View only). */
export const HEADER_BAND = "min-h-18";

// ── Title, status, save ─────────────────────────────────────────

/** The template name. A draft's name is a field (click to rename); everything else is plain text. */
export function TitleField({
  model,
  onName,
}: {
  model: TemplateModel;
  onName: (name: string) => void;
}) {
  if (!model.editing) {
    return (
      <h1 className="display-lg truncate text-text" title={model.name}>
        {model.name}
      </h1>
    );
  }
  return (
    <h1 className="display-lg">
      <input
        value={model.name}
        onChange={(e) => onName(e.target.value)}
        aria-label="Template name"
        spellCheck={false}
        className="-my-0.5 -ml-2 w-[calc(100%+0.5rem)] min-w-0 truncate rounded-lg bg-transparent px-2 py-0.5 font-[inherit] text-[length:inherit] leading-[inherit] tracking-[inherit] text-text outline-none transition-colors duration-(--dur-fast) hover:bg-hover focus:bg-surface focus:ring-1 focus:ring-hairline"
      />
    </h1>
  );
}

function SaveIndicator({ saving }: { saving: boolean }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-[13px] leading-5 text-text-subtle"
    >
      {saving ? (
        "Saving…"
      ) : (
        <>
          <Check aria-hidden strokeWidth={1.75} className="size-3.5" />
          Saved
        </>
      )}
    </span>
  );
}

function ViewOnlyBadge() {
  return (
    <Badge
      variant="outline"
      className="h-[22px] gap-1.5 border-hairline px-2 text-[12px] font-medium text-text-muted"
    >
      <Eye aria-hidden strokeWidth={1.75} />
      View only
    </Badge>
  );
}

// ── Channels ────────────────────────────────────────────────────

const CHANNELS: { id: ChannelId; label: string; Icon: LucideIcon }[] = [
  { id: "pdf", label: "PDF", Icon: FileText },
  { id: "web", label: "Web", Icon: Globe },
  { id: "email", label: "Email", Icon: Mail },
];

const CHIP =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium [&_svg]:size-3.5";

/** Toggles while editing; otherwise a plain list of the channels this template renders to. */
export function ChannelChips({
  model,
  onChannels,
  className,
}: {
  model: TemplateModel;
  onChannels: (channels: ChannelId[]) => void;
  className?: string;
}) {
  if (!model.editing) {
    return (
      <ul aria-label="Channels" className={cn("flex items-center gap-1", className)}>
        {CHANNELS.filter((c) => model.channels.includes(c.id)).map(({ id, label, Icon }) => (
          <li key={id} className={cn(CHIP, "border-transparent bg-selected text-text")}>
            <Icon aria-hidden strokeWidth={1.75} />
            {label}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ToggleGroup
      aria-label="Channels"
      multiple
      value={model.channels}
      onValueChange={(next) => onChannels(next as ChannelId[])}
      spacing={1}
      className={className}
    >
      {CHANNELS.map(({ id, label, Icon }) => (
        <ToggleGroupItem
          key={id}
          value={id}
          className={cn(
            CHIP,
            "h-7 border-hairline bg-transparent text-text-muted hover:bg-hover hover:text-text",
            "aria-pressed:border-transparent aria-pressed:bg-selected aria-pressed:text-text",
          )}
        >
          <Icon aria-hidden strokeWidth={1.75} />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ── Status row ──────────────────────────────────────────────────

export function MetaRow({
  model,
  saving,
  onChannels,
  withChannels = true,
  className,
}: {
  model: TemplateModel;
  saving: boolean;
  onChannels: (channels: ChannelId[]) => void;
  /** The Rail layout keeps channels in the rail instead. */
  withChannels?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      <StatusBadge state={model.status} />
      {model.versionLabel ? (
        <span className="text-[14px] leading-6 text-text-muted">{model.versionLabel}</span>
      ) : null}
      {model.editing ? <SaveIndicator saving={saving} /> : null}
      {model.viewOnly ? <ViewOnlyBadge /> : null}
      {withChannels ? <ChannelChips model={model} onChannels={onChannels} /> : null}
    </div>
  );
}

// ── Identity: Template ID + SHARE ring ──────────────────────────

export function IdAndRing({ model, className }: { model: TemplateModel; className?: string }) {
  return (
    <div className={cn("flex shrink-0 gap-6", className)}>
      {/* The ID sits on the status row's line; the ring stays at the top. */}
      <TemplateId id={model.id} className="self-end pb-1.5" />
      {model.showRing ? (
        <ShareRing size={72} className="self-start" label={`Share ${model.name}: integration details`} />
      ) : null}
    </div>
  );
}

// ── Actions ─────────────────────────────────────────────────────

/** Preview, plus the ONE black button the state calls for. A viewer gets Preview alone. */
export function Actions({
  model,
  onEdit,
  lead,
  className,
}: {
  model: TemplateModel;
  onEdit: () => void;
  /** Rendered before Preview (the panel toggle where the layout has one). */
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {lead}
      <Button variant="outline" size="lg" className="px-3.5">
        <Eye data-icon="inline-start" strokeWidth={1.75} />
        Preview
      </Button>
      {model.editing ? (
        <Button size="lg" className="px-4">
          Submit for review
        </Button>
      ) : model.canStartDraft ? (
        <Button size="lg" className="px-4" onClick={onEdit}>
          <Pencil data-icon="inline-start" strokeWidth={1.75} />
          Edit
        </Button>
      ) : null}
    </div>
  );
}

export function PanelToggle({
  open,
  onClick,
  className,
}: {
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="icon-lg"
      aria-label="Variables"
      aria-pressed={open}
      title="Variables"
      onClick={onClick}
      className={cn(open && "bg-selected", className)}
    >
      <PanelRight strokeWidth={1.75} />
    </Button>
  );
}

// ── Tabs ────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "versions", label: "Versions" },
  { id: "usage", label: "Usage" },
  { id: "activity", label: "Activity" },
];

/**
 * Content / Versions / Usage / Activity over a hairline, with the template's actions at the right
 * end of the same line. `sticky` keeps the bar (and so the black button) in reach while the
 * document scrolls.
 */
export function TabBar({
  tab,
  onTab,
  actions,
  sticky = true,
  className,
}: {
  tab: TabId;
  onTab: (tab: TabId) => void;
  actions: React.ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "z-20 flex items-start justify-between gap-6 border-b border-hairline bg-canvas",
        sticky && "sticky top-0",
        className,
      )}
    >
      <Tabs value={tab} onValueChange={(v) => onTab(v as TabId)} className="min-w-0">
        <TabsList variant="line" className="gap-6 p-0 group-data-horizontal/tabs:h-11">
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
      <div className="flex h-11 shrink-0 items-center">{actions}</div>
    </div>
  );
}

/** Stand-in for the other tabs: they get the full width, no variables panel. */
export function TabStub({ tab }: { tab: TabId }) {
  const label = TABS.find((t) => t.id === tab)?.label ?? "";
  return (
    <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-hairline-strong text-[13px] text-text-subtle">
      {label}
    </div>
  );
}
