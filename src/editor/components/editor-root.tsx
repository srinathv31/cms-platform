"use client";

// <EditorRoot>: one variable list shared by the document, the variables panel and inline fields.
// The root owns the list from the first render on (the `variables` prop is read once) and reports
// every change through `onVariablesChange`. A <DocumentEditor> outside a root makes its own.

import { createContext, use, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { DEFAULT_REQUIRED_NOTE } from "../extensions/required-sections";
import { diffVariables } from "../model/contract";
import type { RequiredSection } from "../model/types";
import { createEditorRootRuntime, type EditorRootRuntime } from "../state/editor-root";
import type { ContractState, EditorHistory, EditorRootProps } from "../types";

const EditorRootContext = createContext<EditorRootRuntime | null>(null);

const NO_SECTIONS: RequiredSection[] = [];

export function EditorRoot({
  variables,
  onVariablesChange,
  baseline = null,
  requiredSections = NO_SECTIONS,
  readOnly = false,
  requiredNote = DEFAULT_REQUIRED_NOTE,
  children,
}: EditorRootProps) {
  const [runtime] = useState(() =>
    createEditorRootRuntime({ variables, baseline, requiredSections, readOnly, requiredNote }),
  );

  // List changes only come from interaction after mount, so wiring the listener in an effect is in time.
  useLayoutEffect(() => {
    runtime.setListener(onVariablesChange ?? null);
  });

  // Config can change after mount (a permission flip, a new Active version).
  useLayoutEffect(() => {
    const current = runtime.config.getState();
    if (
      current.readOnly === readOnly &&
      current.baseline === baseline &&
      current.requiredSections === requiredSections &&
      current.requiredNote === requiredNote
    ) {
      return;
    }
    runtime.config.setState({ readOnly, baseline, requiredSections, requiredNote });
  }, [runtime, readOnly, baseline, requiredSections, requiredNote]);

  useEffect(() => {
    runtime.markCommitted();
  }, [runtime]);

  return <EditorRootContext value={runtime}>{children}</EditorRootContext>;
}

/** The enclosing root, or null outside one. */
export function useOptionalEditorRoot(): EditorRootRuntime | null {
  return use(EditorRootContext);
}

/** The enclosing root; `who` names the component in the error when there is none. */
export function useEditorRoot(who: string): EditorRootRuntime {
  const root = use(EditorRootContext);
  if (!root) throw new Error(`<${who}> must render inside an <EditorRoot>.`);
  return root;
}

/**
 * The root's contract right now: its variable list and how it differs from `baseline`
 * (for the host's Submit dialog). Updates whenever the list changes.
 */
export function useContractState(): ContractState {
  const root = useEditorRoot("useContractState");
  const variables = useStore(root.variables, (s) => s.variables);
  const renames = useStore(root.variables, (s) => s.renames);
  const baseline = useStore(root.config, (s) => s.baseline);
  return useMemo(
    () => ({
      variables: [...variables],
      changes: baseline ? diffVariables(baseline, variables, { renames }) : [],
    }),
    [variables, renames, baseline],
  );
}

/**
 * Undo and redo for a host's own buttons. They act on the last-focused field of the root (the
 * document until a field has had focus), the field ⌘Z would undo in, and `canUndo` / `canRedo`
 * follow it. Read-only, both are false and the actions do nothing.
 */
export function useEditorHistory(): EditorHistory {
  const root = useEditorRoot("useEditorHistory");
  const canUndo = useStore(root.history, (s) => s.canUndo);
  const canRedo = useStore(root.history, (s) => s.canRedo);
  return useMemo(() => ({ canUndo, canRedo, undo: root.undo, redo: root.redo }), [canUndo, canRedo, root]);
}
