"use client";

import { useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@/components/primitives/tabs";

// Overview | Consumers, the app's tabs (`Tabs`). Both panels are rendered by the server and handed in;
// the inactive one is hidden, not unmounted, so the consumers filter keeps its state while you look at
// the overview.

type TabId = "overview" | "consumers";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "consumers", label: "Consumers" },
];

export function UsageTabs({
  overview,
  consumers,
  initial = "overview",
}: {
  overview: React.ReactNode;
  consumers: React.ReactNode;
  /** From `?tab=`, so a reload or a shared link keeps the tab. */
  initial?: TabId;
}) {
  const [value, setValue] = useState<TabId>(initial);
  const choose = (id: TabId) => {
    setValue(id);
    // The URL follows the tab without a navigation. Pass `null` as the state: Next patches
    // replaceState and syncs the router (useSearchParams, refresh()) only for calls without its own
    // internal marker, so handing back `window.history.state` would let the next refresh revert `?tab=`.
    const params = new URLSearchParams(window.location.search);
    if (id === "overview") params.delete("tab");
    else params.set("tab", id);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  };

  return (
    <Tabs value={value} onValueChange={choose}>
      <TabList label="Usage" className="border-b border-hairline">
        {TABS.map((tab) => (
          <Tab key={tab.id} value={tab.id}>
            {tab.label}
          </Tab>
        ))}
      </TabList>
      {TABS.map((tab) => (
        <TabPanel key={tab.id} value={tab.id} keepMounted className="mt-9">
          {tab.id === "overview" ? overview : consumers}
        </TabPanel>
      ))}
    </Tabs>
  );
}
