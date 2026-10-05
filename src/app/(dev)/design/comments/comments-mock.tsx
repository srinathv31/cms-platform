"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ShellFrame, type Persona } from "../workspace/shell-frame";
import "../workspace/workspace-mock.css";
import { DevBar } from "./dev-bar";
import { HIGHLIGHT_CSS } from "./highlight-css";
import { BLOCK_ANCHOR, COMPOSE_ANCHOR, JORDAN, MAYA, authorThreads, reviewThreads } from "./fixtures";
import { ReviewFrame } from "./review-frame";
import { StoreProvider } from "./store";
import type { ComposeId, ScreenId, VariantId } from "./types";
import { AuthorWorkspace } from "./workspace";

const MAYA_SHELL: Persona = { team: { name: "Coral Offers", icon: "gift" }, initials: "MC", hue: 28 };
const JORDAN_SHELL: Persona = { team: { name: "Coral Offers", icon: "gift" }, initials: "JE", hue: 212 };

export interface CommentsInitial {
  variant: VariantId;
  screen: ScreenId;
  /** Start with a thread active (its block and quote highlighted). */
  thread: "open" | "none";
  compose: ComposeId;
  resolved: boolean;
  chrome: boolean;
}

export function CommentsMock({ doc, initial }: { doc: ReactNode; initial: CommentsInitial }) {
  const [variant, setVariant] = useState(initial.variant);
  const [screen, setScreen] = useState(initial.screen);
  const [resolvedOpen, setResolvedOpen] = useState(initial.resolved);
  // Reset (and a change of screen) starts the threads over; a change of variant keeps them.
  const [round, setRound] = useState(0);

  const review = screen === "review";
  const seed = review ? reviewThreads() : authorThreads();
  const activeSeed = review ? "t-apr" : "t-spend";

  return (
    <div className="bg-app" style={{ "--wm-dev-h": initial.chrome ? "2.5rem" : "0rem" } as CSSProperties}>
      <style>{HIGHLIGHT_CSS}</style>
      {initial.chrome ? (
        <DevBar
          variant={variant}
          onVariant={setVariant}
          screen={screen}
          onScreen={(next) => {
            setScreen(next);
            setRound((r) => r + 1);
          }}
          onReset={() => setRound((r) => r + 1)}
        />
      ) : null}
      <ShellFrame persona={review ? JORDAN_SHELL : MAYA_SHELL}>
        <StoreProvider
          key={`${screen}:${round}`}
          seed={seed}
          me={review ? JORDAN : MAYA}
          initialActive={initial.thread === "open" && round === 0 ? activeSeed : null}
          initialPending={round !== 0 ? null : initial.compose === "open" ? COMPOSE_ANCHOR : initial.compose === "block" ? BLOCK_ANCHOR : null}
          startSelected={round === 0 && initial.compose === "selection"}
        >
          {review ? (
            <ReviewFrame doc={doc} resolvedOpen={resolvedOpen} onResolvedOpen={setResolvedOpen} />
          ) : (
            <AuthorWorkspace
              key={variant}
              variant={variant}
              doc={doc}
              resolvedOpen={resolvedOpen}
              onResolvedOpen={setResolvedOpen}
            />
          )}
        </StoreProvider>
      </ShellFrame>
    </div>
  );
}
