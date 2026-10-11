// Column geometry for the Library list. The header row, the rows and the loading skeleton all use
// these, so they always line up.
//
// The status column is sized from the data (see `statusColumn`): wide enough for
// "Superseded · Sunset Mar 1" (the longest, "Dec 29", measures 191px with the icon) when a row can show it,
// or "Superseded · Sunset passed Mar 1" (the longest, "May 30", measures 234px) once that sunset has passed,
// otherwise just wide enough for "Changes requested" (the widest plain badge, 148px). A year after the day
// (a sunset outside the demo clock's year) isn't sized for. The other
// columns are sized to their content, so the name column keeps ~250px at 1280 wide, even with the
// Team column in "All teams".
//
// Below 56rem of canvas (the canvas is about 906px at 1280 wide, about 426px at 800) Team, Last edited
// and Owner give way, so the name keeps room down to 800px windows; the team then shows on the line
// under the name (`TEAM_IN_SUBLINE`). Tailwind needs the class names written out, so the breakpoint is
// spelled in each.
export const COLUMNS_TEAM =
  "grid-cols-[minmax(0,1fr)_7rem_var(--status-col)_3.5rem_6.5rem_8.5rem] @max-[56rem]/canvas:grid-cols-[minmax(0,1fr)_var(--status-col)_3.5rem] @max-[26rem]/canvas:grid-cols-[minmax(0,1fr)_auto]";
export const COLUMNS =
  "grid-cols-[minmax(0,1fr)_var(--status-col)_3.5rem_6.5rem_8.5rem] @max-[56rem]/canvas:grid-cols-[minmax(0,1fr)_var(--status-col)_3.5rem] @max-[26rem]/canvas:grid-cols-[minmax(0,1fr)_auto]";

// Below 26rem of canvas (a window under about 470px, a laptop at 275% zoom or more) the three columns that are
// left would leave the name about 14px at 320px wide. The row stacks instead: the name takes the first line,
// the status and the Active version share the second, and the header row, whose labels no longer line up with
// anything, gives way (`STACKED_HIDDEN`; the row says "Active v2" itself, `STACKED_ONLY`).
// Reflow for zoom, decision 0045.

/** The name cell: a line of its own when the row stacks. */
export const NAME_CELL = "@max-[26rem]/canvas:col-span-2";

/** The header row's wrapper: its labels have nothing to line up with once the rows stack. */
export const STACKED_HIDDEN = "@max-[26rem]/canvas:hidden";

/** Text that only a stacked row shows: the Active column's label. */
export const STACKED_ONLY = "hidden @max-[26rem]/canvas:inline";

/** A cell (and its header) that gives way on a narrow canvas: Team, Last edited, Owner. */
export const FOLDS = "@max-[56rem]/canvas:hidden";

/** The team, said on the line under the name once the Team column has given way. */
export const TEAM_IN_SUBLINE = "hidden @max-[56rem]/canvas:inline";
export const ROW = "-mx-4 grid items-center gap-x-5 px-4";

export const STATUS_COL_DEFAULT = "9.5rem";
export const STATUS_COL_WITH_SUNSET = "12.25rem";
export const STATUS_COL_WITH_PASSED_SUNSET = "14.75rem";

/** The widest badge a list can show: a plain state, "Superseded · Sunset Mar 1", or "Superseded · Sunset passed Mar 1". */
export type StatusBadgeWidth = "default" | "sunset" | "sunset-passed";

const STATUS_COL: Record<StatusBadgeWidth, string> = {
  default: STATUS_COL_DEFAULT,
  sunset: STATUS_COL_WITH_SUNSET,
  "sunset-passed": STATUS_COL_WITH_PASSED_SUNSET,
};

/** CSS variable the grid templates read. Set it on the element that wraps the header and the rows. */
export function statusColumn(widest: StatusBadgeWidth): React.CSSProperties {
  return { "--status-col": STATUS_COL[widest] } as React.CSSProperties;
}
