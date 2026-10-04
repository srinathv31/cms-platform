"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Route } from "next";
import { Search } from "lucide-react";
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
import type { PaletteTemplate } from "@/server/queries/palette";
import type { SpaceNav } from "@/server/queries/spaces";
import { NAV_ICON_STROKE, NAV_ITEMS } from "./nav";
import { ScrimDialogContent } from "./scrim-dialog";

/** ⌘K: jump to a page or a template in the current team. Navigation only. */
export function CommandPalette({
  templates,
  spaces,
}: {
  templates: PaletteTemplate[];
  spaces: SpaceNav[];
}) {
  const router = useRouter();
  const { team } = useParams<{ team?: string }>();
  const [open, setOpen] = useState(false);
  const space = spaces.find((s) => s.slug === team) ?? spaces[0];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!space) return null;

  const pages = NAV_ITEMS.filter((i) => i.key !== "audit" || space.showAudit);
  const inSpace = space.kind === "all" ? templates : templates.filter((t) => t.teamSlug === space.slug);

  function go(href: string) {
    setOpen(false);
    router.push(href as Route);
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 gap-2.5 rounded-full border-hairline bg-surface px-3.5 text-[14px] font-normal text-text-muted hover:bg-hover"
      >
        <Search aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-4" />
        Search
        <Shortcut keys={["⌘", "K"]} />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <ScrimDialogContent className="top-[16%] w-[min(36rem,calc(100vw-2rem))] translate-y-0 rounded-2xl">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command className="rounded-2xl! bg-surface p-2">
            <CommandInput placeholder="Search" />
            <CommandList className="max-h-[22rem] pt-1">
              <CommandEmpty className="text-text-muted">Nothing found</CommandEmpty>
              <CommandGroup heading="Pages">
                {pages.map((p) => (
                  <CommandItem
                    key={p.key}
                    value={`page ${p.label}`}
                    onSelect={() => go(`/${space.slug}/${p.key}`)}
                    className="h-10 gap-3 px-3"
                  >
                    <p.icon aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-[18px] text-text-muted" />
                    {p.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              {inSpace.length > 0 ? (
                <CommandGroup heading="Templates">
                  {inSpace.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={`${t.name} ${t.id}`}
                      onSelect={() => go(`/${space.slug}/templates/${t.id}`)}
                      className="h-10 gap-3 px-3"
                    >
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      {space.kind === "all" ? (
                        <span className="shrink-0 text-xs text-text-subtle">{t.teamName}</span>
                      ) : null}
                      <span className="shrink-0 font-mono text-xs text-text-subtle">{t.id}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </ScrimDialogContent>
      </Dialog>
    </>
  );
}
