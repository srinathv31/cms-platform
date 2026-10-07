"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Search, X } from "lucide-react";
import { StatusBadge } from "@/components/primitives/status-badge";
import { usePendingNav } from "@/components/app-shell/pending-nav";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { statusLabel } from "@/domain/status";
import { VERSION_STATES, type VersionState } from "@/domain/types";
import type { LibraryRow } from "@/server/queries/library";
import { cn } from "@/lib/utils";
import { COLUMNS, COLUMNS_TEAM, FOLDS, ROW, TEAM_IN_SUBLINE, statusColumn } from "./columns";
import { StarterGallery } from "./starter-gallery";

type Filter = "all" | VersionState;

/** Case-insensitive match on the template's name or its ID (UC-4F7K2Q). */
function matches(row: LibraryRow, needle: string): boolean {
  return row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle);
}

function ListHeader({ showTeam }: { showTeam: boolean }) {
  return (
    <div aria-hidden className="border-b border-hairline">
      <div className={cn(ROW, "h-10", showTeam ? COLUMNS_TEAM : COLUMNS)}>
        <span className="caps-label">Template</span>
        {showTeam ? <span className={cn("caps-label", FOLDS)}>Team</span> : null}
        <span className="caps-label">Status</span>
        <span className="caps-label">Active</span>
        <span className={cn("caps-label", FOLDS)}>Last edited</span>
        <span className={cn("caps-label", FOLDS)}>Owner</span>
      </div>
    </div>
  );
}

function TemplateRow({ row, space, showTeam, nowIso }: { row: LibraryRow; space: string; showTeam: boolean; nowIso: string }) {
  const href = `/${space}/templates/${row.id}`;
  const { link } = usePendingNav();
  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        href={href as Route}
        onNavigate={link(href)}
        className={cn(
          ROW,
          "min-h-[4.25rem] rounded-xl py-3 text-[14px] outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
          showTeam ? COLUMNS_TEAM : COLUMNS,
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-[15px] leading-5 font-medium" title={row.name}>
            {row.name}
          </span>
          <span className="mt-0.5 block truncate text-xs leading-4 text-text-muted">
            <span className="font-mono">{row.id}</span>
            {showTeam ? <span className={TEAM_IN_SUBLINE}> · {row.teamName}</span> : null}
          </span>
        </span>
        {showTeam ? <span className={cn("truncate text-text-muted", FOLDS)}>{row.teamName}</span> : null}
        <span>
          <StatusBadge state={row.status} sunsetAt={row.sunsetAt} now={nowIso} />
        </span>
        <span className="text-text tabular-nums">
          {row.activeNumber !== null ? `v${row.activeNumber}` : <span className="text-text-subtle">—</span>}
        </span>
        <span className={cn("text-text-muted", FOLDS)}>{row.lastEdited}</span>
        <span className={cn("flex min-w-0 items-center gap-2.5", FOLDS)}>
          <UserAvatar initials={row.owner.initials} hue={row.owner.hue} size="sm" />
          <span className="truncate">{row.owner.name}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The Library's list with its search and status filters. The server renders the rows once; filtering
 * happens here, on that list. A team with no templates gets the starter gallery in place of the list.
 */
export function LibraryBrowser({
  rows,
  spaceSlug,
  showTeam,
  canCreate,
  nowIso,
}: {
  rows: LibraryRow[];
  spaceSlug: string;
  /** The cross-team space adds a Team column. */
  showTeam: boolean;
  /** The viewer can create templates in this team (never true in "All teams"). */
  canCreate: boolean;
  /** The demo clock's now: a sunset outside its year says the year. */
  nowIso: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const byState: Partial<Record<VersionState, number>> = {};
    for (const row of rows) byState[row.status] = (byState[row.status] ?? 0) + 1;
    return byState;
  }, [rows]);
  const present = VERSION_STATES.filter((state) => (counts[state] ?? 0) > 0);

  // A filter whose rows have gone (after a refresh) falls back to All instead of showing nothing.
  const activeFilter: Filter = filter !== "all" && !counts[filter] ? "all" : filter;
  const needle = query.trim().toLowerCase();
  const visible = rows.filter(
    (row) => (activeFilter === "all" || row.status === activeFilter) && (needle === "" || matches(row, needle)),
  );

  if (rows.length === 0) {
    return canCreate ? (
      <section aria-label="Start a template">
        <h2 className="caps-label mb-4">Start a template</h2>
        <StarterGallery teamSlug={spaceSlug} columns={4} />
      </section>
    ) : (
      <p className="py-10 text-[14px] text-text-muted">No templates yet.</p>
    );
  }

  const clear = () => {
    setQuery("");
    setFilter("all");
  };
  const emptyMessage =
    needle !== ""
      ? `No templates match “${query.trim()}”.`
      : activeFilter === "all"
        ? "No templates."
        : `No ${statusLabel(activeFilter).toLowerCase()} templates.`;

  return (
    <div style={statusColumn(rows.some((row) => row.status === "superseded" && row.sunsetAt !== null))}>
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 pb-4">
        <InputGroup className="h-9 w-72 rounded-full border-hairline bg-surface">
          <InputGroupAddon>
            <Search aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-4 text-text-muted" />
          </InputGroupAddon>
          <InputGroupInput
            type="text"
            aria-label="Search templates"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            className="text-[14px]"
          />
          {query ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label="Clear search"
                size="icon-xs"
                className="rounded-full text-text-muted hover:text-text"
                onClick={() => setQuery("")}
              >
                <X aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-3.5" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        {present.length > 1 ? (
          <ToggleGroup
            aria-label="Filter by status"
            spacing={1}
            value={[activeFilter]}
            // Pressing the pressed filter again clears it: back to All.
            onValueChange={(value) => setFilter((value[0] as Filter | undefined) ?? "all")}
          >
            {(["all", ...present] as Filter[]).map((state) => (
              <ToggleGroupItem
                key={state}
                value={state}
                className="h-8 gap-1.5 rounded-full px-3 text-[13px] font-normal text-text-muted hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text data-pressed:bg-selected data-pressed:text-text"
              >
                {state === "all" ? "All" : statusLabel(state)}
                {/* Subtle on the canvas; full text on the pressed pill (bg-selected), where subtle and muted fall under 4.5:1. */}
                <span className="text-text-subtle tabular-nums in-aria-pressed:text-text in-data-pressed:text-text">
                  {state === "all" ? rows.length : counts[state]}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>

      {visible.length > 0 ? (
        <>
          <ListHeader showTeam={showTeam} />
          <ul>
            {visible.map((row) => (
              <TemplateRow key={row.id} row={row} space={spaceSlug} showTeam={showTeam} nowIso={nowIso} />
            ))}
          </ul>
        </>
      ) : (
        <p className="py-10 text-[14px] text-text-muted">
          {emptyMessage}{" "}
          <button
            type="button"
            onClick={clear}
            className="rounded-sm text-text underline underline-offset-4 outline-none hover:text-text-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear
          </button>
        </p>
      )}
      <p role="status" className="sr-only">
        {visible.length === rows.length ? "" : `${visible.length} of ${rows.length} templates shown`}
      </p>
    </div>
  );
}
