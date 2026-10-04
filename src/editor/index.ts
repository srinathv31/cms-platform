// Public API of the portable editor module (see README.md). Import from "@/editor" only.

// Components
export { DocumentEditor } from "./components/document-editor";
export { StaticDocument } from "./components/static-document";
export { VariableChipView, type VariableChipViewProps } from "./components/variable-chip";

// Contract types
export type { CommentRequest, DocumentEditorProps, StaticDocumentProps, ThreadAnchor } from "./types";
export {
  NODE,
  VARIABLE_TYPES,
  type JSONContent,
  type RequiredSection,
  type SampleSet,
  type Variable,
  type VariableNodeJSON,
  type VariableType,
  type VariableValue,
  type VariableValues,
} from "./model/types";

// Model utilities (pure TypeScript)
export {
  TYPE_META,
  US_STATES,
  formatValue,
  isValidKey,
  toKey,
  validateValue,
  type ValidationResult,
  type VariableIconKey,
  type VariableTypeMeta,
} from "./model/variables";

// Schema (server-safe base list for render, import and seeds)
export {
  BLOCK_ID_TYPES,
  EMPTY_LINE_PLACEHOLDER,
  baseExtensions,
  editorExtensions,
  ensureBlockIds,
  type BaseExtensionOptions,
  type EditorExtensionOptions,
} from "./schema";
