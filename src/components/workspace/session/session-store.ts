// The workspace session: what the header (in the layout) and the Content page (a child of that layout)
// share. They are separate React subtrees, so they meet in this small store.
//
// Plain TypeScript, no React: the provider owns one store per workspace and the components read it
// with useSyncExternalStore. It holds
//   - the binding: which draft is being edited (versionId, rev). null on a read-only page.
//   - the autosave session for that draft, once the provider has mounted it (`attach`).
//   - the document editor's handle, so the name field can move the caret into the document.
//   - whether the rail overlay is open (narrow canvas).
//
// One autosave session per draft version serves the whole workspace: body, variables, name and
// channels all go through `save`. Two sessions on one version would fight over `rev`.

import type { DocumentEditorHandle } from "@/editor";
import { mergeFields, type SaveFields, type SaveStatus } from "../autosave/autosave-scheduler";

/** The draft the Content page is editing. `rev` is where autosave starts; it is read once per version. */
export interface DraftBinding {
  versionId: string;
  rev: number;
}

export interface SessionStatus {
  status: SaveStatus;
  error?: string;
}

export interface WorkspaceSession {
  subscribe: (listener: () => void) => () => void;
  getBinding: () => DraftBinding | null;
  getStatus: () => SessionStatus;
  getRailOpen: () => boolean;

  /** The Content page says which draft is editable, or null when the page is read-only. Idempotent per version. */
  bind: (binding: DraftBinding | null) => void;
  /** The provider's autosave host connects (and, with null, disconnects) the live `save`. */
  attach: (save: ((fields: SaveFields) => void) | null) => void;
  publishStatus: (status: SessionStatus) => void;

  /**
   * Records changed fields for autosave. Changes made before the autosave host has connected (the
   * first moments after a page loads) are held and handed over when it does.
   */
  save: (fields: SaveFields) => void;

  /** Ref callback for the document editor. */
  setEditor: (handle: DocumentEditorHandle | null) => void;
  /** Moves the caret into the first required section's body. */
  focusDocument: () => void;

  setRailOpen: (open: boolean) => void;
}

const SAVED: SessionStatus = { status: "saved" };

export function createWorkspaceSession(): WorkspaceSession {
  let binding: DraftBinding | null = null;
  let status: SessionStatus = SAVED;
  let railOpen = false;
  let sink: ((fields: SaveFields) => void) | null = null;
  let held: SaveFields | null = null;
  let editor: DocumentEditorHandle | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getBinding: () => binding,
    getStatus: () => status,
    getRailOpen: () => railOpen,

    bind(next) {
      if (next === null) {
        if (binding === null) return;
        binding = null;
        status = SAVED;
        held = null;
        emit();
        return;
      }
      // A re-render or a tab switch binds the same draft again; only a new version starts a session.
      if (binding?.versionId === next.versionId) return;
      binding = next;
      status = SAVED;
      emit();
    },

    attach(save) {
      sink = save;
      if (save && held) {
        const pending = held;
        held = null;
        save(pending);
      }
    },

    publishStatus(next) {
      if (status.status === next.status && status.error === next.error) return;
      status = next;
      emit();
    },

    save(fields) {
      if (sink) sink(fields);
      else held = mergeFields(held, fields);
    },

    setEditor(handle) {
      editor = handle;
    },
    focusDocument() {
      editor?.focus("first-section");
    },

    setRailOpen(open) {
      if (railOpen === open) return;
      railOpen = open;
      emit();
    },
  };
}
