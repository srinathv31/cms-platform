// The well's mat: the space between its edge and an output, the same for every output and every
// width. The well scrolls (PDF, Email) or holds a frame that scrolls inside (Web); either way the
// output stops short of the bottom-right corner, where the app's fixed Demo pill (right-5 bottom-5,
// 32px tall) sits over the well's last 27px or so, so the last of the output can always scroll clear
// of it (measured: the output ends 14px above the pill).

/** 16px on the top and sides, 40px below. */
export const WELL_INSET = "p-4 pb-10";

// The PDF viewer takes the same mat as its `contentClassName` (it keeps its pages in a column of its own,
// whose default padding that replaces; see pdf/pdf-viewer.tsx).
