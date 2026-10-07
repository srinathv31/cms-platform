"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Variable } from "@/editor/model/types";
import { DevBar } from "./dev-bar";
import {
  CORAL_NAME,
  CORAL_VARIABLES,
  DEFAULT_CHANNELS,
  DEPOSITS_VARIABLES,
  modelFor,
} from "./fixtures";
import { ColumnLayout } from "./layout-column";
import { GridLayout } from "./layout-grid";
import { RailLayout } from "./layout-rail";
import { ShellFrame, type Persona } from "./shell-frame";
import type { ChannelId, FrameProps, HeadsId, LayoutId, TabId, ViewId } from "./types";
import "./workspace-mock.css";

const MAYA: Persona = { team: { name: "Coral Offers", icon: "gift" }, initials: "MC", hue: 28 };
const PRIYA: Persona = { team: { name: "Deposits", icon: "piggy-bank" }, initials: "PR", hue: 300 };

export interface MockInitial {
  layout: LayoutId;
  heads: HeadsId;
  view: ViewId;
  chrome: boolean;
}

export function WorkspaceMock({
  docs,
  uses,
  initial,
}: {
  docs: Record<"coral" | "deposits", ReactNode>;
  uses: Record<"coral" | "deposits", Record<string, number>>;
  initial: MockInitial;
}) {
  const [layout, setLayout] = useState(initial.layout);
  const [heads, setHeads] = useState(initial.heads);
  const [view, setView] = useState(initial.view);
  const [tab, setTab] = useState<TabId>("content");
  const [name, setName] = useState(CORAL_NAME);
  const [channels, setChannels] = useState<ChannelId[]>(DEFAULT_CHANNELS);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Every edit autosaves: "Saving…" for a moment, then back to "Saved". */
  const touch = () => {
    setSaving(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaving(false), 900);
  };

  const model = modelFor(view, name, channels);
  const variables: Variable[] = model.docKey === "coral" ? CORAL_VARIABLES : DEPOSITS_VARIABLES;

  const frame: FrameProps = {
    model,
    doc: docs[model.docKey],
    variables,
    uses: uses[model.docKey],
    heads,
    tab,
    onTab: setTab,
    onName: (next) => {
      setName(next);
      touch();
    },
    onEdit: () => setView("draft"),
    onChannels: (next) => {
      setChannels(next);
      touch();
    },
    saving,
  };

  const Layout = layout === "grid" ? GridLayout : layout === "column" ? ColumnLayout : RailLayout;

  return (
    <div
      className="bg-app"
      style={{ "--wm-dev-h": initial.chrome ? "2.5rem" : "0rem" } as CSSProperties}
    >
      {initial.chrome ? (
        <DevBar
          layout={layout}
          onLayout={setLayout}
          heads={heads}
          onHeads={setHeads}
          view={view}
          onView={setView}
        />
      ) : null}
      <ShellFrame persona={view === "view" ? PRIYA : MAYA}>
        <Layout key={layout} {...frame} />
      </ShellFrame>
    </div>
  );
}
