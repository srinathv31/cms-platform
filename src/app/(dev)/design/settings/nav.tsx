"use client";

import { cn } from "@/lib/utils";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";
import { SETTINGS_GROUPS, type SettingsGroup, type SettingsGroupKey } from "@/components/settings/sections";
import { INACTIVE_FLAG_DAYS, REQUESTS } from "./data";
import { useStore } from "./store";

export type NavVariant = "a" | "b" | "c";
export type Viewer = "both" | "alex" | "riley";

export function visibleFor(viewer: Viewer): SettingsGroup[] {
  return SETTINGS_GROUPS.filter((g) => (g.key === "team" ? viewer !== "riley" : viewer !== "alex"));
}

const VERSION = "UCOMP · v0.1 prototype";

function Row({
  icon: Icon,
  label,
  active,
  trail,
  onClick,
}: {
  icon: SettingsGroup["sections"][number]["icon"];
  label: string;
  active: boolean;
  trail?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(
          "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-selected font-medium hover:bg-selected",
        )}
      >
        <Icon aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-5 text-text-muted" />
        <span className="flex-1 truncate">{label}</span>
        {trail ? <span className="text-[13px] font-normal text-text-muted tabular-nums">{trail}</span> : null}
      </button>
    </li>
  );
}

function useTrail() {
  const s = useStore();
  const requests = REQUESTS.filter((r) => !s.reqs[r.id]).length;
  const flagged = s.members.filter((m) => m.lastActive <= -60 && s.idleDays(m.id) >= INACTIVE_FLAG_DAYS && !(m.id in s.suspended)).length;
  const confirmed = s.members.filter((m) => s.recertState(m.id) === "confirmed").length;
  return (key: string): string | undefined => {
    if (key === "access-requests" && requests) return String(requests);
    if (key === "inactivity" && flagged) return String(flagged);
    if (key === "recertification") return `${confirmed}/${s.members.length}`;
    return undefined;
  };
}

export function SettingsNav({
  variant,
  viewer,
  section,
  onSelect,
}: {
  variant: NavVariant;
  viewer: Viewer;
  section: string;
  onSelect: (key: string) => void;
}) {
  const groups = visibleFor(viewer);
  const trail = useTrail();
  const activeGroup = groups.find((g) => g.sections.some((x) => x.key === section))?.key ?? groups[0]!.key;
  const scope = (key: SettingsGroupKey) => groups.find((g) => g.key === key)!;

  return (
    <nav aria-label="Settings sections" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-7 pb-5">
      {variant === "a" ? (
        <div className="flex flex-col gap-7">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="px-3 pb-2.5"><span className="caps-label">{g.label}</span></div>
              <ul className="flex flex-col gap-0.5">
                {g.sections.map((x) => (
                  <Row key={x.key} icon={x.icon} label={x.label} active={x.key === section} onClick={() => onSelect(x.key)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {variant === "b" ? (
        <div className="flex flex-col gap-5">
          {groups.length > 1 ? (
            <div role="tablist" aria-label="Scope" className="flex h-9 rounded-lg border border-hairline bg-surface p-0.5">
              {groups.map((g) => (
                <button
                  key={g.key}
                  role="tab"
                  type="button"
                  aria-selected={g.key === activeGroup}
                  onClick={() => onSelect(g.sections[0]!.key)}
                  className={cn(
                    "flex-1 rounded-md text-[14px] text-text-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    g.key === activeGroup && "bg-selected font-medium text-text",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          ) : null}
          <div>
            <div className="px-3 pb-2.5">
              <span className="caps-label">{activeGroup === "team" ? "Coral Offers" : "All teams"}</span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {scope(activeGroup).sections.map((x) => (
                <Row key={x.key} icon={x.icon} label={x.label} active={x.key === section} onClick={() => onSelect(x.key)} />
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {variant === "c" ? (
        <div className="flex flex-col">
          {groups.map((g, i) => (
            <div key={g.key} className={cn(i > 0 && "mt-6 border-t border-hairline-strong pt-6")}>
              <div className="px-3 pb-2.5">
                <div className="caps-label">{g.label}</div>
                <div className="mt-0.5 text-[13px] text-text-muted">{g.key === "team" ? "Coral Offers" : "Every team"}</div>
              </div>
              <ul className="flex flex-col gap-0.5">
                {g.sections.map((x) => (
                  <Row key={x.key} icon={x.icon} label={x.label} trail={trail(x.key)} active={x.key === section} onClick={() => onSelect(x.key)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-auto px-3 pt-6 text-[13px] text-text-muted">{VERSION}</p>
    </nav>
  );
}
