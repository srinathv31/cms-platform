"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { m } from "motion/react";
import { spring } from "@/components/motion/presets";
import { cn } from "@/lib/utils";
import { TAB, TAB_ACTIVE, TAB_IDLE, TAB_LABEL, TAB_UNDERLINE } from "./tab-styles";

// View switches in the page (Overview | Consumers, Document | Preview, the review queue): Base UI Tabs
// in the tab idiom of the workspace tab bar (tab-styles.ts), with the underline sliding to the chosen
// tab. Base UI does the tablist's part: roles, `aria-selected`, `aria-controls`, one Tab stop, and the
// arrow keys (with Home and End) moving the choice along with focus.
//
//   <Tabs value={view} onValueChange={setView}>
//     <TabList label="View">
//       <Tab value="document">Document</Tab>
//       <Tab value="preview">Preview</Tab>
//     </TabList>
//     <TabPanel value="document">…</TabPanel>
//     <TabPanel value="preview">…</TabPanel>
//   </Tabs>
//
// Panels are optional: a bar whose views live elsewhere on the page gives each Tab the `id` and
// `aria-controls` that link it to its panel (review/view-tabs.tsx).

const Bar = createContext<{ value: string; underline: string } | null>(null);

/** The controlled root. The value is the chosen tab's. */
export function Tabs<T extends string>({
  value,
  onValueChange,
  className,
  children,
}: {
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  children: ReactNode;
}) {
  // One underline per bar: it slides between this bar's tabs and never to another bar's.
  const underline = useId();
  return (
    <TabsPrimitive.Root value={value} onValueChange={(next) => onValueChange(next as T)} className={className}>
      <Bar.Provider value={{ value, underline }}>{children}</Bar.Provider>
    </TabsPrimitive.Root>
  );
}

/** The bar: tabs 28px apart. Arrow keys choose as they move. */
export function TabList({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <TabsPrimitive.List aria-label={label} activateOnFocus className={cn("flex gap-7", className)}>
      {children}
    </TabsPrimitive.List>
  );
}

/** One tab. Its children are the label, and a count after it if there is one. */
export function Tab({
  value,
  className,
  children,
  ...props
}: Omit<TabsPrimitive.Tab.Props, "value" | "className" | "children"> & {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const bar = useContext(Bar);
  const active = bar !== null && bar.value === value;
  return (
    <TabsPrimitive.Tab {...props} value={value} className={cn(TAB, active ? TAB_ACTIVE : TAB_IDLE, className)}>
      <span className={TAB_LABEL}>{children}</span>
      {active ? <TabUnderline layoutId={bar.underline} /> : null}
    </TabsPrimitive.Tab>
  );
}

/** The chosen tab's underline. Tabs that share a `layoutId` slide it between them (links that look like tabs use it too). */
export function TabUnderline({ layoutId }: { layoutId: string }) {
  return <m.span layoutId={layoutId} transition={spring.soft} className={TAB_UNDERLINE} />;
}

/**
 * A tab's panel. Unmounted while another tab is chosen, unless `keepMounted` (then hidden, and its state
 * kept). It takes focus only from code, not from Tab: what is in it is reachable on its own.
 */
export function TabPanel({
  className,
  ...props
}: Omit<TabsPrimitive.Panel.Props, "className"> & { className?: string }) {
  return <TabsPrimitive.Panel tabIndex={-1} {...props} className={cn("outline-none", className)} />;
}
