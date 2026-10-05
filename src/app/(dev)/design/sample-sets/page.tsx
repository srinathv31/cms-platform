import type { Metadata } from "next";
import { SampleSetsHarness } from "./harness";

export const metadata: Metadata = { title: "Sample sets" };

// Dev harness for the sample-set switcher and values editor, with fixture variables. Static page.
export default function SampleSetsPage() {
  return <SampleSetsHarness />;
}
