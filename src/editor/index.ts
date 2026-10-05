// Public API of the portable editor module, frozen for Phase 2 (see README.md, "Public API").
// Hosts import from "@/editor" only. Pure model code (model/*) may also be imported directly by
// code that must not load React or TipTap (domain rules, server validation).

// ── Components ───────────────────────────────────────────────────
export { EditorRoot, useContractState } from "./components/editor-root";
export { DocumentEditor } from "./components/document-editor";
export { VariablesPanel } from "./components/variables-panel";
export { InlineVariableField } from "./components/inline-variable-field";
export { StaticDocument } from "./components/static-document";
export { VariableChipView, type VariableChipViewProps } from "./components/variable-chip";

// ── Component contract ───────────────────────────────────────────
export type {
  CommentRequest,
  ContractState,
  DocumentAlign,
  DocumentEditorHandle,
  DocumentEditorProps,
  EditorRootProps,
  FocusTarget,
  InlineVariableFieldProps,
  StaticDocumentProps,
  ThreadAnchor,
  VariablesPanelProps,
} from "./types";

// ── Document and variable model ──────────────────────────────────
export {
  NODE,
  VARIABLE_TYPES,
  type ContractChange,
  type ContractChangeKind,
  type JSONContent,
  type RequiredSection,
  type SampleSet,
  type Variable,
  type VariableNodeJSON,
  type VariableType,
  type VariableValue,
  type VariableValues,
} from "./model/types";
export { diffVariables, flaggedKeys, isBreaking, type DiffOptions } from "./model/contract";
export {
  TYPE_META,
  US_STATES,
  formatValue,
  isValidKey,
  labelFromKey,
  toKey,
  validateValue,
  type ValidationResult,
  type VariableIconKey,
  type VariableTypeMeta,
} from "./model/variables";
// Phase 3 additions
export {
  DEFAULT_SAMPLE_SETS,
  defaultSampleSets,
  sampleSetValues,
  type DefaultSampleSetId,
} from "./model/sample-sets";

// ── Server: render, import, seeds ────────────────────────────────
export { baseExtensions, ensureBlockIds, type BaseExtensionOptions } from "./schema";
export { normalizePastedHtml, type NormalizeHtmlOptions } from "./paste/normalize-html";
export { chipsInJSON, variableKeys } from "./paste/chips";
