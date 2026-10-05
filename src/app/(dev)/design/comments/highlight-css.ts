// Highlights for anchored text, painted through the CSS Custom Highlight API (Chrome) so the
// document's DOM is never touched. Injected as a <style> element because the build's CSS parser
// doesn't know ::highlight(). Open threads get a quiet amber wash, the active one a stronger one,
// and the comment being written the selection colour. Tokens only.
export const HIGHLIGHT_CSS = `::highlight(cm-open) {
  background-color: color-mix(in srgb, var(--warning-border) 55%, transparent);
}

::highlight(cm-active) {
  background-color: var(--warning-border);
}

::highlight(cm-pending) {
  background-color: var(--brand-1);
}`;
