// Column geometry for the Library list. The header row, the rows and the loading skeleton all use
// these, so they always line up.
//
// The status column is sized from the data (see `statusColumn`): wide enough for
// "Superseded · Sunset Mar 1" (the longest, "Dec 29", measures 191px with the icon) when a row can show it,
// otherwise just wide enough for "Changes requested" (the widest plain badge, 148px). The other
// columns are sized to their content, so the name column keeps ~250px at 1280 wide, even with the
// Team column in "All teams".
export const COLUMNS_TEAM = "grid-cols-[minmax(0,1fr)_7rem_var(--status-col)_3.5rem_6.5rem_8.5rem]";
export const COLUMNS = "grid-cols-[minmax(0,1fr)_var(--status-col)_3.5rem_6.5rem_8.5rem]";
export const ROW = "-mx-4 grid items-center gap-x-5 px-4";

export const STATUS_COL_DEFAULT = "9.5rem";
export const STATUS_COL_WITH_SUNSET = "12.25rem";

/** CSS variable the grid templates read. Set it on the element that wraps the header and the rows. */
export function statusColumn(hasSunsetBadge: boolean): React.CSSProperties {
  return {
    "--status-col": hasSunsetBadge ? STATUS_COL_WITH_SUNSET : STATUS_COL_DEFAULT,
  } as React.CSSProperties;
}
