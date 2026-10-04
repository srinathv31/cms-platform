// Public contract of the portable editor module (implementation plan §8.1).
// The host app passes data in and receives events out. Persistence, permissions,
// comment storage and the lifecycle stay in the host.

import type { ReactNode } from "react";
import type { JSONContent, RequiredSection, Variable } from "./model/types";

export interface ThreadAnchor {
  id: string;
  blockId: string;
  quote?: string | null;
  status: "open" | "resolved";
}

export interface CommentRequest {
  blockId: string;
  quote?: string;
}

export interface DocumentEditorProps {
  /**
   * TipTap JSON. Top-level blocks carry stable `attrs.id`.
   * Read once, as the initial document; to load a different document, remount with a new `key`.
   */
  content: JSONContent;
  /** The template's variable list (the consumer contract). Chips read label/type from here. */
  variables: Variable[];
  /** From the content type; their headings are locked (Phase 2). */
  requiredSections?: RequiredSection[];
  readOnly?: boolean;
  /** Fires on every document change. The host debounces and saves. */
  onChange?: (doc: JSONContent) => void;
  /** Fires when the variable list changes (create, rename, delete, required toggle). */
  onVariablesChange?: (variables: Variable[]) => void;
  /** Review comments anchored to blocks (Phase 4). */
  threads?: ThreadAnchor[];
  onRequestComment?: (anchor: CommentRequest) => void;
  renderThread?: (thread: ThreadAnchor) => ReactNode;
  /** Optional autofocus target on mount. */
  autoFocus?: "start" | "end" | "first-section" | false;
  className?: string;
}

export interface StaticDocumentProps {
  content: JSONContent;
  variables: Variable[];
  className?: string;
}
