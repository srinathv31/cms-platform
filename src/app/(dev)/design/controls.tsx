import { ArrowUpRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Keycap, Shortcut } from "@/components/primitives/keycap";
import { StatusBadge } from "@/components/primitives/status-badge";
import type { VersionState } from "@/domain/types";
import { Code, Group } from "./section";

// ── Status badges ─────────────────────────────────────────────

const STATES: VersionState[] = [
  "draft",
  "in_review",
  "changes_requested",
  "active",
  "superseded",
  "revoked",
];

// A fixed date: `new Date()` with no arguments is not allowed while prerendering.
const SUNSET = "2027-03-01";

export function StatusBadges() {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline p-0 md:grid-cols-4">
      {STATES.map((state) => (
        <li key={state} className="flex flex-col items-start gap-3 bg-surface px-6 py-5">
          <StatusBadge state={state} />
          <Code>{state}</Code>
        </li>
      ))}
      <li className="flex flex-col items-start gap-3 bg-surface px-6 py-5">
        <StatusBadge state="superseded" sunsetDay={SUNSET} />
        <Code>superseded + sunsetAt</Code>
      </li>
      <li aria-hidden className="bg-surface" />
    </ul>
  );
}

// ── Buttons ───────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-x-6 gap-y-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <span className="text-[13px] leading-5 text-text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function Buttons() {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-8">
      <Row label="Variants">
        <Button size="lg">Publish version</Button>
        <Button size="lg" variant="outline">
          Save draft
        </Button>
        <Button size="lg" variant="secondary">
          Request review
        </Button>
        <Button size="lg" variant="ghost">
          Cancel
        </Button>
        <Button size="lg" variant="destructive">
          Revoke
        </Button>
      </Row>
      <Row label="Sizes">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
        <Button size="icon" variant="outline" aria-label="New template">
          <Plus />
        </Button>
      </Row>
      <Row label="With icon">
        <Button size="lg">
          <Plus data-icon="inline-start" />
          New template
        </Button>
        <Button size="lg" variant="outline">
          Open preview
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      </Row>
      <Row label="With shortcut">
        <Button
          size="lg"
          className="gap-2.5 pr-2 [&_[data-slot=kbd]]:border-primary-foreground/20 [&_[data-slot=kbd]]:bg-primary-foreground/10 [&_[data-slot=kbd]]:text-primary-foreground/70"
        >
          Submit for review
          <Shortcut keys={["⌘", "↵"]} />
        </Button>
        <Button size="lg" variant="outline" className="gap-2.5 pr-2">
          Search
          <Shortcut keys={["⌘", "K"]} />
        </Button>
      </Row>
      <Row label="Shape">
        <Button size="lg">8px control radius (shadcn default)</Button>
        <Button size="lg" className="rounded-full px-4">
          Full pill
        </Button>
      </Row>
    </div>
  );
}

// ── Keycaps & controls ────────────────────────────────────────

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group title={label} className="gap-3">
      {children}
    </Group>
  );
}

export function Controls() {
  return (
    <div className="grid gap-x-10 gap-y-9 rounded-2xl border border-hairline bg-surface p-8 md:grid-cols-2 xl:grid-cols-3">
      <Cell label="Keycaps">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Shortcut keys={["⌘", "K"]} />
          <Shortcut keys={["⌥", "Opt"]} />
          <Keycap>/</Keycap>
          <Shortcut keys={["⇧", "⌘", "P"]} />
        </div>
      </Cell>

      <Cell label="Switch">
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 text-[14px] leading-5 text-text">
            <Switch defaultChecked /> Require review before publishing
          </label>
          <label className="flex items-center gap-3 text-[14px] leading-5 text-text">
            <Switch /> Notify subscribers
          </label>
        </div>
      </Cell>

      <Cell label="Input">
        <div className="relative">
          <Search
            aria-hidden
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-subtle"
          />
          <Input aria-label="Search templates" placeholder="Search templates" className="h-9 bg-surface pl-8" />
        </div>
      </Cell>

      <Cell label="Select">
        <Select
          defaultValue="all"
          items={[
            { value: "all", label: "All teams" },
            { value: "coral-offers", label: "Coral Offers" },
            { value: "deposits", label: "Deposits" },
            { value: "card-statements", label: "Card Statements" },
          ]}
        >
          <SelectTrigger aria-label="Team" className="h-9 w-full max-w-64 bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value="all">All teams</SelectItem>
            <SelectItem value="coral-offers">Coral Offers</SelectItem>
            <SelectItem value="deposits">Deposits</SelectItem>
            <SelectItem value="card-statements">Card Statements</SelectItem>
          </SelectContent>
        </Select>
      </Cell>

      <Cell label="Toggle group">
        <ToggleGroup
          aria-label="Library filter"
          variant="outline"
          spacing={0}
          defaultValue={["all"]}
          className="bg-surface"
        >
          <ToggleGroupItem value="all" className="h-9 px-3.5">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="mine" className="h-9 px-3.5">
            Mine
          </ToggleGroupItem>
          <ToggleGroupItem value="shared" className="h-9 px-3.5">
            Shared
          </ToggleGroupItem>
        </ToggleGroup>
      </Cell>
    </div>
  );
}
