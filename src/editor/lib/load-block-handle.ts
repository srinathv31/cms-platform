// Loads the block handle (components/block-handle.tsx) on the client only, ahead of the editor that
// shows it.
//
// The official DragHandle pulls in Yjs, whose lib0 probes `localStorage` when its module evaluates,
// and on Node 26 that probe prints an ExperimentalWarning during prerender. The handle only renders
// with the live editor (client-only), so the server never needs it. The browser starts the load as
// this module evaluates, and the live editor waits for it (`useBlockHandleSettled`), so the handle
// mounts in the same commit as the editor: registering its plugin later would reconfigure the view
// and close a slash menu that is already open.
//
// The handle is optional chrome: if its chunk fails to load (a network blip, a redeploy under an
// open tab), the editor mounts without it, still editable, and the next editor mounted tries again.

import { useEffect, useState } from "react";

export type BlockHandleModule = typeof import("../components/block-handle");

let blockHandleModule: BlockHandleModule | null = null;
let blockHandleLoad: Promise<BlockHandleModule | null> | null = null;

/** The block handle's module, or null when it failed to load. Never rejects. */
export function loadBlockHandle(): Promise<BlockHandleModule | null> {
  blockHandleLoad ??= import("../components/block-handle").then(
    (m) => (blockHandleModule = m),
    () => {
      blockHandleLoad = null;
      return null;
    },
  );
  return blockHandleLoad;
}

/** The module once it has loaded; null before that, after a failed load, and on the server. */
export function loadedBlockHandle(): BlockHandleModule | null {
  return blockHandleModule;
}

if (typeof window !== "undefined") void loadBlockHandle();

/** True once the block handle's load has settled, loaded or failed (never on the server). */
export function useBlockHandleSettled(): boolean {
  const [settled, setSettled] = useState(blockHandleModule !== null);
  useEffect(() => {
    if (settled) return;
    let live = true;
    void loadBlockHandle().then(() => live && setSettled(true));
    return () => {
      live = false;
    };
  }, [settled]);
  return settled;
}
