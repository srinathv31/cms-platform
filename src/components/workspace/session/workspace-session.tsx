"use client";

import { createContext, use, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useDraftAutosave } from "../autosave/use-draft-autosave";
import {
  createWorkspaceSession,
  INITIAL_PREVIEW,
  type DraftBinding,
  type HistoryControls,
  type PreviewState,
  type RailTab,
  type SessionStatus,
  type WorkspaceSession,
} from "./session-store";

const SessionContext = createContext<WorkspaceSession | null>(null);

/**
 * Wraps the workspace layout. It carries no data of its own: the Content page tells it which draft
 * is editable (`bind`), and the provider then runs ONE autosave session for that draft, which the
 * editor, the variables, the channels and the name field all save through. It sits in the layout, so
 * the session lives as long as the workspace does: switching tabs doesn't end it, and the pending
 * save of a hidden Content tab still goes out.
 */
export function WorkspaceSessionProvider({ children }: { children: React.ReactNode }) {
  const [session] = useState(createWorkspaceSession);
  return (
    <SessionContext value={session}>
      <SessionHostSlot session={session} />
      {children}
    </SessionContext>
  );
}

function SessionHostSlot({ session }: { session: WorkspaceSession }) {
  const binding = useSyncExternalStore(session.subscribe, session.getBinding, () => null);
  // A new version is a new autosave session, so it is a new host.
  return binding ? <DraftSessionHost key={binding.versionId} session={session} binding={binding} /> : null;
}

/** Runs the autosave hook for one draft and hands its `save`, `flush` and status to the store. Renders nothing. */
function DraftSessionHost({ session, binding }: { session: WorkspaceSession; binding: DraftBinding }) {
  const { save, flush, status, error } = useDraftAutosave({ versionId: binding.versionId, initialRev: binding.rev });

  // Layout effect: changes held while this host was mounting go out before the browser paints.
  useLayoutEffect(() => {
    session.attach(save, flush);
    return () => session.attach(null);
  }, [session, save, flush]);

  useLayoutEffect(() => {
    session.publishStatus(error === undefined ? { status } : { status, error });
  }, [session, status, error]);

  return null;
}

export function useWorkspaceSession(): WorkspaceSession {
  const session = use(SessionContext);
  if (!session) throw new Error("useWorkspaceSession must be used inside <WorkspaceSessionProvider>.");
  return session;
}

const SAVED: SessionStatus = { status: "saved" };

/** The autosave status of the draft on screen. "saved" before a draft is bound. */
export function useSaveStatus(): SessionStatus {
  const session = useWorkspaceSession();
  return useSyncExternalStore(session.subscribe, session.getStatus, () => SAVED);
}

export function useRailOpen(): boolean {
  const session = useWorkspaceSession();
  return useSyncExternalStore(session.subscribe, session.getRailOpen, () => false);
}

/** The tab the author picked in the rail (Comments | Variables), or null until they pick one. */
export function useRailTab(): RailTab | null {
  const session = useWorkspaceSession();
  return useSyncExternalStore(session.subscribe, session.getRailTab, () => null);
}

/** The preview's state (open, view, channel, sample set, device), shared by the tab bar and the rail. */
export function usePreviewState(): PreviewState {
  const session = useWorkspaceSession();
  return useSyncExternalStore(session.subscribe, session.getPreview, () => INITIAL_PREVIEW);
}

/** Counts the saves that have landed; a change means the saved draft is different now. */
export function useSaveTick(): number {
  const session = useWorkspaceSession();
  return useSyncExternalStore(session.subscribe, session.getSaveTick, () => 0);
}

/** Undo and redo for the header's buttons, or null when no editor is on screen. */
export function useHistoryControls(): HistoryControls | null {
  const session = useWorkspaceSession();
  return useSyncExternalStore(session.subscribe, session.getHistory, () => null);
}

/** "Revert to when you opened it" can be offered: something changed, and all of it can be put back. */
export function useCanRevert(): boolean {
  const session = useWorkspaceSession();
  return useSyncExternalStore(session.subscribe, session.getCanRevert, () => false);
}

/**
 * The page is held still (`session.makeInert`): Submit is reading or freezing the saved draft. Every
 * part that edits the draft shows it read-only meanwhile, and is editable again once it is let go.
 */
export function useInert(): boolean {
  const session = useWorkspaceSession();
  return useSyncExternalStore(session.subscribe, session.getInert, () => false);
}

/** Some part of the page on screen can show other values of every one of `fields` (the Content tab, editable, for the content fields). */
export function useOwnsFields(fields: readonly string[]): boolean {
  const session = useWorkspaceSession();
  const owned = useSyncExternalStore(session.subscribe, session.getOwnedFields, () => "");
  const set = new Set(owned.split(","));
  return fields.every((field) => set.has(field));
}
