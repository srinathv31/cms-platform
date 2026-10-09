"use client";

import { Fragment, useId, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Plus } from "lucide-react";
import type { ApprovalChainView, ApprovalChainsSection } from "@/domain/access-types";
import { ROLE_LABEL } from "@/domain/access";
import {
  PLATFORM_REFUSALS,
  STAGE_NAME_MAX,
  describeChainChange,
  ruleLabel,
  validateChain,
  type ChainCardStage,
  type StageProblem,
} from "@/domain/platform-config";
import type { ApproverRule } from "@/domain/types";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveApprovalChain } from "@/server/actions/platform";
import { Blocked, Pick, Strip, useFocusAfterCommit } from "./ui";

// Settings > Platform > Approval chains. Per content type, the ordered stages as dense rows with their
// actions inline (edit, move, remove) and an "Add stage" below. Every edit is a draft: nothing is saved
// until the strip's confirm. The strip shows the chain Now and After side by side, then the plain lines
// (who reviews what, that a named person reviews every team's submissions), so the consequence comes
// before the commitment. The draft is checked as it changes with the domain's `validateChain`, the
// same function the server runs on save: each problem shows under the field it's about, and the
// confirm stays disabled with the first one beside it.

const COLS = "1.5rem minmax(0,0.85fr) minmax(0,1.15fr) auto";

interface DraftStage {
  /** Local identity: the stage's id, or `new-n` for one being added. */
  key: string;
  id?: string;
  name: string;
  rule: ApproverRule;
}

const APPROVER: ApproverRule = { kind: "team_role", role: "approver" };
const ruleValue = (rule: ApproverRule) => (rule.kind === "user" ? `user:${rule.userId}` : `role:${rule.role}`);
const ruleFromValue = (value: string): ApproverRule =>
  value.startsWith("user:")
    ? { kind: "user", userId: value.slice(5) }
    : { kind: "team_role", role: value.slice(5) as Extract<ApproverRule, { kind: "team_role" }>["role"] };

const draftOf = (chain: ApprovalChainView): DraftStage[] =>
  chain.stages.map((s) => ({ key: s.id, id: s.id, name: s.name, rule: s.rule }));

export function ApprovalChainsSectionView({ section }: { section: ApprovalChainsSection }) {
  return (
    <div data-slot="platform-section" data-section="approval-chains" className="flex flex-col gap-10">
      {section.chains.map((chain) => (
        <ChainEditor key={chain.contentTypeId} chain={chain} section={section} />
      ))}
    </div>
  );
}

function ChainEditor({ chain, section }: { chain: ApprovalChainView; section: ApprovalChainsSection }) {
  const [rows, setRows] = useState<DraftStage[]>(() => draftOf(chain));
  const [editing, setEditing] = useState<string | null>(null);
  const nextNew = useRef(1);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAfter = useFocusAfterCommit();
  const fieldId = useId();

  // The saved chain changed (a save landed, or someone else edited it): start the draft over.
  const signature = JSON.stringify(chain.stages.map((s) => [s.id, s.name, s.rule]));
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setRows(draftOf(chain));
    setEditing(null);
  }

  // `people` are the choices; `approvers` also holds whoever a stage names now, so labels and checks cover both.
  const people = section.people;
  const approvers = section.approvers;
  const waiting = Object.fromEntries(chain.stages.map((s) => [s.id, s.waiting]));
  const next = rows.map((r) => ({ id: r.id, name: r.name.trim() || "New stage", rule: r.rule }));
  const change = describeChainChange({
    contentTypeName: chain.name,
    current: chain.stages.map((s) => ({ id: s.id, position: s.position, name: s.name, rule: s.rule })),
    next,
    people: approvers,
    waiting,
  });

  const problems = validateChain({ stages: rows, current: chain.stages, actorId: section.viewerId, people: approvers });
  const problemAt = (index: number, field: StageProblem["field"]) =>
    problems.find((p) => p.stage === index && p.field === field)?.reason ?? null;
  const blocked = problems.length > 0;

  const added = rows.filter((r) => !r.id);
  const removed = chain.stages.filter((s) => !rows.some((r) => r.id === s.id));
  const onlyAdd = added.length === 1 && removed.length === 0;
  const onlyRemove = removed.length === 1 && added.length === 0;
  // An unnamed new stage reads "Save chain" (blocked), never "Add stage" like the button that adds one.
  const confirmLabel =
    onlyAdd && change.after.filter((a) => a.change !== null).length === 1 && added[0]!.name.trim()
      ? `Add ${added[0]!.name.trim()} stage`
      : onlyRemove && change.now.filter((n) => n.change !== null).length === 1 && change.after.every((a) => a.change === null)
        ? `Remove ${removed[0]!.name} stage`
        : "Save chain";

  const patch = (key: string, p: Partial<DraftStage>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (index: number, by: -1 | 1) =>
    setRows((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to]!, copy[index]!];
      return copy;
    });
  const discard = () => {
    focusAfter(() => addButton.current);
    setRows(draftOf(chain));
    setEditing(null);
  };
  // Closing a row's editor: back to its Edit button. A new stage left without a name is dropped
  // (Esc cancels the add), and focus goes back to Add stage.
  const closeEditor = (row: DraftStage, cancel: boolean) => {
    if (cancel && !row.id && !row.name.trim()) {
      focusAfter(() => addButton.current);
      setRows((list) => list.filter((r) => r.key !== row.key));
    } else {
      focusAfter(() => editButtons.current.get(row.key));
    }
    setEditing(null);
  };

  return (
    <section aria-label={`${chain.name} approval chain`} data-content-type={chain.contentTypeId}>
      <div className="flex items-center justify-between gap-4 border-b border-hairline pb-2">
        <h3 className="caps-label">{chain.name}</h3>
        <Flow stages={chain.stages.map((s) => ({ id: s.id, name: s.name, ruleLabel: s.ruleLabel, change: null }))} />
      </div>
      <ol aria-label={`${chain.name} stages`}>
        {rows.map((row, index) => {
          const saved = chain.stages.find((s) => s.id === row.id);
          const isEditing = editing === row.key;
          const removeReason =
            rows.length === 1
              ? PLATFORM_REFUSALS.oneStage
              : saved && saved.waiting > 0
                ? PLATFORM_REFUSALS.stageWaiting(saved.waiting, saved.name)
                : null;
          // A name still being typed isn't flagged while it's empty; the strip still says why Save waits.
          const nameProblem = isEditing && !row.name.trim() ? null : problemAt(index, "name");
          const reviewerProblem = problemAt(index, "reviewer");
          const nameProblemId = `${fieldId}-${row.key}-name-problem`;
          const reviewerProblemId = `${fieldId}-${row.key}-reviewer-problem`;
          // A person the choices leave out (they lost access since): still listed, so the select shows them.
          const namedId = row.rule.kind === "user" ? row.rule.userId : null;
          const unlisted = namedId !== null && !people.some((p) => p.id === namedId);
          return (
            <li
              key={row.key}
              className={cn("grid min-h-16 gap-x-4 border-b border-hairline py-2.5", isEditing ? "items-end" : "items-center")}
              style={{ gridTemplateColumns: COLS }}
              onKeyDown={
                isEditing
                  ? (e) => {
                      // Esc closes this editor first; the draft stays (a second Esc closes Settings).
                      if (e.key !== "Escape") return;
                      e.stopPropagation();
                      closeEditor(row, true);
                    }
                  : undefined
              }
            >
              <span className={cn("text-[14px] text-text-muted tabular-nums", isEditing && "pb-1.5")}>{index + 1}</span>
              <div className="min-w-0">
                {isEditing ? (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${fieldId}-${row.key}-name`} className="text-[13px] text-text-muted">
                      Stage name
                    </label>
                    <Input
                      id={`${fieldId}-${row.key}-name`}
                      autoFocus
                      value={row.name}
                      maxLength={STAGE_NAME_MAX}
                      onChange={(e) => patch(row.key, { name: e.target.value })}
                      aria-invalid={nameProblem ? true : undefined}
                      aria-describedby={nameProblem ? nameProblemId : undefined}
                      className="bg-surface"
                    />
                  </div>
                ) : (
                  <div className="truncate text-[15px] font-medium text-text">{row.name || "New stage"}</div>
                )}
              </div>
              <div className="min-w-0 text-[14px] text-text">
                {isEditing ? (
                  <div className="flex flex-col gap-1.5">
                    <span aria-hidden className="text-[13px] text-text-muted">
                      Reviewer
                    </span>
                    <Pick
                      label="Reviewer"
                      value={ruleValue(row.rule)}
                      onChange={(v) => patch(row.key, { rule: ruleFromValue(v) })}
                      invalid={!!reviewerProblem}
                      describedBy={reviewerProblem ? reviewerProblemId : undefined}
                      className="w-full"
                    >
                      <option value={ruleValue(APPROVER)}>{ruleLabel(APPROVER, people)}</option>
                      {row.rule.kind === "team_role" && row.rule.role !== "approver" ? (
                        <option value={ruleValue(row.rule)}>{`${ROLE_LABEL[row.rule.role]} role`}</option>
                      ) : null}
                      {unlisted ? <option value={ruleValue(row.rule)}>{ruleLabel(row.rule, approvers)}</option> : null}
                      <optgroup label="People">
                        {people.map((p) => (
                          <option key={p.id} value={`user:${p.id}`}>
                            {`${p.name} · ${p.teams.join(", ")}`}
                          </option>
                        ))}
                      </optgroup>
                    </Pick>
                  </div>
                ) : (
                  <span className="block truncate">{ruleLabel(row.rule, approvers)}</span>
                )}
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="icon" aria-label={`Move ${row.name || "stage"} up`} aria-disabled={index === 0} className="aria-disabled:opacity-40" onClick={() => index > 0 && move(index, -1)}>
                  <ArrowUp aria-hidden strokeWidth={1.75} />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Move ${row.name || "stage"} down`} aria-disabled={index === rows.length - 1} className="aria-disabled:opacity-40" onClick={() => index < rows.length - 1 && move(index, 1)}>
                  <ArrowDown aria-hidden strokeWidth={1.75} />
                </Button>
                {isEditing ? (
                  <Button variant="outline" onClick={() => closeEditor(row, false)}>
                    Done
                  </Button>
                ) : (
                  <Button
                    ref={(el) => {
                      editButtons.current.set(row.key, el);
                    }}
                    variant="outline"
                    aria-label={`Edit ${row.name || "stage"}`}
                    onClick={() => setEditing(row.key)}
                  >
                    Edit
                  </Button>
                )}
                <Blocked reason={removeReason}>
                  <Button
                    variant="outline"
                    aria-label={`Remove ${row.name || "stage"}`}
                    aria-disabled={!!removeReason}
                    className="aria-disabled:opacity-50"
                    onClick={() => {
                      if (removeReason) return;
                      focusAfter(() => addButton.current);
                      setRows((list) => list.filter((r) => r.key !== row.key));
                      if (editing === row.key) setEditing(null);
                    }}
                  >
                    Remove
                  </Button>
                </Blocked>
              </div>
              {nameProblem ? (
                <p id={nameProblemId} data-problem="name" className="col-start-2 pt-1 text-[13px] text-danger-text">
                  {nameProblem}
                </p>
              ) : null}
              {reviewerProblem ? (
                <p id={reviewerProblemId} data-problem="reviewer" className="col-start-3 col-end-5 pt-1 text-[13px] text-danger-text">
                  {reviewerProblem}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="pt-4">
        <Button
          ref={addButton}
          variant="outline"
          onClick={() => {
            const key = `new-${nextNew.current++}`;
            setRows((list) => [...list, { key, name: "", rule: APPROVER }]);
            setEditing(key);
          }}
        >
          <Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />
          Add stage
        </Button>
      </div>

      {change.changed ? (
        <Strip
          focusOnMount={false}
          cancelLabel="Discard"
          confirmLabel={confirmLabel}
          blocked={blocked}
          message={problems[0]?.reason ?? null}
          lines={blocked ? [] : change.lines}
          onCancel={discard}
          onDone={() => addButton.current?.focus()}
          onConfirm={() =>
            saveApprovalChain({
              contentTypeId: chain.contentTypeId,
              stages: rows.map((r) => ({ id: r.id, name: r.name.trim(), rule: r.rule })),
            })
          }
          className="mt-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Card label="Now" stages={change.now} />
            <Card label="After" stages={change.after} highlighted />
          </div>
        </Strip>
      ) : null}
    </section>
  );
}

// ── The chain, drawn ─────────────────────────────────────────

/** One side of the Now / After pair: the stages in order, who reviews each. Added is dashed, removed struck. */
function Card({ label, stages, highlighted }: { label: string; stages: ChainCardStage[]; highlighted?: boolean }) {
  return (
    <section
      aria-label={label}
      className={cn("min-w-0 rounded-xl border p-4", highlighted ? "border-brand bg-brand-soft" : "border-hairline bg-surface")}
    >
      <div className="caps-label mb-3">{label}</div>
      <ol className="flex flex-col gap-1.5">
        {stages.map((s, i) => (
          <li
            key={s.id ?? `new-${i}`}
            className={cn(
              "flex min-w-0 items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-[13px] leading-tight",
              s.change === "added" ? "border-dashed border-brand bg-surface text-text" : "border-chip-border bg-chip text-chip-text",
              s.change === "removed" && "text-text-muted line-through",
            )}
          >
            <span aria-hidden className="w-3 shrink-0 text-text-muted tabular-nums no-underline">
              {i + 1}
            </span>
            {s.change === "added" ? <span className="sr-only">Added: </span> : null}
            {s.change === "removed" ? <span className="sr-only">Removed: </span> : null}
            <span className="min-w-0 truncate font-medium">{s.name}</span>
            <span className="ml-auto shrink-0 pl-2 text-[12px] text-text-muted">{s.ruleLabel}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The saved chain in a line: Submitted, each stage, Active. */
function Flow({ stages }: { stages: ChainCardStage[] }) {
  return (
    <ol className="flex flex-wrap items-center justify-end gap-1.5 text-[13px]">
      <li className="px-1 text-text-muted">Submitted</li>
      {stages.map((s, i) => (
        <Fragment key={s.id ?? `new-${i}`}>
          <li aria-hidden className="text-text-muted">
            <ArrowRight strokeWidth={1.75} className="size-3.5" />
          </li>
          <li className="rounded-md border border-chip-border bg-chip px-2 py-1 leading-tight text-chip-text">{s.name}</li>
        </Fragment>
      ))}
      <li aria-hidden className="text-text-muted">
        <ArrowRight strokeWidth={1.75} className="size-3.5" />
      </li>
      <li className="flex">
        <StatusBadge state="active" />
      </li>
    </ol>
  );
}
