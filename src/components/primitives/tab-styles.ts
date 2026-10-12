// The tab idiom's classes, for `Tabs` (tabs.tsx), for links that look like tabs (the workspace tab bar)
// and for skeletons. No directive and no React, so a server component (a skeleton) can import them.
//
// Text only, muted until chosen, then dark and medium with a 2px dark underline that sits on the bar's
// hairline (the tab's -1px bottom margin puts it there). The focus ring goes round the label, not the
// tab's box, so it can't run into the underline.

/** A tab's box: 44px tall, 15px text. */
export const TAB =
  "group/tab relative -mb-px flex h-11 items-center text-[15px] whitespace-nowrap outline-none";
/** The chosen tab. */
export const TAB_ACTIVE = "font-medium text-text";
/** Every other tab. */
export const TAB_IDLE = "text-text-muted hover:text-text";
/** The label, and a count after it: what the focus ring goes round. The -mx cancels its padding, so the text sits where the tab is. */
export const TAB_LABEL =
  "-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5 group-focus-visible/tab:ring-2 group-focus-visible/tab:ring-ring";
/** The 2px underline under the chosen tab. */
export const TAB_UNDERLINE =
  "absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text";
/**
 * A bar of tabs wider than a narrow canvas (under 26rem, a window under about 470px) scrolls inside itself rather
 * than push the canvas sideways (reflow, decision 0045). The 1px of padding keeps the tab's -1px margin, which puts
 * its underline on the hairline, from being clipped. `TabList` has it, and so does a skeleton of a bar.
 */
export const TAB_BAR_SCROLLS =
  "@max-[26rem]/canvas:overflow-x-auto @max-[26rem]/canvas:overflow-y-hidden @max-[26rem]/canvas:pb-px";
