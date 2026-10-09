"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ACTIVE_ON_CHANNEL,
  CHANNELS,
  IN_REVIEW_NOW,
  INACTIVE_FLAG_DAYS,
  INACTIVE_SUSPEND_DAYS,
  LEGAL_STAGE,
  PEOPLE,
  RECERT_CONFIRMED,
  RECERT_DEADLINE,
  RECERT_NAME,
  REQUESTS,
  REQUIRED_SECTIONS,
  ROLES,
  dayLabel,
  daysAgo,
  type Role,
  type Stage,
} from "./data";
import { plural } from "@/domain/plural";
import { ConfirmStrip, Items, type Act, type Item, type Variant } from "./items";
import { Bar, ChainFlow, IdleTrack, Pick, Reviewers } from "./parts";
import { useStore } from "./store";

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: r }));

function Head({ title, line, action }: { title: string; line: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div>
        <h2 className="display-lg leading-none text-text">{title}</h2>
        <p className="mt-3 text-[14px] text-text-muted">{line}</p>
      </div>
      {action}
    </header>
  );
}

const TEAM = "Coral Offers";

/* ---------------------------------------------------------------- Members */

function Members({ v }: { v: Variant }) {
  const s = useStore();
  const items: Item[] = s.members.map((m) => {
    const p = PEOPLE[m.id]!;
    const acc = s.access(m.id);
    const self = m.id === "alex";
    const off = acc.kind !== "active";
    const note =
      acc.kind === "suspended"
        ? `${acc.auto ? "Suspended automatically" : "Suspended"} ${dayLabel(acc.day)}`
        : acc.kind === "lapsed"
          ? `Access lapsed ${dayLabel(acc.day)}`
          : self
            ? "You"
            : p.title;
    const actions: Act[] = self
      ? []
      : [
          off
            ? {
                key: "reactivate",
                label: "Reactivate",
                consequence: `${p.first} signs in to ${TEAM} again as ${s.roleOf(m.id)}. ${acc.kind === "suspended" && acc.auto ? "The 120-day count restarts today." : ""}`.trim(),
                run: () => s.reactivate(m.id),
              }
            : {
                key: "suspend",
                label: "Suspend",
                consequence: `${p.first} can't sign in to ${TEAM} until you reactivate them. ${m.drafts ? `${plural(m.drafts, "draft")} stay with the team.` : "Nothing they wrote is lost."}`,
                confirmLabel: `Suspend ${p.first}`,
                run: () => s.suspend(m.id),
              },
          {
            key: "remove",
            label: "Remove",
            consequence: `${p.first} loses access to ${TEAM} and the member list. ${m.drafts ? `Their ${plural(m.drafts, "draft")} stay with the team.` : "They can ask for access again."}`,
            confirmLabel: `Remove ${p.first}`,
            run: () => s.remove(m.id),
          },
        ];
    return {
      id: m.id,
      person: p,
      title: p.name,
      sub: note,
      meta: s.roleOf(m.id),
      dim: off,
      actions,
      cells: [
        {
          label: "Role",
          node: self ? (
            s.roleOf(m.id)
          ) : (
            <Pick label={`Role for ${p.name}`} value={s.roleOf(m.id)} options={ROLE_OPTIONS} onChange={(r: Role) => s.setRole(m.id, r)} className="w-[7.5rem]" />
          ),
        },
        { label: "Last active", node: daysAgo(-m.lastActive) },
        { label: "Added", node: dayLabel(m.added, v !== "a") },
      ],
    };
  });
  return <Items variant={v} items={items} grid="7.75rem 6rem 4.5rem" titleLabel="Member" empty="No members." />;
}

/* -------------------------------------------------------- Access requests */

function AccessRequests({ v }: { v: Variant }) {
  const s = useStore();
  const items: Item[] = REQUESTS.map((r) => {
    const p = PEOPLE[r.who]!;
    const d = s.reqs[r.id];
    const actions: Act[] = [
      {
        key: "approve",
        label: "Approve",
        consequence: `${p.name} gets ${r.role} access to ${TEAM} and sees its Library the next time they open Stencil.`,
        confirmLabel: `Approve as ${r.role}`,
        run: () => s.decide(r.id, r.who, "approved", r.role),
      },
      {
        key: "decline",
        label: "Decline",
        consequence: `${p.first} sees your note and can ask again.`,
        note: `Note for ${p.first}`,
        confirmLabel: "Decline request",
        run: (note) => s.decide(r.id, r.who, "declined", r.role, note),
      },
    ];
    return {
      id: r.id,
      person: p,
      title: p.name,
      sub: r.asked,
      meta: r.role,
      dim: !!d,
      actions,
      settled: d ? (d.decision === "approved" ? `Approved as ${r.role} · ${dayLabel(d.day)}` : `Declined · ${d.note}`) : undefined,
      cells: [
        { label: "Role", node: r.role },
        { label: "Reason", node: <span className="line-clamp-2 text-[13px] leading-snug text-text-muted">{r.reason}</span> },
      ],
    };
  });
  return <Items variant={v} items={items} grid="5.5rem minmax(0,1.5fr)" titleLabel="Requester" empty="No requests waiting." />;
}

/* --------------------------------------------------------- Recertification */

function Summary({ v }: { v: Variant }) {
  const s = useStore();
  const total = s.members.length;
  const confirmed = s.members.filter((m) => s.recertState(m.id) === "confirmed").length;
  const left = RECERT_DEADLINE - s.clock;
  const closed = left < 0;
  const lapse = `Anyone not confirmed by ${dayLabel(RECERT_DEADLINE)} loses access to ${TEAM}. Their drafts stay with the team.`;
  if (v === "c") {
    return (
      <div className="mb-4 rounded-xl border border-hairline bg-surface-tinted p-6">
        <div className="grid grid-cols-2 gap-8">
          <div>
            <div className="caps-label">Confirmed</div>
            <div className="numeral mt-1.5">{confirmed} of {total}</div>
            <Bar value={confirmed / total} className="mt-3" />
          </div>
          <div>
            <div className="caps-label">{closed ? "Closed" : `Until ${dayLabel(RECERT_DEADLINE)}`}</div>
            <div className="numeral mt-1.5">{closed ? dayLabel(RECERT_DEADLINE) : plural(left, "day")}</div>
          </div>
        </div>
        <p className="mt-5 border-t border-hairline pt-4 text-[14px] text-text">{closed ? `Access lapsed on ${dayLabel(RECERT_DEADLINE)} for everyone left unconfirmed.` : lapse}</p>
      </div>
    );
  }
  return (
    <div className={cn("mb-5", v === "b" && "rounded-xl border border-hairline p-5")}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[15px] font-medium text-text">{RECERT_NAME}</span>
        <span className="text-[14px] text-text-muted">{closed ? `Closed ${dayLabel(RECERT_DEADLINE)}` : `Due ${dayLabel(RECERT_DEADLINE)} · ${plural(left, "day")} left`}</span>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <Bar value={confirmed / total} className="flex-1" />
        <span className="text-[14px] text-text tabular-nums">{confirmed} of {total} confirmed</span>
      </div>
      <p className="mt-3 text-[14px] text-text-muted">{closed ? `Access lapsed on ${dayLabel(RECERT_DEADLINE)} for everyone left unconfirmed.` : lapse}</p>
    </div>
  );
}

function Recertification({ v }: { v: Variant }) {
  const s = useStore();
  const items: Item[] = s.members.map((m) => {
    const p = PEOPLE[m.id]!;
    const st = s.recertState(m.id);
    const by = RECERT_CONFIRMED[m.id] ?? `Alex Kim · ${dayLabel(s.clock)}`;
    return {
      id: m.id,
      person: p,
      title: p.name,
      sub: p.title,
      meta: st === "confirmed" ? "Kept" : st === "lapsed" ? "Lapsed" : "Waiting",
      dim: st === "lapsed",
      actions: st === "pending" ? [
        { key: "keep", label: "Keep", run: () => s.decideRecert(m.id, "keep") },
        {
          key: "remove",
          label: "Remove",
          consequence: `${p.first} loses access to ${TEAM} now rather than at the deadline. ${m.drafts ? `Their ${plural(m.drafts, "draft")} stay with the team.` : ""}`.trim(),
          confirmLabel: `Remove ${p.first}`,
          run: () => {
            s.decideRecert(m.id, "remove");
            s.remove(m.id);
          },
        },
      ] : [],
      settled: st === "confirmed" ? `Kept · ${by}` : st === "lapsed" ? `Access lapsed ${dayLabel(RECERT_DEADLINE)}` : undefined,
      cells: [
        { label: "Role", node: s.roleOf(m.id) },
        { label: "Last active", node: daysAgo(-m.lastActive) },
      ],
    };
  });
  return (
    <>
      <Summary v={v} />
      <Items variant={v} items={items} grid="6.5rem 6.5rem" titleLabel="Member" empty="No members." />
    </>
  );
}

/* -------------------------------------------------------------- Inactivity */

function Inactivity({ v }: { v: Variant }) {
  const s = useStore();
  const flagged = s.members.filter((m) => m.lastActive <= -60 && s.idleDays(m.id) >= INACTIVE_FLAG_DAYS && !(m.id in s.suspended));
  const items: Item[] = flagged.map((m) => {
    const p = PEOPLE[m.id]!;
    const idle = s.idleDays(m.id);
    const last = Math.max(m.lastActive, s.kept[m.id] ?? -9999);
    const auto = s.autoSuspendDay(m.id);
    const done = idle >= INACTIVE_SUSPEND_DAYS;
    const left = auto - s.clock;
    return {
      id: m.id,
      person: p,
      title: p.name,
      sub: s.roleOf(m.id),
      meta: `${idle} days`,
      dim: done,
      settled: done ? `Suspended automatically ${dayLabel(auto)}` : undefined,
      actions: [
        {
          key: "suspend",
          label: "Suspend",
          consequence: `${p.first} can't sign in to ${TEAM} from now on. Reactivate from Members at any time.`,
          confirmLabel: `Suspend ${p.first}`,
          run: () => s.suspend(m.id),
        },
        {
          key: "keep",
          label: "Keep",
          consequence: `${p.first} stays on ${TEAM}. The count restarts today, so they are flagged again on ${dayLabel(s.clock + INACTIVE_FLAG_DAYS)} if they still haven't signed in.`,
          confirmLabel: `Keep ${p.first}`,
          run: () => s.keep(m.id),
        },
      ],
      cells: [
        { label: "Last login", node: dayLabel(last, true) },
        { label: "Idle", node: <IdleTrack days={idle} /> },
        { label: "Suspends", node: done ? "Done" : `${dayLabel(auto)} · in ${plural(Math.max(left, 0), "day")}` },
      ],
    };
  });
  return <Items variant={v} items={items} grid="6.5rem 8.5rem 7.5rem" titleLabel="Member" empty="No one is flagged." />;
}

/* ------------------------------------------------------------------- Teams */

function Teams({ v, adding, setAdding }: { v: Variant; adding: boolean; setAdding: (b: boolean) => void }) {
  const s = useStore();
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState("morgan");
  const items: Item[] = s.teams.map((t) => ({
    id: t.id,
    title: t.name,
    sub: plural(t.templates, "template"),
    actions: [],
    cells: [
      { label: "Team Admin", node: <Reviewers ids={[t.admin]} /> },
      { label: "Members", node: String(t.members) },
    ],
  }));
  const act: Act = {
    key: "create",
    label: "Create team",
    consequence: `${PEOPLE[admin]!.name} becomes the Team Admin of ${name.trim() || "the new team"} and can approve its access requests. The team starts with no templates.`,
    confirmLabel: "Create team",
    run: () => {
      s.addTeam({ id: name.trim().toLowerCase().replace(/\s+/g, "-"), name: name.trim(), admin, members: 1, templates: 0 });
      setAdding(false);
      setName("");
    },
  };
  return (
    <>
      {adding ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-hairline p-4">
          <div className="flex gap-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" aria-label="Team name" className="flex-1" />
            <Pick
              label="First Team Admin"
              value={admin}
              onChange={setAdmin}
              options={["morgan", "chris", "dana", "naomi"].map((id) => ({ value: id, label: PEOPLE[id]!.name }))}
              className="w-48"
            />
          </div>
          {name.trim() ? (
            <ConfirmStrip key={`${name}${admin}`} act={act} onCancel={() => setAdding(false)} onConfirm={() => act.run()} />
          ) : (
            <div className="flex justify-end"><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
          )}
        </div>
      ) : null}
      <Items variant={v} items={items} grid="12rem 4.5rem" titleLabel="Team" empty="No teams." />
    </>
  );
}

/* ----------------------------------------------------------- Content types */

function ContentTypes({ v }: { v: Variant }) {
  const items: Item[] = [
    {
      id: "disclosure",
      title: "Disclosure",
      sub: "The only content type for now",
      actions: [],
      cells: [
        { label: "Required sections", node: <span className="text-[13px] leading-relaxed">{REQUIRED_SECTIONS.join(", ")}</span> },
        { label: "Channels", node: CHANNELS.join(", ") },
      ],
    },
  ];
  return <Items variant={v} items={items} grid="minmax(0,1.6fr) 8rem" titleLabel="Content type" empty="No content types." />;
}

/* ----------------------------------------------------------- Channel rules */

function ChannelRules({ v }: { v: Variant }) {
  const s = useStore();
  const [pending, setPending] = useState<string | null>(null);
  const turn = (ch: (typeof CHANNELS)[number], on: boolean) => {
    if (on) s.setChannel(`disclosure:${ch}`, true);
    else setPending(ch);
  };
  const act = (ch: (typeof CHANNELS)[number]): Act => ({
    key: ch,
    label: `Turn off ${ch}`,
    consequence: `${plural(ACTIVE_ON_CHANNEL[ch], "Active template")} will stop rendering ${ch}. Coral's ${ch} sends fail with "channel not allowed" until it's turned back on.`,
    confirmLabel: `Turn off ${ch}`,
    run: () => {
      s.setChannel(`disclosure:${ch}`, false);
      setPending(null);
    },
  });
  return (
    <div className={cn(v === "c" && "rounded-xl border border-hairline bg-surface-tinted p-5", v === "b" && "rounded-xl border border-hairline p-5")}>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center gap-x-4 border-b border-hairline pb-2">
        <span className="caps-label">Content type</span>
        {CHANNELS.map((c) => (
          <span key={c} className="caps-label text-center">{c}</span>
        ))}
      </div>
      <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center gap-x-4">
        <span className="text-[15px] font-medium text-text">Disclosure</span>
        {CHANNELS.map((c) => (
          <span key={c} className="flex justify-center">
            <Switch aria-label={`Disclosure on ${c}`} checked={s.channelOn("disclosure", c)} onCheckedChange={(on) => turn(c, on)} />
          </span>
        ))}
      </div>
      {pending ? (
        <ConfirmStrip
          key={pending}
          act={act(pending as (typeof CHANNELS)[number])}
          className={v === "c" ? "bg-surface" : undefined}
          onCancel={() => setPending(null)}
          onConfirm={() => act(pending as (typeof CHANNELS)[number]).run()}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- Approval chains */

function Consequence({ stages, name, reviewer, v }: { stages: Stage[]; name: string; reviewer: string; v: Variant }) {
  const next = { id: "new", name: name.trim() || "New stage" };
  const lines = [
    `Every Disclosure submitted from now on needs ${stages.length + 1} approvals, in order: ${[...stages.map((x) => x.name), next.name].join(", then ")}.`,
    `${PEOPLE[reviewer]!.name} sees review requests from Coral Offers, Deposits and Card Statements.`,
    `${IN_REVIEW_NOW} is in review now and keeps its current chain.`,
  ];
  if (v === "c") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-hairline bg-surface p-4">
          <div className="caps-label mb-3">Now</div>
          <ChainFlow stages={stages} />
        </div>
        <div className="rounded-xl border border-brand bg-brand-soft p-4">
          <div className="caps-label mb-3">After</div>
          <ChainFlow stages={[...stages, next]} ghost="new" />
        </div>
        <ul className="col-span-2 flex flex-col gap-1.5 text-[14px] text-text">
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>
    );
  }
  if (v === "b") {
    return (
      <div className="flex flex-col gap-3">
        <ChainFlow stages={[...stages, next]} ghost="new" />
        <ul className="flex flex-col gap-1.5 text-[14px] text-text">
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-[14px] text-text">
      <ChainFlow stages={[...stages, next]} ghost="new" />
      {lines.map((l) => <p key={l}>{l}</p>)}
    </div>
  );
}

function AddStage({ v, onDone }: { v: Variant; onDone: () => void }) {
  const s = useStore();
  const [name, setName] = useState(LEGAL_STAGE.name);
  const [who, setWho] = useState("dana");
  const reviewers = ["dana", "riley", "morgan"].map((id) => ({ value: id, label: PEOPLE[id]!.name }));
  const commit = () => {
    s.addStage({ id: `s${s.stages.length + 1}`, name: name.trim(), reviewers: [who] });
    onDone();
  };
  return (
    <div className={cn("flex flex-col gap-4", v === "a" && "py-4")}>
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="caps-label mb-1.5 block">Stage name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Stage name" />
        </label>
        <label className="w-52">
          <span className="caps-label mb-1.5 block">Reviewer</span>
          <Pick label="Reviewer" value={who} onChange={setWho} options={reviewers} className="w-full" />
        </label>
      </div>
      <div className="rounded-lg bg-surface-sunken p-4">
        <Consequence stages={s.stages} name={name} reviewer={who} v={v} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button disabled={!name.trim()} onClick={commit}>Add {name.trim() || "stage"} stage</Button>
        </div>
      </div>
    </div>
  );
}

function ApprovalChains({ v }: { v: Variant }) {
  const s = useStore();
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<string>("s1");
  const added = s.stages.length > 1;
  const removeAct = (st: Stage) => (
    <ConfirmRemove stage={st} onDone={() => setSel("s1")} />
  );

  if (v === "a") {
    return (
      <div>
        <div className="flex items-baseline justify-between border-b border-hairline pb-2">
          <span className="caps-label">Disclosure</span>
          <ChainFlow stages={s.stages} />
        </div>
        {s.stages.map((st, i) => (
          <div key={st.id} className="grid min-h-16 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-hairline py-2.5">
            <span className="text-[14px] text-text-muted tabular-nums">{i + 1}</span>
            <div>
              <div className="text-[15px] font-medium text-text">{st.name}</div>
              <div className="mt-1 text-[13px] text-text-muted"><Reviewers ids={st.reviewers} /></div>
            </div>
            {i > 0 ? removeAct(st) : null}
          </div>
        ))}
        {adding ? (
          <AddStage v={v} onDone={() => setAdding(false)} />
        ) : (
          <div className="pt-4">
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />
              Add stage
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (v === "b") {
    const stage = s.stages.find((x) => x.id === sel) ?? s.stages[0]!;
    return (
      <div className="grid grid-cols-[15rem_minmax(0,1fr)] gap-8">
        <ul className="flex flex-col gap-0.5" aria-label="Stages">
          {s.stages.map((st, i) => (
            <li key={st.id}>
              <button
                type="button"
                aria-current={!adding && st.id === stage.id ? "true" : undefined}
                onClick={() => { setSel(st.id); setAdding(false); }}
                className={cn("flex h-14 w-full items-center gap-3 rounded-lg px-3 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring", !adding && st.id === stage.id && "bg-selected hover:bg-selected")}
              >
                <span className="grid size-6 place-items-center rounded-full border border-hairline-strong text-[12px] text-text-muted">{i + 1}</span>
                <span className="truncate text-[15px] font-medium text-text">{st.name}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-current={adding ? "true" : undefined}
              onClick={() => setAdding(true)}
              className={cn("flex h-14 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-text-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring", adding && "bg-selected hover:bg-selected")}
            >
              <Plus aria-hidden strokeWidth={1.75} className="size-6 rounded-full border border-dashed border-hairline-strong p-1" />
              Add stage
            </button>
          </li>
        </ul>
        <div className="min-w-0 rounded-xl border border-hairline p-6">
          {adding ? (
            <AddStage v={v} onDone={() => setAdding(false)} />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="text-[18px] font-medium text-text">{stage.name}</div>
              <div>
                <div className="caps-label mb-1.5">Reviewers</div>
                <div className="text-[14px] text-text"><Reviewers ids={stage.reviewers} /></div>
              </div>
              <div>
                <div className="caps-label mb-2">Chain</div>
                <ChainFlow stages={s.stages} />
              </div>
              {stage.id !== "s1" ? <div>{removeAct(stage)}</div> : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex items-stretch gap-2">
        <li className="grid place-items-center px-1 text-[13px] text-text-muted">Submitted</li>
        {s.stages.map((st, i) => (
          <li key={st.id} className="flex min-w-0 flex-1 items-stretch gap-2">
            <span aria-hidden className="grid place-items-center text-text-muted">→</span>
            <div className="min-w-0 flex-1 rounded-xl border border-hairline bg-surface-tinted p-4">
              <div className="caps-label">Stage {i + 1}</div>
              <div className="mt-1.5 truncate text-[15px] font-medium text-text">{st.name}</div>
              <div className="mt-2 text-[13px] text-text-muted"><Reviewers ids={st.reviewers} /></div>
              {i > 0 ? <div className="mt-3">{removeAct(st)}</div> : null}
            </div>
          </li>
        ))}
        {!added ? (
          <li className="flex min-w-0 flex-1 items-stretch gap-2">
            <span aria-hidden className="grid place-items-center text-text-muted">→</span>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={cn("flex min-h-28 flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-hairline-strong text-[14px] text-text-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring", adding && "border-brand bg-brand-soft text-brand")}
            >
              <Plus aria-hidden strokeWidth={1.75} className="size-5" />
              Add stage
            </button>
          </li>
        ) : null}
        <li className="flex items-stretch gap-2">
          <span aria-hidden className="grid place-items-center text-text-muted">→</span>
          <span className="grid place-items-center px-1 text-[13px] text-text-muted">Active</span>
        </li>
      </ol>
      {adding ? <AddStage v={v} onDone={() => setAdding(false)} /> : null}
    </div>
  );
}

function ConfirmRemove({ stage, onDone }: { stage: Stage; onDone: () => void }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const act: Act = {
    key: "rm",
    label: "Remove stage",
    consequence: `New Disclosure submissions skip ${stage.name} and go live after Compliance review. ${PEOPLE[stage.reviewers[0]!]!.first} stops seeing review requests.`,
    confirmLabel: "Remove stage",
    run: () => {
      s.removeStage(stage.id);
      onDone();
    },
  };
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Remove</Button>;
  return (
    <div className="mt-2 w-full max-w-md">
      <ConfirmStrip act={act} onCancel={() => setOpen(false)} onConfirm={() => act.run()} />
    </div>
  );
}

/* ----------------------------------------------------------------- Router */

export const SECTION_LINE: Record<string, (count: Record<string, number>) => string> = {
  members: (c) => `${TEAM} · ${plural(c.members ?? 0, "member")}`,
  "access-requests": (c) => `${TEAM} · ${c.requests ? `${c.requests} waiting` : "None waiting"}`,
  recertification: () => `${TEAM} · ${RECERT_NAME}`,
  inactivity: () => `${TEAM} · Flagged at ${INACTIVE_FLAG_DAYS} days, suspended at ${INACTIVE_SUSPEND_DAYS}`,
  teams: (c) => `All teams · ${c.teams ?? 0} teams`,
  "content-types": () => "All teams",
  "channel-rules": () => "All teams · Content type by channel",
  "approval-chains": () => "All teams · Disclosure",
};

export function SectionBody({ section, v }: { section: string; v: Variant }) {
  const s = useStore();
  const counts = {
    members: s.members.length,
    requests: REQUESTS.filter((r) => !s.reqs[r.id]).length,
    teams: s.teams.length,
  };
  const [creating, setCreating] = useState(false);
  const title: Record<string, string> = {
    members: "Members",
    "access-requests": "Access requests",
    recertification: "Recertification",
    inactivity: "Inactivity",
    teams: "Teams",
    "content-types": "Content types",
    "channel-rules": "Channel rules",
    "approval-chains": "Approval chains",
  };
  return (
    <div data-section={section} data-slot="settings-section">
      <Head
        title={title[section]!}
        line={SECTION_LINE[section]!(counts)}
        action={
          section === "teams" && !creating ? (
            <Button onClick={() => setCreating(true)} className="mr-12">
              <Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />
              Create team
            </Button>
          ) : undefined
        }
      />
      <div className="mt-8 pb-10">
        {section === "members" ? <Members v={v} /> : null}
        {section === "access-requests" ? <AccessRequests v={v} /> : null}
        {section === "recertification" ? <Recertification v={v} /> : null}
        {section === "inactivity" ? <Inactivity v={v} /> : null}
        {section === "teams" ? <Teams v={v} adding={creating} setAdding={setCreating} /> : null}
        {section === "content-types" ? <ContentTypes v={v} /> : null}
        {section === "channel-rules" ? <ChannelRules v={v} /> : null}
        {section === "approval-chains" ? <ApprovalChains v={v} /> : null}
      </div>
    </div>
  );
}
