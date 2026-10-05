// Column geometry for the review queue's list. The header row, the rows and the loading skeleton all use
// these, so they line up. The row inset (`ROW`) is the Library's: one inset per list surface.
//
// Wide: the template column keeps about 240px or more beside the others (at 1280 the canvas is about
// 906px). Submitted is 7.5rem, enough for "32 minutes ago" at 14px. Waiting on me and Submitted by me
// need 42.5rem of canvas for the template column; Recently decided adds the decision column and needs
// 55.5rem. Below that the row folds into one column: the cells that no longer fit are said on a line
// under the name instead (`foldedLine`), so nothing overflows down to 800px windows.
// (Tailwind needs the class names written out, so the two breakpoints are spelled twice.)
export { ROW } from "@/components/library/columns";

export const COLUMNS = "grid-cols-[minmax(0,1fr)_8.5rem_7.5rem_7.5rem] @max-[42.5rem]/canvas:grid-cols-1";
export const COLUMNS_DECIDED =
  "grid-cols-[minmax(0,1fr)_8.5rem_7.5rem_7.5rem_11rem] @max-[55.5rem]/canvas:grid-cols-1";

/** A cell that gives way when the row folds. */
export const FOLDS = "@max-[42.5rem]/canvas:hidden";
export const FOLDS_DECIDED = "@max-[55.5rem]/canvas:hidden";

/** The line under the name that carries what the folded cells said; only there when they are gone. */
export const FOLDED_LINE = "hidden @max-[42.5rem]/canvas:block";
export const FOLDED_LINE_DECIDED = "hidden @max-[55.5rem]/canvas:block";

/** 69px: the padding, the name line (21px) and the second line (2px above, 22px for the badge) of a row that has one. Every row is this tall, so a row without a badge or a team doesn't sit shorter. */
export const ROW_HEIGHT = "min-h-[4.3125rem]";
