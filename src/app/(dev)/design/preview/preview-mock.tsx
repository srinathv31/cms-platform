"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ShellFrame, type Persona } from "../workspace/shell-frame";
import "../workspace/workspace-mock.css";
import { DevBar } from "./dev-bar";
import { ALL_CHANNELS, SAMPLE_SETS, TEMPLATE_NAME, VARIABLES, draftModel } from "./fixtures";
import { Workspace, type Shared } from "./layouts";
import { makeCtx } from "./render-doc";
import type { ChannelId, DeviceId, ModeId, PreviewControls, PreviewSet, VariantId } from "./types";
import type { TabId } from "../workspace/types";

const MAYA: Persona = { team: { name: "Coral Offers", icon: "gift" }, initials: "MC", hue: 28 };

export interface PreviewInitial {
  variant: VariantId;
  mode: ModeId;
  channel: ChannelId;
  device: DeviceId;
  setId: string;
  chrome: boolean;
}

export function PreviewMock({ doc, initial }: { doc: ReactNode; initial: PreviewInitial }) {
  const [variant, setVariant] = useState(initial.variant);
  const [previewing, setPreviewing] = useState(initial.mode === "preview");
  const [channel, setChannel] = useState(initial.channel);
  const [device, setDevice] = useState(initial.device);
  const [sets, setSets] = useState<PreviewSet[]>(SAMPLE_SETS);
  const [setId, setSetId] = useState(initial.setId);
  const [tab, setTab] = useState<TabId>("content");
  const [name, setName] = useState(TEMPLATE_NAME);
  const [channelsOn, setChannelsOn] = useState<ChannelId[]>(ALL_CHANNELS);

  const current = sets.find((s) => s.id === setId) ?? sets[0];
  const activeChannel = channelsOn.includes(channel) ? channel : channelsOn[0];

  const ctl: PreviewControls = {
    channels: channelsOn,
    channel: activeChannel,
    onChannel: setChannel,
    device,
    onDevice: setDevice,
    sets,
    setId: current.id,
    onSet: setSetId,
    onAddSet: () => {
      const n = sets.filter((s) => s.custom).length + 1;
      const added: PreviewSet = { id: `custom-${n}`, name: `Custom set ${n}`, values: { ...current.values }, custom: true };
      setSets([...sets, added]);
      setSetId(added.id);
    },
    onEditSet: (id, patch) => setSets((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s))),
  };

  const shared: Shared = {
    doc,
    model: draftModel(name, channelsOn),
    tab,
    onTab: setTab,
    onName: setName,
    channels: channelsOn,
    onChannels: setChannelsOn,
    previewing,
    onPreview: setPreviewing,
    ctl,
    ctx: makeCtx(VARIABLES, current.values),
  };

  return (
    <div className="bg-app" style={{ "--wm-dev-h": initial.chrome ? "2.5rem" : "0rem" } as CSSProperties}>
      {initial.chrome ? (
        <DevBar
          variant={variant}
          onVariant={setVariant}
          mode={previewing ? "preview" : "edit"}
          onMode={(m) => setPreviewing(m === "preview")}
          channel={activeChannel}
          onChannel={setChannel}
          device={device}
          onDevice={setDevice}
          setId={current.id}
          onSet={setSetId}
        />
      ) : null}
      <ShellFrame persona={MAYA}>
        <Workspace key={variant} variant={variant} s={shared} />
      </ShellFrame>
    </div>
  );
}
