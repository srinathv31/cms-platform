"use client";

import { createContext, use, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useDraftAutosave } from "../autosave/use-draft-autosave";
import {
  createWorkspaceSession,
  type DraftBinding,
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

/** Runs the autosave hook for one draft and hands its `save` and status to the store. Renders nothing. */
function DraftSessionHost({ session, binding }: { session: WorkspaceSession; binding: DraftBinding }) {
  const { save, status, error } = useDraftAutosave({ versionId: binding.versionId, initialRev: binding.rev });

  // Layout effect: changes held while this host was mounting go out before the browser paints.
  useLayoutEffect(() => {
    session.attach(save);
    return () => session.attach(null);
  }, [session, save]);

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
