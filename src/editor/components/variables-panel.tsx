"use client";

// <VariablesPanel>: the template's variables. Each row shows the type, label, key, how often it's
// used and a Required switch. Click (or Enter) on a row inserts its chip where the caret last was;
// rows also drag into the document. The pencil (revealed on hover and focus) opens the same compact
// form as Create, with Delete. With a `baseline`, contract changes are flagged on their rows.
//
// Rows subscribe to their own usage count, so typing re-renders nothing here; a row re-renders
// only when its own numbers change.

import { PencilLine, Plus, TriangleAlert } from "lucide-react";
import { memo, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { VARIABLE_DRAG_TYPE } from "../extensions/field-binding";
import { cx } from "../lib/cx";
import { useLiveStore } from "../lib/use-live-store";
import { diffVariables } from "../model/contract";
import { draftFromVariable, newDraft } from "../model/draft";
import type { ContractChange, Variable } from "../model/types";
import { TYPE_META } from "../model/variables";
import type { EditorRootRuntime } from "../state/editor-root";
import type { VariablesPanelProps } from "../types";
import { FOCUS_RING } from "./classes";
import { useEditorRoot } from "./editor-root";
import { TYPE_ICONS } from "./type-icon";
import { VariableChipView } from "./variable-chip";
import { VariableForm } from "./variable-form";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

/** The off track reads as taupe, like the reference toggles (shadcn's default is near-white). */
const SWITCH_TRACK = "data-unchecked:bg-control-off";

interface RowFlag {
  text: string;
  breaking: boolean;
  /** What it was, for the title ("Was purchase_rate"). */
  detail?: string;
}

const FLAG_ORDER: ContractChange["kind"][] = ["key_renamed", "type_changed", "made_required", "added", "made_optional"];

/** Per-key flags for the rows, from the contract diff (labels are display-only, never flagged). */
function rowFlags(changes: readonly ContractChange[]): Map<string, RowFlag[]> {
  const byKey = new Map<string, RowFlag[]>();
  const sorted = changes
    .filter((c) => c.kind !== "label_changed" && c.kind !== "removed")
    .sort((a, b) => FLAG_ORDER.indexOf(a.kind) - FLAG_ORDER.indexOf(b.kind));
  for (const change of sorted) {
    const flag = flagFor(change);
    byKey.set(change.key, [...(byKey.get(change.key) ?? []), flag]);
  }
  return byKey;
}

function flagFor(change: ContractChange): RowFlag {
  switch (change.kind) {
    case "key_renamed":
      return { text: "Key changed", breaking: true, detail: `Was ${change.from}` };
    case "type_changed":
      return {
        text: "Type changed",
        breaking: true,
        detail: change.from ? `Was ${TYPE_META[change.from as Variable["type"]]?.label ?? change.from}` : undefined,
      };
    case "made_required":
      return { text: "Now required", breaking: true };
    case "made_optional":
      return { text: "Now optional", breaking: false };
    default:
      return { text: "New", breaking: change.breaking };
  }
}

function usesText(count: number): string {
  if (count === 0) return "Unused";
  return count === 1 ? "1 use" : `${count} uses`;
}

export function VariablesPanel({ className }: VariablesPanelProps) {
  const root = useEditorRoot("VariablesPanel");
  const variables = useStore(root.variables, (s) => s.variables);
  const renames = useStore(root.variables, (s) => s.renames);
  const readOnly = useStore(root.config, (s) => s.readOnly);
  const baseline = useStore(root.config, (s) => s.baseline);
  const headingId = useId();

  const changes = useMemo(() => (baseline ? diffVariables(baseline, variables, { renames }) : []), [baseline, variables, renames]);
  const flags = useMemo(() => rowFlags(changes), [changes]);
  const removed = useMemo(() => changes.filter((c) => c.kind === "removed"), [changes]);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ variable: Variable; count: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const deletedRef = useRef(false);

  const editing = readOnly ? null : editingKey;
  const creating = !readOnly && creatingOpen;

  const keys = useMemo(() => new Set(variables.map((v) => v.key)), [variables]);

  const focusRow = (key: string) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-variable-row="${CSS.escape(key)}"] [data-row-insert]`)?.focus(),
    );
  const focusNew = () => requestAnimationFrame(() => newButtonRef.current?.focus());

  const requestDelete = (variable: Variable) => {
    root.flushUsage();
    const count = root.usage.getState().byKey.get(variable.key)?.count ?? 0;
    if (count === 0) {
      root.deleteVariable(variable.key);
      setEditingKey(null);
      focusNew();
      return;
    }
    deletedRef.current = false;
    setConfirm({ variable, count });
  };

  const finishDelete = (removeChips: boolean) => {
    if (!confirm) return;
    root.deleteVariable(confirm.variable.key, { removeChips });
    deletedRef.current = true;
    setConfirm(null);
    setEditingKey(null);
  };

  // ↑ ↓ move between rows.
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target as HTMLElement;
    if (!target.matches("[data-row-insert]")) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row-insert]") ?? [])];
    const next = rows[rows.indexOf(target) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <section aria-labelledby={headingId} className={cx("flex min-w-0 flex-col", className)}>
      <div className="flex items-baseline justify-between px-2 pb-2">
        <h2 id={headingId} className="caps-label">
          Variables
        </h2>
        {variables.length && !readOnly ? (
          <span className="caps-label" aria-hidden>
            Required
          </span>
        ) : null}
      </div>

      <ul ref={listRef} className="grid gap-0.5" onKeyDown={onListKeyDown}>
        {variables.map((variable) =>
          editing === variable.key ? (
            <li key={variable.key} className="my-1 rounded-xl border border-hairline bg-surface p-3">
              <VariableForm
                mode="edit"
                initial={draftFromVariable(variable)}
                takenKeys={withoutKey(keys, variable.key)}
                onSubmit={(next) => {
                  const result = root.updateVariable(variable.key, next);
                  if (result.ok) {
                    setEditingKey(null);
                    focusRow(next.key);
                  }
                  return result;
                }}
                onCancel={() => {
                  setEditingKey(null);
                  focusRow(variable.key);
                }}
                onDelete={() => requestDelete(variable)}
              />
            </li>
          ) : (
            <VariableRow
              key={variable.key}
              root={root}
              variable={variable}
              flags={flags.get(variable.key)}
              readOnly={readOnly}
              onEdit={setEditingKey}
            />
          ),
        )}
        {creating ? (
          <li className="my-1 rounded-xl border border-hairline bg-surface p-3">
            <VariableForm
              mode="create"
              initial={newDraft("", keys)}
              takenKeys={keys}
              onSubmit={(variable) => {
                const result = root.createVariable(variable);
                if (result.ok) {
                  setCreatingOpen(false);
                  focusRow(variable.key);
                }
                return result;
              }}
              onCancel={() => {
                setCreatingOpen(false);
                focusNew();
              }}
            />
          </li>
        ) : null}
      </ul>

      {removed.length ? <RemovedLine changes={removed} /> : null}

      {!readOnly && !creating ? (
        <Button
          ref={newButtonRef}
          type="button"
          variant="ghost"
          onClick={() => {
            setEditingKey(null);
            setCreatingOpen(true);
          }}
          className={cx("mt-1 h-9 justify-start gap-2.5 rounded-lg px-2 font-normal text-text-muted hover:bg-hover hover:text-text", FOCUS_RING)}
        >
          <span className="flex size-7 items-center justify-center">
            <Plus className="size-4" {...ICON} />
          </span>
          New variable
        </Button>
      ) : null}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent finalFocus={() => (deletedRef.current ? newButtonRef.current : true)}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirm?.variable.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? `It’s used ${confirm.count === 1 ? "once" : `${confirm.count} times`} in this template. ` : ""}
              Chips you keep show its key and are marked as missing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost" className={FOCUS_RING}>
              Cancel
            </AlertDialogCancel>
            <Button variant="outline" onClick={() => finishDelete(false)} className={FOCUS_RING}>
              Keep chips
            </Button>
            <Button onClick={() => finishDelete(true)} className={FOCUS_RING}>
              Remove chips
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function withoutKey(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  next.delete(key);
  return next;
}

interface VariableRowProps {
  root: EditorRootRuntime;
  variable: Variable;
  flags: RowFlag[] | undefined;
  readOnly: boolean;
  onEdit: (key: string) => void;
}

const VariableRow = memo(function VariableRow({ root, variable, flags, readOnly, onEdit }: VariableRowProps) {
  const count = useLiveStore(root.usage, (s) => s.byKey.get(variable.key)?.count ?? 0);
  // Before any field registered (the panel rendered ahead of the document), counts are unknown:
  // leave them out rather than mute every row. They fill in on the same line, so nothing shifts.
  const ready = useLiveStore(root.usage, (s) => s.ready);
  const ghost = useRef<HTMLSpanElement>(null);
  const metaId = useId();
  const Icon = TYPE_ICONS[variable.type];
  const unused = ready && count === 0;

  const onDragStart = (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData(VARIABLE_DRAG_TYPE, variable.key);
    event.dataTransfer.effectAllowed = "copy";
    if (ghost.current) event.dataTransfer.setDragImage(ghost.current, 10, 12);
  };

  const content = (
    <>
      <span
        className={cx(
          "flex size-7 shrink-0 items-center justify-center rounded-md border",
          unused ? "border-hairline bg-surface text-text-subtle" : "border-chip-border bg-chip text-chip-icon",
        )}
      >
        <Icon className="size-4" {...ICON} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className={cx("block truncate text-sm leading-5", unused ? "text-text-muted" : "text-text")}>{variable.label}</span>
        <span id={metaId} className="block text-xs leading-4 text-text-muted">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="min-w-0 truncate font-mono text-[11.5px]">{variable.key}</span>
            {ready ? (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 tabular-nums">{usesText(count)}</span>
              </>
            ) : null}
          </span>
          {flags?.length ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {flags.map((flag) => (
                <ContractFlag key={flag.text} flag={flag} />
              ))}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );

  return (
    <li
      data-variable-row={variable.key}
      data-unused={unused ? "" : undefined}
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : onDragStart}
      className={cx("group/row relative flex items-center gap-1 rounded-lg pr-2", !readOnly && "hover:bg-hover")}
    >
      {readOnly ? (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5">{content}</div>
      ) : (
        <button
          type="button"
          data-row-insert=""
          aria-label={`Insert ${variable.label}`}
          aria-describedby={metaId}
          onClick={() => root.insertVariable(variable.key)}
          className={cx("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5", FOCUS_RING)}
        >
          {content}
        </button>
      )}
      {readOnly ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Edit ${variable.label}`}
          onClick={() => onEdit(variable.key)}
          className={cx(
            "text-text-muted opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-selected hover:text-text focus-visible:opacity-100",
            FOCUS_RING,
          )}
        >
          <PencilLine className="size-3.5" {...ICON} />
        </Button>
      )}
      {readOnly ? (
        // Display only: a quiet word where the switch sits (nothing for optional), same row height.
        <span className="ml-1 w-14 shrink-0 text-right text-xs leading-4 text-text-muted">{variable.required ? "Required" : ""}</span>
      ) : (
        <Switch
          size="sm"
          checked={variable.required}
          aria-label={`${variable.label} required`}
          onCheckedChange={(required) => root.updateVariable(variable.key, { required })}
          className={cx("ml-1", SWITCH_TRACK, FOCUS_RING)}
        />
      )}
      {readOnly ? null : (
        // The drag image: the chip this row becomes.
        <span ref={ghost} aria-hidden className="pointer-events-none fixed top-0 -left-[9999px] text-base">
          <VariableChipView variableKey={variable.key} variable={variable} />
        </span>
      )}
    </li>
  );
});

function ContractFlag({ flag }: { flag: RowFlag }) {
  return (
    <span
      title={flag.detail}
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 text-[11px] leading-[18px]",
        flag.breaking ? "border-warning-border bg-warning-soft text-warning-text" : "border-hairline bg-surface-tinted text-text-muted",
      )}
    >
      {flag.breaking ? <TriangleAlert className="size-3" {...ICON} /> : null}
      {flag.text}
      {flag.detail ? <span className="sr-only">. {flag.detail}</span> : null}
    </span>
  );
}

function RemovedLine({ changes }: { changes: readonly ContractChange[] }) {
  return (
    <p className="mt-2 flex items-start gap-2 px-2 text-xs leading-5 text-warning-text">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" {...ICON} />
      <span className="min-w-0">
        Removed{" "}
        {changes.map((change, i) => (
          <span key={change.key}>
            {i ? ", " : ""}
            <span className="font-mono text-[11.5px] break-all">{change.key}</span>
          </span>
        ))}
      </span>
    </p>
  );
}
