// The page's Tab order, for a control that lives outside it. A popover is portalled to the end of the
// document, so the browser's own Tab from inside it lands after everything else on the page; a popover
// that stands in for its anchor (a flag's fix, for its field) sends Tab on from the anchor instead.

const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(", ");

function tabbable(el: HTMLElement): boolean {
  const index = el.getAttribute("tabindex");
  if (index !== null && Number(index) < 0) return false;
  // Base UI's focus guards hand focus round a popup; they aren't stops of their own.
  if (el.hasAttribute("data-base-ui-focus-guard")) return false;
  if (el.closest("[inert], [hidden], fieldset[disabled]")) return false;
  return el.getClientRects().length > 0;
}

/**
 * The first control Tab reaches after `after` and everything inside it, in document order, leaving out
 * anything inside `skip` (the popover asking); null when there is none. Positive tab indexes are taken in
 * document order (the app sets none).
 */
export function nextTabbable(after: Element, skip: Element | null = null): HTMLElement | null {
  for (const el of after.ownerDocument.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (after.contains(el) || skip?.contains(el)) continue;
    if (!(after.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (tabbable(el)) return el;
  }
  return null;
}
