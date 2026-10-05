// The redline renderer. `RedlineDocument` paints a RedlineDoc (domain/redline.ts `diffDocuments`)
// like the document itself; `redlineSummary` reads its counts as "2 added, 1 removed, and 3 changed".
export { RedlineDocument, type RedlineDocumentProps } from "./redline-document";
export { collapsedHosts, groupBlocks, hostKey, isCollapsedKey, redlineSummary } from "./blocks";
export { createRedlineHandle, redlineAnchorElement, redlineBlockElement, revealInContainer, type RedlineHandleSource } from "./dom-handle";
