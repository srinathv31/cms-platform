"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import {
  Activity,
  FileText,
  History,
  Plus,
  Search,
  Settings as SettingsIcon,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Shortcut } from "@/components/primitives/keycap";
import { StatusBadge } from "@/components/primitives/status-badge";
import { requestLibraryIntent } from "@/components/library/library-intent";
import { paletteGroups } from "@/components/palette/commands";
import { paletteStaleVersion } from "@/components/palette/palette-stale";
import { findSection } from "@/components/settings/sections";
import type { PaletteContext, PaletteItem, TemplateTabKey } from "@/domain/import-types";
import type { PaletteTemplate } from "@/server/queries/palette";
import type { SpaceNav } from "@/server/queries/spaces";
import { NAV_ICON_STROKE, NAV_ITEMS } from "./nav";
import { ScrimDialogContent } from "./scrim-dialog";
import { TeamIcon } from "./team-icon";

// ⌘K: go to a template, a page, a setting or another team, or start a new template. The items are
// built in `components/palette/commands.ts`; this renders them and handles the keys. The per-space
// facts (can create, recent templates) come from /api/palette/{space}, once per space.

const REVALIDATE_AFTER_MS = 20_000;

const TAB_ICON: Record<TemplateTabKey, LucideIcon> = {
  content: FileText,
  versions: History,
  usage: NAV_ITEMS.find((i) => i.key === "usage")!.icon,
  activity: Activity,
};

const GROUP_LABEL = { team: "Team", platform: "Platform" } as const;

/**
 * A modal (dialog, alert dialog or sheet) is open: each paints an overlay while it is. Only one that
 * is on screen counts: a dialog kept mounted under a hidden route (`<Activity>`) is not in the way.
 */
function modalIsOpen(): boolean {
  return [...document.querySelectorAll('[data-slot$="-overlay"][data-open]')].some((el) => el.checkVisibility());
}

function itemIcon(item: PaletteItem, spaces: SpaceNav[]): { icon: LucideIcon | null; team?: string } {
  switch (item.kind) {
    case "template":
      return { icon: FileText };
    case "page":
      return { icon: NAV_ITEMS.find((i) => i.key === item.key)?.icon ?? FileText };
    case "template_tab":
      return { icon: TAB_ICON[item.key] };
    case "settings":
      return { icon: findSection(item.key)?.icon ?? SettingsIcon };
    case "action":
      return { icon: item.key === "import" ? Upload : Plus };
    case "team":
      return { icon: null, team: spaces.find((s) => s.slug === item.slug)?.icon ?? "users" };
  }
}

function itemLabel(item: PaletteItem): string {
  return item.kind === "template" ? item.name : item.kind === "team" ? item.name : item.label;
}

function itemKey(item: PaletteItem): string {
  switch (item.kind) {
    case "template":
      return item.id;
    case "team":
      return item.slug;
    default:
      return item.key;
  }
}

export function CommandPalette({
  templates,
  spaces,
}: {
  templates: PaletteTemplate[];
  spaces: SpaceNav[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { team } = useParams<{ team?: string }>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [contexts, setContexts] = useState<Record<string, PaletteContext>>({});
  const loaded = useRef(new Map<string, { at: number; templates: PaletteTemplate[]; stale: number }>());
  const opener = useRef<HTMLElement | null>(null);
  const space = spaces.find((s) => s.slug === team) ?? spaces[0];
  const spaceSlug = space?.slug;

  // Fetched once per space; a persona or data refresh (new `templates`) and a long gap since the last
  // look count as stale, so Recent follows what the viewer has just been doing.
  const load = useCallback(
    (slug: string, force: boolean) => {
      const seen = loaded.current.get(slug);
      // A template made since (a starter, an import) makes what was loaded stale at once.
      const stale = paletteStaleVersion();
      if (!force && seen && seen.templates === templates && seen.stale === stale && Date.now() - seen.at < REVALIDATE_AFTER_MS) return;
      loaded.current.set(slug, { at: Date.now(), templates, stale });
      fetch(`/api/palette/${encodeURIComponent(slug)}`)
        .then((res) => (res.ok ? (res.json() as Promise<PaletteContext>) : null))
        .then((context) => {
          if (context) setContexts((prev) => ({ ...prev, [slug]: context }));
          else loaded.current.delete(slug);
        })
        .catch(() => loaded.current.delete(slug));
    },
    [templates],
  );

  useEffect(() => {
    if (spaceSlug) load(spaceSlug, false);
  }, [spaceSlug, load]);

  const show = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    if (spaceSlug) load(spaceSlug, false);
    setOpen(true);
  }, [spaceSlug, load]);

  const change = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      // Something nearer already used it (the editor's ⌘K opens its link field on selected text).
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (open) change(false);
      else if (!modalIsOpen()) show(); // never over another modal
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, show, change]);

  const groups = useMemo(
    () =>
      space
        ? paletteGroups({
            space,
            spaces,
            // The space's own list from the server is fresher than the shell's (a template made this session).
            templates: contexts[space.slug]?.templates ?? templates,
            context: contexts[space.slug] ?? null,
            pathname,
            query,
          })
        : [],
    [space, spaces, templates, contexts, pathname, query],
  );

  if (!space) return null;

  // The Team/Platform tag on a settings row says which kind it is; it only helps where both kinds are listed.
  const mixedSettings = new Set(
    groups.flatMap((g) => g.items.flatMap((item) => (item.kind === "settings" ? [item.group] : []))),
  ).size > 1;

  function choose(item: PaletteItem) {
    change(false);
    if (item.kind === "action") requestLibraryIntent(item.key === "import" ? "import" : "new", space!.slug);
    router.push(item.href as Route);
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={show}
        className="h-9 gap-2.5 rounded-full border-hairline bg-surface px-3.5 text-[14px] font-normal text-text-muted hover:bg-hover"
      >
        <Search aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-4" />
        Search
        <Shortcut keys={["⌘", "K"]} />
      </Button>

      <Dialog open={open} onOpenChange={change}>
        <ScrimDialogContent
          className="top-[16%] w-[min(36rem,calc(100vw-2rem))] translate-y-0 rounded-2xl"
          finalFocus={() => opener.current ?? true}
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command shouldFilter={false} loop className="rounded-2xl! bg-surface p-2">
            <CommandInput aria-label="Search" value={query} onValueChange={setQuery} />
            <CommandList className="max-h-[22rem] pt-1 pb-1">
              <CommandEmpty className="text-text-muted">Nothing found</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.key} heading={group.heading}>
                  {group.items.map((item) => {
                    const { icon: Icon, team: teamIcon } = itemIcon(item, spaces);
                    return (
                      <CommandItem
                        key={itemKey(item)}
                        value={`${group.key}:${itemKey(item)}`}
                        onSelect={() => choose(item)}
                        className="h-10 gap-3 px-3 data-selected:bg-hover"
                      >
                        {Icon ? (
                          <Icon aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-[18px] text-text-muted" />
                        ) : teamIcon ? (
                          <TeamIcon name={teamIcon} className="size-[18px] text-text-muted" />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{itemLabel(item)}</span>
                        {item.kind === "template" ? (
                          <>
                            {space.kind === "all" ? (
                              <span className="shrink-0 text-xs text-text-muted group-data-selected/command-item:text-text">{item.teamName}</span>
                            ) : null}
                            <StatusBadge state={item.status} className="shrink-0" />
                            <span className="shrink-0 font-mono text-xs text-text-muted group-data-selected/command-item:text-text">{item.id}</span>
                          </>
                        ) : item.kind === "settings" && mixedSettings ? (
                          <span className="shrink-0 text-xs text-text-muted group-data-selected/command-item:text-text">{GROUP_LABEL[item.group]}</span>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </ScrimDialogContent>
      </Dialog>
    </>
  );
}
