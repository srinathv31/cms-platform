// The well's mat: the space between its edge and an output, the same for every output and every
// width. The well scrolls (PDF, Email) or holds a frame that scrolls inside (Web); either way the
// output stops short of the bottom-right corner, where the app's fixed Demo pill (right-5 bottom-5,
// 32px tall) sits over the well's last 27px or so, so the last of the output can always scroll clear
// of it (measured: the output ends 14px above the pill).

/** 16px on the top and sides, 40px below. */
export const WELL_INSET = "p-4 pb-10";

// The PDF viewer takes the same mat as its `contentClassName` (it keeps its pages in a column of its own,
// whose default padding that replaces; see pdf/pdf-viewer.tsx).

// The phone (Push, SMS) is the one output on an even 16px mat. It fits the well whole rather than
// scrolling, and it is narrower than the well and centred in it, so the Demo pill in the corner never
// covers it; the 24px the pill's room would take go to the phone's height instead. Where the well is too
// short for the phone's smallest scale it scrolls, and then the phone keeps the usual 40px under it at the
// end (its `room`, kept inside the phone's box only while it overflows, because the well's own padding
// doesn't follow an overflowing descendant).

/** 16px all round. */
export const PHONE_INSET = "p-4";
/** The px kept under the phone when the well scrolls: the 40px every output leaves below. */
export const PHONE_ROOM = 40;
