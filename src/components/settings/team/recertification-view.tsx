"use client";

import { useState } from "react";
import { rolesLabel } from "@/domain/access";
import type { RecertificationSection, RecertView } from "@/domain/access-types";
import { Button } from "@/components/ui/button";
import { decideRecertItem, startRecertification } from "@/server/actions/access";
import { daysBetween, formatShortDate } from "@/domain/dates";
import { plural } from "@/domain/plural";
import { firstName, lastActive } from "./format";
import { Bar, RowTable, Strip, type RowData } from "./rows";

/** The borrowed stat card: how many are confirmed, and how long is left. The footnote comes worded. */
function StatCard({ view, today }: { view: RecertView; today: string }) {
  const { progress, phase } = view;
  const left = daysBetween(today, view.dueAt);
  return (
    <section data-slot="recert-summary" aria-label={`${view.label} review`} className="mb-6 rounded-xl border border-hairline bg-surface-tinted p-6">
      <div className="grid grid-cols-2 gap-8">
        <div>
          <div className="caps-label">Confirmed</div>
          <div className="numeral mt-2">
            {progress.decided} of {progress.total}
          </div>
          <Bar value={progress.total ? progress.decided / progress.total : 0} className="mt-3" />
        </div>
        <div>
          <div className="caps-label">
            {phase === "closed" ? "Closed" : phase === "upcoming" ? "Starts" : `Due ${formatShortDate(view.dueAt, today)}`}
          </div>
          <div className="numeral mt-2">
            {phase === "closed"
              ? formatShortDate(view.completedAt ?? view.dueAt, today)
              : phase === "upcoming"
                ? formatShortDate(view.startsAt, today)
                : plural(Math.max(0, left), "day")}
          </div>
        </div>
      </div>
      <p className="mt-5 border-t border-hairline pt-4 text-[14px] text-text">{view.footnote}</p>
    </section>
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
      {view ? <StatCard view={view} today={today} /> : null}
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
