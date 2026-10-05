"use client";

import { useRef, useState } from "react";
import type { SampleSet, Variable } from "@/editor";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SampleSetSwitcher, listSets, resolveSetValues, type SampleSetSwitcherHandle } from "@/components/preview/sample-sets";

const TODAY = "2026-10-04";

const BASE: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "last_name", label: "Last name", type: "text", required: true, sample: "Patel" },
  { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
  { key: "bonus_points", label: "Bonus points", type: "number", required: true, sample: "20000" },
  { key: "offer_end_date", label: "Offer end date", type: "date", required: true, sample: "2027-03-04" },
  { key: "home_state", label: "Home state", type: "us_state", required: true, sample: "NJ" },
  { key: "promo_code", label: "Promo code", type: "text", required: false, sample: "" },
];

/** More variables than the popover has room for, to see it scroll. */
const MANY: Variable[] = [
  ...BASE,
  ...Array.from({ length: 12 }, (_, i): Variable => ({
    key: `extra_field_${i + 1}`,
    label: `Extra field number ${i + 1}`,
    type: i % 2 ? "number" : "text",
    required: false,
    sample: i % 2 ? "100" : "Sample text",
  })),
];

/** The switcher in a controls row like the preview's, with its state kept here. */
export function SampleSetsHarness() {
  const [stored, setStored] = useState<SampleSet[]>([]);
  const [selectedId, setSelectedId] = useState("typical");
  const [readOnly, setReadOnly] = useState(false);
  const [many, setMany] = useState(false);
  const VARIABLES = many ? MANY : BASE;
  const ref = useRef<SampleSetSwitcherHandle>(null);

  const sets = listSets(stored, VARIABLES, TODAY);
  const selected = sets.find((s) => s.id === selectedId) ?? sets[0];

  return (
    <main className="mx-auto w-full max-w-[34rem] px-6 py-10">
      <div className="flex items-center gap-1">
        <ToggleGroup aria-label="Channel" value={["pdf"]} spacing={1}>
          {["PDF", "Web", "Email"].map((label) => (
            <ToggleGroupItem
              key={label}
              value={label.toLowerCase()}
              className="h-7 rounded-md border-0 px-2.5 text-[13px] font-medium text-text-muted aria-pressed:bg-selected aria-pressed:text-text"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <SampleSetSwitcher
          ref={ref}
          sets={sets}
          variables={VARIABLES}
          today={TODAY}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={readOnly ? undefined : setStored}
          readOnly={readOnly}
          className="ml-2"
        />
      </div>

      <div className="mt-8 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => ref.current?.openEditor()}>
          Edit values (imperative)
        </Button>
        <Button variant="outline" size="sm" onClick={() => setReadOnly((value) => !value)} aria-pressed={readOnly}>
          Read only: {readOnly ? "on" : "off"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMany((value) => !value)} aria-pressed={many}>
          Many variables: {many ? "on" : "off"}
        </Button>
      </div>

      <h2 className="caps-label mt-8">Resolved values: {selected.name}</h2>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs text-text-muted">
        {JSON.stringify(resolveSetValues(selected, VARIABLES, TODAY), null, 2)}
      </pre>
      <h2 className="caps-label mt-6">Stored sets: {stored.length}</h2>
    </main>
  );
}
