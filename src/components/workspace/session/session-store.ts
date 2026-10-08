// The workspace session: what the header (in the layout) and the Content page (a child of that layout)
// share. They are separate React subtrees, so they meet in this small store.
//
// Plain TypeScript, no React: the provider owns one store per workspace and the components read it
// with useSyncExternalStore. It holds
//   - the binding: which draft is being edited (versionId, rev). null on a read-only page.
//   - the autosave session for that draft, once the provider has mounted it (`attach`).
//   - the document editor's handle, so the name field can move the caret into the document.
//   - whether the rail overlay is open (narrow canvas).
//   - which tab the rail shows when it has comments (Comments | Variables), until the author picks one.
//   - the preview's state (open, which view the widened rail shows, channel, sample set, device), so the
//     tab bar's Preview button and the rail agree.
//   - a save "tick" that counts the saves that have landed, so an open preview knows when to re-render.
//   - undo and redo for the header's buttons, from the Content page's editor root while it is on screen.
//   - what changed since the page opened (the latest value of every field saved), and the parts of
//     the page that can show other values, so the header's "Revert to when you opened it" can put
//     everything back, "Revert to v3" can put another version's content in, and their toast's Undo
//     can put the changes back again.
//
// One autosave session per draft version serves the whole workspace: body, variables, name and
// channels all go through `save`. Two sessions on one version would fight over `rev`.

import type { DocumentEditorHandle } from "@/editor/types";
import type { Channel } from "@/domain/types";
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

/**
 * What the widened rail shows: the rendered output, the file the template was imported from (only
 * when it was imported), the template's review comments (only when it has some), or the normal rail
 * (Channels, Email details, Variables).
 */
export type PreviewView = "preview" | "original" | "comments" | "variables";

/** What the plain rail shows when the template has review comments: the thread list, or the normal rail. */
export type RailTab = "comments" | "variables";
export type PreviewDevice = "desktop" | "mobile";

/**
 * The preview, as the tab bar and the rail share it. `channel` is the one the author last picked; the
 * preview shows it only while that channel is on for the version, otherwise the first one that is.
 * `setId` is the selected sample set ("typical" until another is picked; a set that no longer exists
 * falls back to "typical" in the preview).
 */
export interface PreviewState {
  open: boolean;
  view: PreviewView;
  channel: Channel;
  setId: string;
  device: PreviewDevice;
}

/** Undo and redo for the header's buttons: the Content page's editor root, while it is on screen. */
export interface HistoryControls {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/**
 * A part of the page that shows saved fields (the Content page, the name field) and can be made to
 * show other values: a revert, or undoing one. Saving those values is the session's job.
 */
export interface RestoreTarget {
  /** The fields it shows, as they were when the page opened. Its keys are the fields it owns. */
  opening: SaveFields;
  /**
   * Show new values. `fields` are the ones changing (a target owning none of them has nothing to
   * do); `values` is every field as it now stands, for a part that shows several at once.
   */
  restore: (fields: SaveFields, values: SaveFields) => void;
}

export const INITIAL_PREVIEW: PreviewState = {
  open: false,
  view: "preview",
  channel: "pdf",
  setId: "typical",
  device: "desktop",
};

export interface WorkspaceSession {
  subscribe: (listener: () => void) => () => void;
  getBinding: () => DraftBinding | null;
  getStatus: () => SessionStatus;
  getRailOpen: () => boolean;
  /** The tab the author picked, or null until they do (the rail then opens on Comments when something is waiting there). */
  getRailTab: () => RailTab | null;
  /** The same object until something changes, so it works as a store snapshot. */
  getPreview: () => PreviewState;
  /**
   * How many saves have landed (the status went from saving to saved) since this session began.
   * An open preview re-renders when it changes, because the saved draft is what the route renders.
   */
  getSaveTick: () => number;
  /** Undo and redo for the header, or null when no editor is on screen (another tab, read-only). */
  getHistory: () => HistoryControls | null;
  /**
   * There are changes since the page opened, and every changed field has a part of the page on
   * screen that can show its opening value again: "Revert to when you opened it" can be offered.
   */
  getCanRevert: () => boolean;
  /** When the draft was bound (Date.now()): "when you opened it". */
  getOpenedAt: () => number;
  /** The fields some part of the page on screen can show other values of, sorted and comma-joined (a stable snapshot). */
  getOwnedFields: () => string;

  /** The Content page says which draft is editable, or null when the page is read-only. Idempotent per version. */
  bind: (binding: DraftBinding | null) => void;
  /**
   * The provider's autosave host connects (and, with null, disconnects) the live `save` and its
   * `flush`. Changes held until now are handed to `save`, and anyone waiting in `flush` carries on.
   */
  attach: (save: ((fields: SaveFields) => void) | null, flush?: () => Promise<void>) => void;
  publishStatus: (status: SessionStatus) => void;

  /**
   * Records changed fields for autosave. Changes made before the autosave host has connected (the
   * first moments after a page loads) are held and handed over when it does.
   */
  save: (fields: SaveFields) => void;
  /**
   * Sends whatever is pending now, including changes held before the autosave host connected, and
   * resolves once it is saved or has failed (the status says which). With no draft bound, or nothing
   * to send and no host, it resolves at once. Call it before anything that reads the saved draft:
   * submitting, previewing.
   */
  flush: () => Promise<void>;

  /** The Content page's editor root hands over its undo and redo (null when it goes). */
  setHistory: (controls: HistoryControls | null) => void;
  /** A part of the page that can show other values joins revert. Returns the function that takes it out again. */
  addRestoreTarget: (target: RestoreTarget) => () => void;
  /**
   * Puts every field changed since the page opened back to its opening value, on screen and in
   * autosave. Returns the values it replaced (hand them to `restore` to undo it), or null when it
   * can't (see `getCanRevert`).
   */
  revert: () => SaveFields | null;
  /** Shows and saves these values: undoing a revert. */
  restore: (fields: SaveFields) => void;
  /**
   * Shows and saves `fields` as an edit like any other ("Revert to v3"). Returns the values they
   * replaced (hand them to `restore` to undo it), or null when a field has no part on screen to show it.
   */
  replace: (fields: SaveFields) => SaveFields | null;

  /** Ref callback for the document editor. */
  setEditor: (handle: DocumentEditorHandle | null) => void;
  /** Moves the caret into the first required section's body. */
  focusDocument: () => void;

  setRailOpen: (open: boolean) => void;

  /**
   * The rail's view switch. "comments" and "variables" are also what the plain rail shows once the
   * preview is put away; "preview" and "original" only change the widened rail.
   */
  selectRailView: (view: PreviewView) => void;
  /**
   * Brings the comments into sight: the rail's Comments tab (the widened rail's too, while the preview
   * is open) and, where the rail is an overlay, the overlay.
   */
  showComments: () => void;

  /** Opens the preview, on its Preview view. */
  openPreview: () => void;
  /** Widens the rail on the Original view: the file the template was imported from (like Preview, Esc puts it away). */
  openOriginal: () => void;
  closePreview: () => void;
  /** Changes any of the preview's fields; a change that changes nothing notifies nobody. */
  setPreview: (patch: Partial<PreviewState>) => void;
}

const SAVED: SessionStatus = { status: "saved" };

export function createWorkspaceSession(): WorkspaceSession {
  let binding: DraftBinding | null = null;
  let status: SessionStatus = SAVED;
  let railOpen = false;
  let railTab: RailTab | null = null;
  let preview: PreviewState = INITIAL_PREVIEW;
  let saveTick = 0;
  let history: HistoryControls | null = null;
  // The latest value of every field saved since the page opened (null: nothing changed).
  let edited: SaveFields | null = null;
  // Set when a draft is bound (an effect): the store itself is made during render, where the clock can't be read.
  let openedAt = 0;
  let canRevert = false;
  let ownedFields = "";
  const targets = new Set<RestoreTarget>();
  let sink: ((fields: SaveFields) => void) | null = null;
  let flusher: (() => Promise<void>) | null = null;
  let held: SaveFields | null = null;
  // Flushes asked for while changes are held for a host that hasn't connected yet.
  let waiting: (() => void)[] = [];
  let editor: DocumentEditorHandle | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const setPreview = (patch: Partial<PreviewState>) => {
    const next = { ...preview, ...patch };
    if ((Object.keys(next) as (keyof PreviewState)[]).every((key) => next[key] === preview[key])) return;
    preview = next;
    emit();
  };
  const owned = () => new Set([...targets].flatMap((target) => Object.keys(target.opening)));
  /** The targets changed: the owned fields, and so whether a revert can be offered, may have too. */
  const syncTargets = () => {
    const next = [...owned()].sort().join(",");
    const changed = next !== ownedFields;
    ownedFields = next;
    return syncCanRevert() || changed;
  };
  const syncCanRevert = () => {
    const next = edited !== null && binding !== null && Object.keys(edited).every((key) => owned().has(key));
    if (next === canRevert) return false;
    canRevert = next;
    return true;
  };
  /** Hands fields to autosave (now, or once the host connects). */
  const send = (fields: SaveFields) => {
    if (sink) sink(fields);
    else held = mergeFields(held, fields);
  };
  const openingValues = () => {
    const opening: SaveFields = {};
    for (const target of targets) Object.assign(opening, target.opening);
    return opening;
  };
  /** Shows `fields` everywhere they are shown, and saves them. Call it before `edited` takes them in. */
  const apply = (fields: SaveFields) => {
    const values = { ...openingValues(), ...edited, ...fields };
    for (const target of [...targets]) target.restore(fields, values);
    send(fields);
  };
  const releaseWaiting = () => {
    const release = waiting;
    waiting = [];
    for (const resolve of release) resolve();
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
    getRailTab: () => railTab,
    getPreview: () => preview,
    getSaveTick: () => saveTick,
    getHistory: () => history,
    getCanRevert: () => canRevert,
    getOpenedAt: () => openedAt,
    getOwnedFields: () => ownedFields,

    bind(next) {
      if (next === null) {
        if (binding === null) return;
        binding = null;
        status = SAVED;
        held = null;
        edited = null;
        syncCanRevert();
        releaseWaiting();
        emit();
        return;
      }
      // A re-render or a tab switch binds the same draft again; only a new version starts a session.
      if (binding?.versionId === next.versionId) return;
      binding = next;
      status = SAVED;
      edited = null;
      openedAt = Date.now();
      syncCanRevert();
      emit();
    },

    attach(save, flush) {
      sink = save;
      flusher = save ? (flush ?? null) : null;
      if (!save) return;
      if (held) {
        const pending = held;
        held = null;
        save(pending);
      }
      const release = waiting;
      waiting = [];
      if (release.length > 0) {
        const done = flusher ? flusher() : Promise.resolve();
        // A failed flush is the status's to report; the waiting callers just carry on.
        void done.catch(() => undefined).then(() => release.forEach((resolve) => resolve()));
      }
    },

    publishStatus(next) {
      if (status.status === next.status && status.error === next.error) return;
      // A save landing: the one transition a preview cares about. (A save that fails goes to "error".)
      if (status.status === "saving" && next.status === "saved") saveTick += 1;
      status = next;
      emit();
    },

    save(fields) {
      send(fields);
      if (binding === null) return;
      edited = mergeFields(edited, fields);
      if (syncCanRevert()) emit();
    },

    flush() {
      if (sink) return flusher ? flusher() : Promise.resolve();
      // Changes are held for a host that is about to connect: wait for it to take and send them.
      if (binding !== null && held !== null) {
        return new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      }
      return Promise.resolve();
    },

    setHistory(next) {
      if (next === history) return;
      if (next && history && next.canUndo === history.canUndo && next.canRedo === history.canRedo && next.undo === history.undo && next.redo === history.redo) return;
      history = next;
      emit();
    },

    addRestoreTarget(target) {
      targets.add(target);
      if (syncTargets()) emit();
      return () => {
        if (!targets.delete(target)) return;
        if (syncTargets()) emit();
      };
    },

    revert() {
      if (!canRevert || edited === null) return null;
      const changed = edited;
      const opening = openingValues();
      // Only what changed goes back: a field nobody touched stays out of the save.
      const back = Object.fromEntries(Object.keys(changed).map((key) => [key, opening[key as keyof SaveFields]])) as SaveFields;
      apply(back);
      edited = null;
      syncCanRevert();
      emit();
      return changed;
    },

    restore(fields) {
      apply(fields);
      if (binding === null) return;
      edited = mergeFields(edited, fields);
      if (syncCanRevert()) emit();
    },

    replace(fields) {
      const mine = owned();
      if (binding === null || !Object.keys(fields).every((key) => mine.has(key))) return null;
      const current: SaveFields = { ...openingValues(), ...edited };
      const previous = Object.fromEntries(Object.keys(fields).map((key) => [key, current[key as keyof SaveFields]])) as SaveFields;
      apply(fields);
      edited = mergeFields(edited, fields);
      if (syncCanRevert()) emit();
      return previous;
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

    selectRailView(view) {
      let changed = false;
      if (view !== "preview" && view !== "original" && railTab !== view) {
        railTab = view;
        changed = true;
      }
      if (preview.open && preview.view !== view) {
        preview = { ...preview, view };
        changed = true;
      }
      if (changed) emit();
    },
    showComments() {
      let changed = false;
      if (railTab !== "comments") {
        railTab = "comments";
        changed = true;
      }
      if (preview.open && preview.view !== "comments") {
        preview = { ...preview, view: "comments" };
        changed = true;
      }
      if (!railOpen) {
        railOpen = true;
        changed = true;
      }
      if (changed) emit();
    },

    openPreview: () => setPreview({ open: true, view: "preview" }),
    openOriginal: () => setPreview({ open: true, view: "original" }),
    closePreview: () => setPreview({ open: false }),
    setPreview,
  };
}
