"use client";

import { rolesLabel } from "@/domain/access";
import type { InactivityRow, InactivitySection } from "@/domain/access-types";
import type { PermissionResult } from "@/domain/types";
import { keepInactive, reinstateMember, suspendInactive } from "@/server/actions/access";
import { daysBetween, formatShortDate } from "@/domain/dates";
import { plural } from "@/domain/plural";
import { firstName } from "./format";
import { GroupHeading, RowTable, type RowAct, type RowData } from "./rows";

/** Days idle against the suspend line, the flag line marked. */
function IdleTrack({ days, flagDays, suspendDays }: { days: number; flagDays: number; suspendDays: number }) {
  const pct = Math.min(100, (days / suspendDays) * 100);
  return (
    <div className="min-w-24">
      <div className="text-[14px] text-text">{plural(days, "day")}</div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-selected" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        <span className="absolute top-[-3px] h-3 w-px bg-text-muted" style={{ left: `${(flagDays / suspendDays) * 100}%` }} />
      </div>
    </div>
  );
}

const reasonOf = (r: PermissionResult) => (r.ok ? null : r.reason);

export function InactivityView({ section, today }: { section: InactivitySection; today: string }) {
  const { thresholds } = section;

  const restore = (m: InactivityRow): RowAct => ({
    key: "restore",
    label: "Restore",
    blocked: reasonOf(m.can.reinstate),
    strip: {
      consequence: m.consequences.reinstate,
      confirmLabel: `Restore ${firstName(m.person.name)}`,
      run: () => reinstateMember({ membershipId: m.membershipId }),
    },
  });

  const flagged: RowData[] = section.flagged.map((m) => {
    const first = firstName(m.person.name);
    const left = daysBetween(today, m.suspendsAt);
    return {
      id: m.membershipId,
      person: m.person,
      sub: rolesLabel(m.roles),
      cells: [
        <IdleTrack key="idle" days={m.daysInactive} flagDays={thresholds.flagDays} suspendDays={thresholds.suspendDays} />,
        m.heldAsLastAdmin ? (
          <div key="suspends">
            <div>Kept active</div>
            <div className="text-[13px] text-text-muted">Last Team Admin</div>
          </div>
        ) : (
          <div key="suspends">
            <div>{formatShortDate(m.suspendsAt, today)}</div>
            <div className="text-[13px] text-text-muted">{left > 0 ? `in ${plural(left, "day")}` : "Due now"}</div>
          </div>
        ),
      ],
      actions: [
        {
          key: "suspend",
          label: "Suspend",
          blocked: reasonOf(m.can.suspend),
          strip: {
            consequence: m.consequences.suspend,
            confirmLabel: `Suspend ${first}`,
            run: () => suspendInactive({ membershipId: m.membershipId }),
          },
        },
        {
          key: "keep",
          label: "Keep",
          blocked: reasonOf(m.can.keep),
          strip: {
            consequence: m.consequences.keep,
            confirmLabel: `Keep ${first}`,
            run: () => keepInactive({ membershipId: m.membershipId }),
          },
        },
      ],
    };
  });

  const suspended: RowData[] = section.suspended.map((m) => ({
    id: m.membershipId,
    person: m.person,
    sub: rolesLabel(m.roles),
    dim: true,
    cells: [m.statusReason === "inactivity_auto" ? "Automatically" : "Team Admin", formatShortDate(m.suspendsAt, today)],
    actions: [restore(m)],
  }));

  return (
    <>
      <RowTable
        label="Member"
        tableLabel="Flagged members"
        columns={["Idle", "Auto-suspends"]}
        cols="7rem 7rem"
        actionsW="9.5rem"
        rows={flagged}
        empty="No one is flagged."
      />
      {suspended.length ? (
        <>
          <GroupHeading>Suspended</GroupHeading>
          <RowTable label="Member" tableLabel="Suspended members" columns={["Suspended by", "Date"]} cols="7rem 7rem" actionsW="9.5rem" rows={suspended} />
        </>
      ) : null}
    </>
  );
}
