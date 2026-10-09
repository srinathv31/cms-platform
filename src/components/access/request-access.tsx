"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TeamIcon } from "@/components/app-shell/team-icon";
import { runAction } from "@/components/versions/action-dialog";
import { ACCESS_REFUSALS, ROLE_LABEL, rolesLabel } from "@/domain/access";
import {
  ACCESS_REASON_MAX,
  type MyAccessRequest,
  type RequestAccessData,
  type RequestAccessTeam,
  type RequestableRole,
} from "@/domain/access-types";
import { requestAccess } from "@/server/actions/access";
import { formatShortDate } from "@/domain/dates";
import { pluralWord } from "@/domain/plural";
import { orList } from "./format";
import { RolePicker } from "./role-picker";

// Request access: one card per team, with its Team Admin and what you can do about it. A pending
// request replaces the form; a denial shows the admin's note and lets you ask again. Only one form is
// open at a time, so the screen has one black button.

const CARD = "rounded-2xl border border-hairline bg-surface-tinted p-6";
const LABEL = "text-[13px] leading-5 font-medium text-text";

type Ended = RequestAccessData["ended"][number];

function endedSentence(e: Ended): string {
  const when = formatShortDate(e.at);
  if (e.status === "lapsed") return `Your access to ${e.teamName} lapsed on ${when}: it wasn't confirmed in the access review.`;
  if (e.reason === "inactivity_auto")
    return `Your access to ${e.teamName} was suspended on ${when} after a long time without a sign-in.`;
  return `Your access to ${e.teamName} was suspended on ${when} for inactivity.`;
}

function EndedLines({ ended }: { ended: Ended[] }) {
  if (ended.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {ended.map((e) => (
        <li key={e.teamId} className="flex items-start gap-2.5 text-[14px] leading-5 text-text-muted">
          <Hourglass aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          <span>{endedSentence(e)}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a request in a card says: waiting, or declined with the admin's note. */
function RequestStatus({
  request,
  team,
  focusRef,
}: {
  request: MyAccessRequest;
  team: RequestAccessTeam;
  focusRef: React.RefObject<HTMLDivElement | null>;
}) {
  const role = ROLE_LABEL[request.role];
  if (request.status === "pending") {
    const admins = orList(team.admins.map((a) => a.name));
    return (
      <div ref={focusRef} tabIndex={-1} className="mt-5 rounded-lg bg-surface-sunken p-4 outline-none" data-slot="request-status">
        <p className="text-[14px] leading-5 font-medium">
          {admins ? `Your request for ${role} access is waiting on ${admins}.` : `Your request for ${role} access is waiting.`}
        </p>
        <p className="mt-1 text-[13px] leading-5 text-text-muted">Asked {formatShortDate(request.createdAt)}</p>
        <p className="mt-2 text-[14px] leading-5 break-words text-text-muted">{request.reason}</p>
      </div>
    );
  }
  if (request.status === "denied") {
    const by = request.decidedBy?.name ?? "A Team Admin";
    return (
      <div tabIndex={-1} className="mt-5 rounded-lg bg-surface-sunken p-4 outline-none" data-slot="request-status">
        <p className="text-[14px] leading-5 font-medium">
          {by} declined your request for {role} access{request.decidedAt ? ` on ${formatShortDate(request.decidedAt)}` : ""}.
        </p>
        {request.note ? <p className="mt-2 text-[14px] leading-5 break-words text-text">&ldquo;{request.note}&rdquo;</p> : null}
      </div>
    );
  }
  return null;
}

function RequestForm({
  team,
  roles,
  onClose,
  onSent,
}: {
  team: RequestAccessTeam;
  roles: readonly RequestableRole[];
  onClose: () => void;
  onSent: () => void;
}) {
  const roleLabelId = useId();
  const reasonId = useId();
  const root = useRef<HTMLFormElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const [role, setRole] = useState<RequestableRole>(roles[0]!);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Focus goes to the chosen role: the first thing to decide.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus({ preventScroll: true });
    root.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const trimmed = reason.trim();
  const invalid =
    trimmed === "" ? ACCESS_REFUSALS.giveReason.reason : trimmed.length > ACCESS_REASON_MAX ? ACCESS_REFUSALS.reasonTooLong.reason : null;
  const adminNames = team.admins.map((a) => a.name);
  const noAdmin = adminNames.length === 0;
  const shown = error ?? (attempted ? invalid : null);

  function submit() {
    if (sending.current || pending) return;
    setAttempted(true);
    if (invalid) {
      reasonRef.current?.focus();
      return;
    }
    if (noAdmin) return;
    sending.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await runAction(() => requestAccess({ teamId: team.id, role, reason: trimmed }));
        if (result.ok) {
          onSent();
          onClose();
        } else {
          setError(result.reason);
        }
      } finally {
        sending.current = false;
      }
    });
  }

  return (
    <form
      ref={root}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (!pending) onClose();
      }}
      aria-label={`Request access to ${team.name}`}
      className="mt-5 flex flex-col gap-4 border-t border-hairline pt-5"
    >
      <div className="flex flex-col gap-2">
        <span id={roleLabelId} className={LABEL}>
          Role
        </span>
        <RolePicker roles={roles} value={role} onChange={setRole} labelledBy={roleLabelId} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={reasonId} className={LABEL}>
          Reason
        </label>
        <Textarea
          ref={reasonRef}
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={ACCESS_REASON_MAX}
          rows={3}
          aria-invalid={attempted && invalid ? true : undefined}
          className="min-h-20 bg-surface text-[14px] leading-5"
        />
      </div>
      <p className="text-[14px] leading-5 text-text">
        {noAdmin
          ? `${team.name} has no Team Admin to decide yet.`
          : `${adminNames.length === 1 ? adminNames[0] : orList(adminNames)}, ${pluralWord(adminNames.length, "Team Admin")} of ${team.name}, will decide.`}
      </p>
      <div className="flex items-center justify-end gap-2">
        {shown ? (
          <p role="alert" className="mr-auto text-[13px] text-danger-text">
            {shown}
          </p>
        ) : null}
        <Button type="button" variant="ghost" aria-disabled={pending} onClick={() => (pending ? undefined : onClose())}>
          Cancel
        </Button>
        <Button type="submit" aria-disabled={pending || noAdmin} className="aria-disabled:opacity-50">
          Send request
        </Button>
      </div>
    </form>
  );
}

function TeamCard({
  team,
  request,
  roles,
  open,
  onOpen,
  onClose,
}: {
  team: RequestAccessTeam;
  request: MyAccessRequest | undefined;
  roles: readonly RequestableRole[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const justSent = useRef(false);
  const wasOpen = useRef(false);

  const pending = request?.status === "pending";
  const available = team.myRoles.length === 0 ? roles : roles.filter((r) => !team.myRoles.includes(r));
  const canAsk = !pending && available.length > 0;

  // When the form closes without sending, focus returns to the button that opened it. After a send, the
  // pending note takes focus once it appears.
  useEffect(() => {
    if (wasOpen.current && !open && !justSent.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (pending && justSent.current) {
      justSent.current = false;
      statusRef.current?.focus();
    }
  }, [pending]);

  return (
    <section aria-labelledby={headingId} className={CARD} data-team={team.slug}>
      <div className="flex items-start gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-hairline bg-surface">
          <TeamIcon name={team.icon} className="size-5 text-text" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-[17px] leading-6 font-medium">
            {team.name}
          </h2>
          <p className="mt-0.5 text-sm leading-5 text-text-muted">{team.description}</p>
          <p className="mt-2 text-[13px] leading-5 text-text-muted">
            {team.admins.length === 0
              ? "No Team Admin yet"
              : `${pluralWord(team.admins.length, "Team Admin")}: ${team.admins.map((a) => a.name).join(", ")}`}
          </p>
          {team.myRoles.length > 0 ? (
            <p className="text-[13px] leading-5 text-text">Your access: {rolesLabel(team.myRoles)}</p>
          ) : null}
        </div>
        {canAsk && !open ? (
          <Button ref={triggerRef} variant="outline" onClick={onOpen}>
            {team.myRoles.length > 0 ? "Request another role" : "Request access"}
          </Button>
        ) : null}
      </div>
      {request && !(request.status === "approved") ? (
        <RequestStatus request={request} team={team} focusRef={statusRef} />
      ) : null}
      {open && canAsk ? (
        <RequestForm
          team={team}
          roles={available}
          onClose={onClose}
          onSent={() => {
            justSent.current = true;
          }}
        />
      ) : null}
    </section>
  );
}

export function RequestAccess({ data }: { data: RequestAccessData }) {
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const latest = new Map(data.requests.map((r) => [r.teamId, r]));

  return (
    <div className="flex max-w-[40rem] flex-col gap-6 pb-10">
      <EndedLines ended={data.ended} />
      <ul className="flex flex-col gap-4">
        {data.teams.map((team) => (
          <li key={team.id}>
            <TeamCard
              team={team}
              request={latest.get(team.id)}
              roles={data.roles}
              open={openTeam === team.id}
              onOpen={() => setOpenTeam(team.id)}
              onClose={() => setOpenTeam(null)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
