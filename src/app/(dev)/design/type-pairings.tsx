import type { CSSProperties } from "react";
import { Percent, Type } from "lucide-react";
import { StatCard, StatLabel, StatTrend, StatValue } from "@/components/primitives/stat-card";
import { StatusBadge } from "@/components/primitives/status-badge";
import type { VersionState } from "@/domain/types";

/*
 * One pairing, shown on real UCOMP content. Fonts are scoped to the column by
 * redefining the two family tokens locally, so `font-sans`, `.display-xl` and
 * `.display-lg` inside it pick up this pairing whatever the app-wide toggle says.
 */

const PAIRINGS = {
  b: {
    letter: "B",
    name: "Newsreader + Figtree",
    display: "var(--ff-newsreader), ui-serif, Georgia, serif",
    sans: "var(--ff-figtree), ui-sans-serif, system-ui, sans-serif",
  },
} as const;

function VariableChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="mx-px inline-flex items-center gap-1 rounded-md border border-chip-border bg-chip px-1.5 py-px align-baseline text-[0.9em] leading-[1.45] font-medium text-chip-text">
      <span aria-hidden className="text-chip-icon [&>svg]:size-3.5 [&>svg]:[stroke-width:1.75]">
        {icon}
      </span>
      {children}
    </span>
  );
}

function LibraryRow({
  name,
  state,
  version,
  edited,
  owner,
}: {
  name: string;
  state: VersionState;
  version: string;
  edited: string;
  owner: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-surface-tinted px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-[15px] leading-6 font-medium text-text">{name}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[13px] leading-5 text-text-muted">
          <span>{edited}</span>
          <span aria-hidden className="size-0.5 rounded-full bg-text-subtle" />
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-grid size-5 place-items-center rounded-full bg-tan text-[10px] font-medium text-label"
            >
              {owner[0]}
            </span>
            {owner}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-[13px] leading-5 text-text-muted tabular-nums">{version}</span>
        <StatusBadge state={state} />
      </div>
    </li>
  );
}

export function PairingSpecimen({ pairing }: { pairing: keyof typeof PAIRINGS }) {
  const p = PAIRINGS[pairing];
  return (
    <article
      aria-label={`Pairing ${p.letter}: ${p.name}`}
      className="flex min-w-0 flex-col gap-9 rounded-2xl border border-hairline bg-surface p-8 font-sans"
      style={{ "--ui-font-display": p.display, "--ui-font-sans": p.sans } as CSSProperties}
    >
      <header className="flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-2.5 text-[13px] font-medium text-text">
          <span
            aria-hidden
            className="inline-grid size-6 place-items-center rounded-full bg-primary text-[12px] text-primary-foreground"
          >
            {p.letter}
          </span>
          {p.name}
        </span>
        <span className="font-mono text-[12px] text-text-subtle">+ Geist Mono</span>
      </header>

      <div>
        <h3 className="display-xl text-text">Library</h3>
        <p className="mt-1 text-[15px] leading-6 text-text-muted">
          Every disclosure template your teams manage.
        </p>
      </div>

      <StatCard>
        <StatValue value="12,480" trend={<StatTrend pct={12} />} />
        <StatLabel className="mt-3">Renders this month</StatLabel>
      </StatCard>

      <div className="flex flex-col gap-4">
        <h4 className="display-lg text-text">Recently edited</h4>
        <ul className="flex flex-col gap-2.5">
          <LibraryRow
            name="Coral Rewards card disclosure"
            state="active"
            version="v2"
            edited="Edited 2 hours ago"
            owner="Maya"
          />
          <LibraryRow
            name="Savings account fee schedule"
            state="in_review"
            version="v3"
            edited="Edited yesterday"
            owner="Jordan"
          />
        </ul>
      </div>

      <div className="rounded-xl border border-hairline bg-canvas px-6 py-5">
        <h4 className="text-[17px] leading-6 font-medium text-text">Offer details</h4>
        <p className="mt-2 text-[15px] leading-[1.75] text-text">
          Hi <VariableChip icon={<Type />}>First name</VariableChip>, spend $1,000 in your first three
          months and earn a $200 statement credit. Your purchase APR is{" "}
          <VariableChip icon={<Percent />}>Purchase APR</VariableChip>.
        </p>
      </div>
    </article>
  );
}
