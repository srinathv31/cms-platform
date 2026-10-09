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
import { paletteGroups, templateIdFromPath } from "@/components/palette/commands";
import { usePaletteResults } from "@/components/palette/use-palette-results";
import { findSection } from "@/components/settings/sections";
import type { PaletteItem, TemplateTabKey } from "@/domain/import-types";
import { PALETTE_QUERY_MAX } from "@/domain/palette";
import type { SpaceNav } from "@/server/queries/spaces";
import { NAV_ICON_STROKE, NAV_ITEMS } from "./nav";
import { ScrimDialogContent } from "./scrim-dialog";
import { TeamIcon } from "./team-icon";

// ⌘K: go to a template, a page, a setting or another team, or start a new template. The items are
// built in `components/palette/commands.ts`; this renders them and handles the keys. Templates and the
// per-space facts (can create, recent templates) are asked of GET /api/palette/{space} when the palette
// opens and as the viewer types (`usePaletteResults`); no page carries them.

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

export function CommandPalette({ viewerId, spaces }: { viewerId: string; spaces: SpaceNav[] }) {
  // Everything the palette keeps (its answers, what was typed) is one viewer's: when the viewer changes
  // (a persona switch, later a sign-in) a new palette starts empty, so nobody sees what was read for
  // somebody else.
  return <Palette key={viewerId} viewerId={viewerId} spaces={spaces} />;
}

function Palette({ viewerId, spaces }: { viewerId: string; spaces: SpaceNav[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const { team } = useParams<{ team?: string }>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The row Enter opens, and the answer it was picked in (see `selected` below).
  const [pick, setPick] = useState<{ value: string; inAnswer: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const space = spaces.find((s) => s.slug === team) ?? spaces[0];
  const { results, exact, failed } = usePaletteResults({
    viewerId,
    space: space?.slug ?? "",
    current: templateIdFromPath(pathname),
    query,
    open: open && space !== undefined,
  });

  const show = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setOpen(true);
  }, []);

  const change = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setPick(null);
    }
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
    () => (space ? paletteGroups({ space, spaces, results, pathname, query }) : []),
    [space, spaces, results, pathname, query],
  );

  if (!space) return null;

  // Until the first answer comes the list stays empty, so nothing it lists moves when the answer's
  // groups arrive above the palette's own. A failed answer lists what the palette has without it.
  const waiting = results === null && !failed;
  // "Nothing found" only once the answer to what was typed is in (or couldn't be had).
  const settled = exact || failed;

  // cmdk moves to the first row whenever what was typed changes. The palette also goes back to it when
  // the server's answer to what was typed replaces a narrowed one, which can put better matches above
  // the row picked meanwhile, so Enter opens the best match, as it always has.
  const answer = results ? `${results.query}|${exact}` : "";
  const values = groups.flatMap((g) => g.items.map((item) => `${g.key}:${itemKey(item)}`));
  const selected = pick && pick.inAnswer === answer && values.includes(pick.value) ? pick.value : (values[0] ?? "");

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
          <Command
            shouldFilter={false}
            loop
            value={selected}
            onValueChange={(value) => setPick({ value, inAnswer: answer })}
            className="rounded-2xl! bg-surface p-2"
          >
            <CommandInput aria-label="Search" value={query} onValueChange={setQuery} maxLength={PALETTE_QUERY_MAX} />
            <CommandList aria-busy={waiting || undefined} className="max-h-[22rem] pt-1 pb-1">
              {settled ? <CommandEmpty className="text-text-muted">Nothing found</CommandEmpty> : null}
              {waiting
                ? null
                : groups.map((group) => (
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
