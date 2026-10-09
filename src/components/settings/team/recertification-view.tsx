"use client";

import { useState } from "react";
import { rolesLabel } from "@/domain/access";
import type { RecertificationSection, RecertView } from "@/domain/access-types";
import { StatCard, StatLabel, StatValue } from "@/components/primitives/stat-card";
import { Button } from "@/components/ui/button";
import { decideRecertItem, startRecertification } from "@/server/actions/access";
import { daysBetween, formatShortDate } from "@/domain/dates";
import { plural } from "@/domain/plural";
import { Strip } from "../strip";
import { firstName, lastActive } from "./format";
import { Bar, RowTable, type RowData } from "./rows";

/** A stat card with two stats: how many are confirmed, and how long is left. The footnote comes worded. */
function Summary({ view, today }: { view: RecertView; today: string }) {
  const { progress, phase } = view;
  const left = daysBetween(today, view.dueAt);
  return (
    <StatCard role="region" data-slot="recert-summary" aria-label={`${view.label} review`} className="mb-6">
      <div className="grid grid-cols-2 gap-8">
        <div>
          <StatLabel>Confirmed</StatLabel>
          <StatValue value={`${progress.decided} of ${progress.total}`} className="mt-2" />
          <Bar value={progress.total ? progress.decided / progress.total : 0} className="mt-3" />
        </div>
        <div>
          <StatLabel>
            {phase === "closed" ? "Closed" : phase === "upcoming" ? "Starts" : `Due ${formatShortDate(view.dueAt, today)}`}
          </StatLabel>
          <StatValue
            value={
              phase === "closed"
                ? formatShortDate(view.completedAt ?? view.dueAt, today)
                : phase === "upcoming"
                  ? formatShortDate(view.startsAt, today)
                  : plural(Math.max(0, left), "day")
            }
            className="mt-2"
          />
        </div>
      </div>
      <p className="mt-5 border-t border-hairline pt-4 text-[14px] leading-normal text-text">{view.footnote}</p>
    </StatCard>
  );
}

function Start({ teamId, consequence, blocked }: { teamId: string; consequence: string; blocked: string | null }) {
  const [open, setOpen] = useState(false);
  if (blocked) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled>
          Start review
        </Button>
        <p className="text-[13px] text-text-muted">{blocked}</p>
      </div>
    );
  }
  return open ? (
    <Strip
      consequence={consequence}
      confirmLabel="Start review"
      onConfirm={() => startRecertification({ teamId })}
      onCancel={() => setOpen(false)}
      onDone={() => setOpen(false)}
    />
  ) : (
    <Button variant="outline" onClick={() => setOpen(true)}>
      Start review
    </Button>
  );
}

export function RecertificationView({ section }: { section: RecertificationSection }) {
  const { team, current: view, today } = section;
  const startBlocked = section.can.start.ok ? null : section.can.start.reason;
  // A review still running can't be restarted: the card above already says so.
  const running = view !== null && view.phase !== "closed";

  const rows: RowData[] = (view?.items ?? []).map((i) => {
    const first = firstName(i.person.name);
    const blocked = i.can.decide.ok ? null : i.can.decide.reason;
    return {
      id: i.userId,
      person: i.person,
      sub: i.title,
      dim: i.decision === "remove" || i.membership !== "active",
      settled: i.outcome ?? undefined,
      cells: [rolesLabel(i.roles) || "—", lastActive(i.lastActiveAt, today)],
      actions: [
        {
          key: "keep",
          label: "Keep",
          blocked,
          run: () => decideRecertItem({ recertId: view!.id, userId: i.userId, decision: "keep" }),
        },
        {
          key: "remove",
          label: "Remove",
          blocked,
          strip: {
            consequence: i.consequences.remove,
            confirmLabel: `Remove ${first}`,
            run: () => decideRecertItem({ recertId: view!.id, userId: i.userId, decision: "remove" }),
          },
        },
      ],
    };
  });

  return (
    <>
      {view ? <Summary view={view} today={today} /> : null}
      {view ? <RowTable label="Member" columns={["Role", "Last active"]} cols="8rem 6.5rem" actionsW="9rem" rows={rows} empty="Nobody to review." /> : null}
      {!running ? (
        <div className={view ? "mt-6" : undefined}>
          {!view && !startBlocked ? <p className="mb-4 text-[15px] text-text-muted">No review has run yet.</p> : null}
          <Start teamId={team.id} consequence={section.consequences.start} blocked={startBlocked} />
        </div>
      ) : null}
    </>
  );
}
