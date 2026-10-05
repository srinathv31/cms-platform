// How a heading's text is compared with a required section's title (Phase 7a). Shared by the import
// (a Word heading "1. Offer Details:" is the "Offer details" section) and the editor's paste (a pasted
// "## Rates and fees" merges into the document's required "Rates and fees"). Pure; no TipTap.

/**
 * The comparable form of a heading's text: Unicode-normalized, trimmed, lowercased, inner whitespace
 * collapsed, leading numbering ("1.", "2)", "A.", "iv)") and a trailing colon removed.
 * "  2. Rates  and Fees: " → "rates and fees".
 */
export function sectionTitleKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\d{1,3}|[a-z]|[ivx]{1,5})[.)]\s+/, "")
    .replace(/\s*:$/, "")
    .trim();
}

/** True when a heading's text names the section with this title. */
export function matchesSectionTitle(text: string, title: string): boolean {
  const key = sectionTitleKey(text);
  return key.length > 0 && key === sectionTitleKey(title);
}
