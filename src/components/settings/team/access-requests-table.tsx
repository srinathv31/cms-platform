"use client";

import { ROLE_LABEL, validateDecisionNote } from "@/domain/access";
import { DECISION_NOTE_MAX, type AccessRequestRow, type AccessRequestsSection } from "@/domain/access-types";
import { decideAccessRequest } from "@/server/actions/access";
import { fmtDay, firstName } from "./format";
import { GroupHeading, RowTable, type RowData } from "./rows";
import { UserAvatar } from "@/components/app-shell/user-avatar";

function pendingRow(r: AccessRequestRow, today: string): RowData {
  const first = firstName(r.person.name);
  const blocked = r.can.decide.ok ? null : r.can.decide.reason;
  const role = ROLE_LABEL[r.role];
  // The reason in full: the row clamps it to two lines, and nobody should decide on half of it.
  const reason = (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-text-muted">{`${first}'s reason`}</span>
      <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-text">{r.reason}</p>
    </div>
  );
  return {
    id: r.id,
    person: r.person,
    sub: `Asked ${fmtDay(r.createdAt, today)}`,
    cells: [role, <span key="reason" title={r.reason} className="line-clamp-2 text-[13px] leading-snug text-text-muted">{r.reason}</span>],
    actions: [
      {
        key: "approve",
        label: "Approve",
        blocked,
        strip: {
          consequence: r.consequences.approve,
          confirmLabel: `Approve as ${role}`,
          detail: reason,
          run: () => decideAccessRequest({ requestId: r.id, decision: "approve" }),
        },
      },
      {
        key: "deny",
        label: "Deny",
        blocked,
        strip: {
          consequence: r.consequences.deny,
          confirmLabel: "Deny request",
          detail: reason,
          note: { label: `Note for ${first}`, max: DECISION_NOTE_MAX, problem: (note) => validateDecisionNote("deny", note)?.reason ?? null },
          run: (note) => decideAccessRequest({ requestId: r.id, decision: "deny", note }),
        },
      },
    ],
  };
}

function Decided({ rows, today }: { rows: AccessRequestRow[]; today: string }) {
  return (
    <div role="table" aria-label="Decided requests">
      {rows.map((r) => {
        const verb = r.status === "approved" ? "Approved" : "Denied";
        return (
          <div key={r.id} role="row" className="grid min-h-16 grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1.3fr)_9.5rem] items-center gap-x-3 border-b border-hairline py-2.5">
            <div role="cell" className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="shrink-0">
                <UserAvatar initials={r.person.initials} hue={r.person.hue} muted />
              </span>
              <span className="truncate text-[15px] font-medium text-text-muted">{r.person.name}</span>
            </div>
            <div role="cell" className="text-[14px] text-text-muted">{ROLE_LABEL[r.role]}</div>
            <div role="cell" className="col-span-2 min-w-0 text-[13px] leading-snug text-text-muted">
              <div>
                {verb}
                {r.decidedBy ? ` by ${r.decidedBy.name}` : ""}
                {r.decidedAt ? ` · ${fmtDay(r.decidedAt, today)}` : ""}
              </div>
              {r.status === "denied" && r.note ? <div className="line-clamp-2">{r.note}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AccessRequestsTable({ section, today }: { section: AccessRequestsSection; today: string }) {
  return (
    <>
      <RowTable
        label="Requester"
        columns={["Role", "Reason"]}
        cols="5.5rem minmax(0,1.3fr)"
        actionsW="9.5rem"
        rows={section.pending.map((r) => pendingRow(r, today))}
        empty="No requests waiting."
      />
      {section.decided.length ? (
        <>
          <GroupHeading>Decided</GroupHeading>
          <Decided rows={section.decided} today={today} />
        </>
      ) : null}
    </>
  );
}
