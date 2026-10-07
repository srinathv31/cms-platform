// Public API of the portable editor module, frozen for Phase 2 (see README.md, "Public API").
// UI hosts import from "@/editor". Server and domain code import the server-safe modules directly
// (schema, model/*, paste/*), so they don't load the editor UI this barrel brings along; an ESLint
// rule in eslint.config.mjs enforces it.

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
// Phase 7a additions
export { matchesSectionTitle, sectionTitleKey } from "./model/section-title";

// ── Server: render, import, seeds ────────────────────────────────
export { baseExtensions, ensureBlockIds, type BaseExtensionOptions } from "./schema";
export { normalizePastedHtml, type NormalizeHtmlOptions } from "./paste/normalize-html";
export { chipsInJSON, variableKeys } from "./paste/chips";
// Phase 7a additions
export { looksLikeMarkdown, markdownToHtml } from "./paste/markdown";
