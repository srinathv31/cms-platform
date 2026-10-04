// Class names shared by the live editor and the static renderer, so both produce the same box.

/** The document element (ProseMirror root / static root). Typography lives in styles.css. */
export const DOC_CLASS = "ucomp-doc";

/** The positioned wrapper around the document (EditorContent's element / static wrapper). */
export const SURFACE_CLASS = "ucomp-surface relative";

/**
 * The editor's one focus style: the app's crisp 2px `--focus-ring` outline, offset from the control
 * (as on rows, tabs and links), replacing shadcn's translucent halo on the controls it renders.
 * (`outline-solid` because shadcn's controls set `outline-none`.)
 */
const RING = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-0";

/** Buttons, switches, toggles. */
export const FOCUS_RING = `${RING} focus-visible:border-transparent`;

/** Inputs and select triggers: their own border stays. */
export const FIELD_FOCUS_RING = `${RING} focus-visible:border-input`;

/** A box whose editable area is inside it (an inline field). */
export const FOCUS_WITHIN_RING = "focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-2 focus-within:outline-ring";
