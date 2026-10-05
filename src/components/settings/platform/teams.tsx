"use client";

import { useId, useRef, useState } from "react";
import {
  Briefcase,
  Building2,
  Car,
  CreditCard,
  Home,
  Landmark,
  Megaphone,
  PiggyBank,
  Plus,
  ReceiptText,
  Scale,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { TeamsSection } from "@/domain/access-types";
import {
  PLATFORM_REFUSALS,
  RESERVED_SLUGS,
  TEAM_DESCRIPTION_MAX,
  TEAM_NAME_MAX,
  slugify,
} from "@/domain/platform-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createTeam } from "@/server/actions/platform";
import { cn } from "@/lib/utils";
import { HeaderRow, PersonLine, Pick, Strip, plural, useFocusAfterCommit } from "./ui";

// Settings > Platform > Teams (Platform Admin). A dense table of the teams, and a "Create team" form
// that opens above it: name, an optional description, an icon, and the first Team Admin. The strip says
// what creating it does before it is committed.

const ICONS: Record<string, { Icon: LucideIcon; label: string }> = {
  "credit-card": { Icon: CreditCard, label: "Credit card" },
  "piggy-bank": { Icon: PiggyBank, label: "Piggy bank" },
  "receipt-text": { Icon: ReceiptText, label: "Receipt" },
  landmark: { Icon: Landmark, label: "Bank" },
  wallet: { Icon: Wallet, label: "Wallet" },
  home: { Icon: Home, label: "Home" },
  car: { Icon: Car, label: "Car" },
  briefcase: { Icon: Briefcase, label: "Briefcase" },
  "shield-check": { Icon: ShieldCheck, label: "Shield" },
  scale: { Icon: Scale, label: "Scale" },
  megaphone: { Icon: Megaphone, label: "Megaphone" },
  "building-2": { Icon: Building2, label: "Building" },
};

function GlyphFor({ name, className }: { name: string; className?: string }) {
  const Icon = (ICONS[name]?.Icon ?? Building2) as LucideIcon;
  return <Icon aria-hidden strokeWidth={1.75} className={className} />;
}

const COLS = "minmax(0,1.5fr) minmax(0,1.2fr) 5rem 5rem";

export function TeamsSectionView({ section }: { section: TeamsSection }) {
  const [creating, setCreating] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const focusAfter = useFocusAfterCommit();

  const close = () => {
    focusAfter(() => opener.current);
    setCreating(false);
  };

  return (
    <div data-slot="platform-section" data-section="teams">
      <div className="mb-4 flex h-8 items-center justify-between">
        <span className="text-[14px] text-text-muted">{plural(section.teams.length, "team")}</span>
        {creating ? null : (
          <Button ref={opener} variant="outline" onClick={() => setCreating(true)}>
            <Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />
            Create team
          </Button>
        )}
      </div>

      {creating ? <CreateTeam section={section} onClose={close} /> : null}

      <div role="table" aria-label="Teams">
        <HeaderRow cols={COLS} columns={["Team", "Team Admin", "Members", "Templates"]} />
        {section.teams.map((team) => (
          <div key={team.id} role="row" className="grid min-h-16 items-center gap-x-4 border-b border-hairline py-2.5" style={{ gridTemplateColumns: COLS }}>
            <div role="cell" className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-chip text-chip-icon">
                <GlyphFor name={team.icon} className="size-[18px]" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium text-text">{team.name}</div>
                {team.description ? <div className="truncate text-[13px] text-text-muted">{team.description}</div> : null}
              </div>
            </div>
            <div role="cell" className="flex min-w-0 flex-col gap-1 text-[14px] text-text">
              {team.admins.length ? team.admins.map((a) => <PersonLine key={a.id} person={a} />) : <span className="text-text-muted">None</span>}
            </div>
            <div role="cell" className="text-[14px] text-text tabular-nums">{team.members}</div>
            <div role="cell" className="text-[14px] text-text tabular-nums">{team.templates}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateTeam({ section, onClose }: { section: TeamsSection; onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("building-2");
  const [adminId, setAdminId] = useState("");

  const trimmed = name.trim().replace(/\s+/g, " ");
  const admin = section.people.find((p) => p.id === adminId);
  const slug = slugify(trimmed);
  const taken = section.teams.find((t) => t.slug === slug || t.name.toLowerCase() === trimmed.toLowerCase());
  const problem: string | null = !trimmed
    ? null
    : trimmed.length > TEAM_NAME_MAX
      ? PLATFORM_REFUSALS.teamNameTooLong
      : !slug || RESERVED_SLUGS.has(slug)
        ? PLATFORM_REFUSALS.reservedName(trimmed)
        : taken
          ? PLATFORM_REFUSALS.teamTaken(taken.name)
          : description.trim().length > TEAM_DESCRIPTION_MAX
            ? PLATFORM_REFUSALS.descriptionTooLong
            : null;
  const ready = !!trimmed && !!admin && !problem;
  const id = useId();

  return (
    <form
      aria-label="Create team"
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
      className="mb-6 flex flex-col gap-3 rounded-xl border border-hairline p-4"
    >
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-[13px] text-text-muted">
            Team name
          </label>
          <Input
            id={`${id}-name`}
            data-autofocus=""
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={problem ? true : undefined}
            className="bg-surface"
          />
        </div>
        <div className="flex w-56 flex-col gap-1.5">
          <span aria-hidden className="text-[13px] text-text-muted">
            First Team Admin
          </span>
          <Pick label="First Team Admin" value={adminId} onChange={setAdminId} className="w-full">
            <option value="" disabled>
              Pick a person
            </option>
            {section.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Pick>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-description`} className="text-[13px] text-text-muted">
          Description (optional)
        </label>
        <Input
          id={`${id}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          className="bg-surface"
        />
      </div>
      <ToggleGroup
        aria-label="Icon"
        value={[icon]}
        onValueChange={(next) => {
          const picked = next[0];
          if (picked) setIcon(picked);
        }}
        spacing={0.5}
        className="h-8 w-fit rounded-lg border border-hairline bg-surface p-0.5"
      >
        {section.icons.map((key) => (
          <ToggleGroupItem
            key={key}
            value={key}
            aria-label={ICONS[key]?.label ?? key}
            className={cn(
              "size-6 min-w-0 rounded-md border-0 px-0 text-text-muted hover:bg-hover hover:text-text",
              "aria-pressed:bg-selected aria-pressed:text-text aria-pressed:hover:bg-selected",
            )}
          >
            <GlyphFor name={key} className="size-4" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {ready && admin ? (
        <Strip
          key={`${trimmed}:${adminId}`}
          focusOnMount={false}
          lines={[
            `${admin.name} becomes Team Admin of ${trimmed} and approves its access requests.`,
            `${trimmed} starts with no templates.`,
          ]}
          confirmLabel="Create team"
          onCancel={onClose}
          onDone={onClose}
          onConfirm={() => createTeam({ name: trimmed, description: description.trim(), icon, adminUserId: admin.id })}
          className="bg-surface-sunken"
        />
      ) : (
        <div className="flex items-center justify-end gap-2">
          {problem ? <p role="alert" className="mr-auto text-[13px] text-danger-text">{problem}</p> : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
