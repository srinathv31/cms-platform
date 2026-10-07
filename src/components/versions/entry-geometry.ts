// Shared by a version on the timeline (version-entry.tsx) and the Versions skeleton, apart from the
// entry and its actions so the skeleton can be drawn without them.

/**
 * The geometry every entry shares, so the skeleton can draw it exactly. The heading row is always the
 * Button height (32px), whether or not the viewer has actions: the entry doesn't change height with
 * who is looking. The dot and the line are placed from the middle of that row.
 */
export const ENTRY_GEOMETRY = {
  /** The timeline column: the dot sits in it, and the line runs down through every entry. */
  indent: "pl-9",
  dot: "absolute top-[12px] left-0 size-[9px] rounded-full ring-4 ring-canvas",
  line: "absolute top-[20px] -bottom-[10px] left-[4px] w-px bg-hairline",
  /** The heading row: the version, its badges and its actions. */
  head: "flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2",
  heading: "text-[17px] leading-7 font-medium text-text outline-none",
} as const;
