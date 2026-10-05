// The queue's tabs are the workspace tabs' idiom (text, a 2px dark underline on a hairline), as a view
// switch in the page rather than routes. The focus ring goes round the label and its count together (not
// the tab's whole box), so it doesn't run into the underline.
export const TAB_BAR = "mb-2 flex gap-7 border-b border-hairline @max-[32rem]/canvas:gap-5";
export const TAB = "group/tab relative -mb-px flex h-11 items-center text-[15px] whitespace-nowrap outline-none";
/** The label and the count, in one box: what the focus ring wraps. The -mx cancels its padding, so the text sits where it did. */
export const TAB_CONTENT =
  "-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5 group-focus-visible/tab:ring-2 group-focus-visible/tab:ring-ring";

