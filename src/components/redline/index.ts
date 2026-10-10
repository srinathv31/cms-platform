// The redline renderer. `RedlineDocument` paints a RedlineDoc (domain/redline.ts `diffDocuments`)
// like the document itself; `FieldsDocument` paints a version's channel fields (`diffChannelFields`) as
// the message composer shows them; `redlineSummary` reads the counts as "2 added, 1 removed, and 3 changed".
export { RedlineDocument, type RedlineDocumentProps } from "./redline-document";
export { FieldsDocument, type FieldsDocumentProps } from "./fields-document";
export { collapsedHosts, groupBlocks, hostKey, isCollapsedKey, redlineSummary } from "./blocks";
export { createRedlineHandle, redlineAnchorElement, redlineBlockElement, revealInContainer, type RedlineHandleSource } from "./dom-handle";
