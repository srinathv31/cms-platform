// Class names shared across the editor: the document box (live editor and static renderer alike, so
// both produce the same box), the focus ring, and the menus (block menu, table menu).

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

/** A menu's card (the block menu and its Numbering submenu, the table menu); each sets its own width. */
export const MENU_POPUP =
  "z-50 origin-(--transform-origin) rounded-xl border border-hairline bg-surface p-1 text-sm text-text shadow-pop outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

/** A menu row: a muted icon, then the label. */
export const MENU_ITEM = "gap-2.5 rounded-lg px-2 py-1.5 text-text focus:bg-hover";

/** A menu row that deletes something. */
export const MENU_ITEM_DANGER = "gap-2.5 rounded-lg px-2 py-1.5 text-danger-text focus:bg-danger-soft focus:text-danger-text";

/** The hairline between a menu's groups. */
export const MENU_SEPARATOR = "mx-1 my-1 bg-hairline";

/** Why a menu's rows are disabled, under them. */
export const MENU_REASON = "px-2 pt-0.5 text-xs text-text-muted";

/** A menu row's lucide icon. */
export const MENU_ICON = { className: "size-4 text-text-muted", strokeWidth: 1.75, "aria-hidden": true } as const;
