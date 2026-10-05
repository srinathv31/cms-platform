"use client";

import { useState } from "react";
import { rolesLabel } from "@/domain/access";
import { RECERT_WINDOW_DAYS, type RecertItemRow, type RecertificationSection, type RecertView } from "@/domain/access-types";
import { Button } from "@/components/ui/button";
import { decideRecertItem, startRecertification } from "@/server/actions/access";
import { addDays, andList, daysAgo, daysUntil, firstName, fmtDay, plural } from "./format";
import { Bar, RowTable, Strip, type RowData } from "./rows";

/** The borrowed stat card: how many are confirmed, and how long is left. */
function StatCard({ view, team, today }: { view: RecertView; team: string; today: string }) {
  const { progress, phase } = view;
  const left = daysUntil(view.dueAt, today);
  const footnote =
    phase === "closed"
      ? view.lapsed.length
        ? `Access lapsed on ${fmtDay(view.dueAt, today)} for ${andList(view.lapsed.map((p) => p.name))}.`
        : view.completedAt && view.completedAt < view.dueAt
          ? `Closed on ${fmtDay(view.completedAt, today)}: every member was decided.`
          : "Nobody lapsed."
      : `Anyone not confirmed by ${fmtDay(view.dueAt, today)} loses access to ${team}.`;
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
            {phase === "closed" ? "Closed" : phase === "upcoming" ? "Starts" : `Due ${fmtDay(view.dueAt, today)}`}
          </div>
          <div className="numeral mt-2">
            {phase === "closed"
              ? fmtDay(view.completedAt ?? view.dueAt, today)
              : phase === "upcoming"
                ? fmtDay(view.startsAt, today)
                : plural(Math.max(0, left), "day")}
          </div>
        </div>
      </div>
      <p className="mt-5 border-t border-hairline pt-4 text-[14px] text-text">{footnote}</p>
    </section>
  );
}

function outcome(i: RecertItemRow, view: RecertView, today: string): React.ReactNode | undefined {
  if (i.decision === "keep") return `Kept${i.decidedBy ? ` · ${i.decidedBy.name}` : ""}${i.decidedAt ? `, ${fmtDay(i.decidedAt, today)}` : ""}`;
  if (i.decision === "remove" || i.membership === "removed") return `Removed${i.decidedAt ? ` · ${fmtDay(i.decidedAt, today)}` : ""}`;
  if (i.membership === "suspended") return "Suspended for inactivity";
  if (i.membership === "lapsed") return `Access lapsed ${fmtDay(view.dueAt, today)}`;
  if (view.phase === "closed") return "Not confirmed";
  return undefined;
}

function Start({ teamId, team, today, blocked }: { teamId: string; team: string; today: string; blocked: string | null }) {
  const [open, setOpen] = useState(false);
  const due = addDays(today, RECERT_WINDOW_DAYS);
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
      consequence={`Every member except Team Admins is asked to be kept or removed by ${fmtDay(due, today)}, ${RECERT_WINDOW_DAYS} days from today. Anyone not confirmed by then loses access to ${team}.`}
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
    const settled = outcome(i, view!, today);
    const blocked = i.can.decide.ok ? null : i.can.decide.reason;
    return {
      id: i.userId,
      person: i.person,
      sub: i.title,
      dim: i.decision === "remove" || i.membership !== "active",
      settled,
      cells: [rolesLabel(i.roles) || "—", daysAgo(i.lastActiveAt, today)],
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
            consequence: `${i.person.name} loses access to ${team.name} now, not at the deadline.`,
            confirmLabel: `Remove ${first}`,
            run: () => decideRecertItem({ recertId: view!.id, userId: i.userId, decision: "remove" }),
          },
        },
      ],
    };
  });

  return (
    <>
      {view ? <StatCard view={view} team={team.name} today={today} /> : null}
      {view ? <RowTable label="Member" columns={["Role", "Last active"]} cols="8rem 6.5rem" actionsW="9rem" rows={rows} empty="Nobody to review." /> : null}
      {!running ? (
        <div className={view ? "mt-6" : undefined}>
          {!view && !startBlocked ? <p className="mb-4 text-[15px] text-text-muted">No review has run yet.</p> : null}
          <Start teamId={team.id} team={team.name} today={today} blocked={startBlocked} />
        </div>
      ) : null}
    </>
  );
}
