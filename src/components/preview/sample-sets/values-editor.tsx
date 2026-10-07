"use client";

// The values editor: the body of the popover that "Edit values…" opens. One row per variable, in
// variable order: type icon, label and key on the left, the value on the right. A custom set also
// has a name field on top and a Delete at the bottom.
//
// Typing is a draft. A value is committed on blur, Enter or Esc: a valid one is normalized to its
// canonical form and stored at once (`onChange`, so the preview re-renders), an invalid one gets an
// error ring and validateValue's short message and is not stored. Closing the popover drops what
// was never committed. An emptied value is stored as "" and the field is marked quietly.

import { Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { SampleSet, Variable, VariableType } from "@/editor/model/types";
import { formatValue } from "@/editor/model/variables";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FIELD_FOCUS_RING, FOCUS_RING } from "./classes";
import {
  MAX_SET_NAME_LENGTH,
  commitInput,
  isDefaultSet,
  isEdited,
  renameSet,
  resolveSetValues,
  setValue,
  validateSetName,
} from "./model";
import { TypeIcon } from "./type-icon";

export interface ValuesEditorProps {
  set: SampleSet;
  /** The whole list, so an edit can hand back the next list. */
  sets: readonly SampleSet[];
  variables: readonly Variable[];
  today: string;
  /** False shows the values as plain text. */
  editable: boolean;
  /** The name field takes focus first (a set just made). */
  focusName: boolean;
  onChange: (sets: SampleSet[]) => void;
  /** A custom set's Delete, after its quiet confirm when it holds edits. */
  onDelete: () => void;
}

/** The marker the popover's initial focus looks for. */
export const AUTOFOCUS_ATTR = "data-autofocus";

const ROW = "grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-start gap-x-3";
const INPUT = cn("h-8 rounded-lg bg-surface px-2.5 text-[13px] md:text-[13px]", FIELD_FOCUS_RING);

const INPUT_MODE: Partial<Record<VariableType, "decimal">> = {
  currency: "decimal",
  percent: "decimal",
  number: "decimal",
};

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}

export function ValuesEditor({ set, sets, variables, today, editable, focusName, onChange, onDelete }: ValuesEditorProps) {
  const uid = useId();
  const resolved = useMemo(() => resolveSetValues(set, variables, today), [set, variables, today]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const selectNameOnFocus = useRef(focusName);
  const deleteRef = useRef<HTMLButtonElement>(null);

  const custom = !isDefaultSet(set.id);
  const fieldId = (key: string) => `${uid}-v-${key}`;
  const nameId = `${uid}-name`;

  // ── Values ─────────────────────────────────────────────────────

  const commit = (variable: Variable) => {
    const draft = drafts[variable.key];
    if (draft === undefined) return;
    const result = commitInput(variable, draft);
    if (!result.ok) {
      setErrors((current) => ({ ...current, [variable.key]: result.message }));
      return;
    }
    setDrafts((current) => omit(current, variable.key));
    setErrors((current) => omit(current, variable.key));
    if (result.value !== String(resolved[variable.key])) onChange(setValue(sets, set.id, variable.key, result.value));
  };

  const type = (variable: Variable, text: string) => {
    setDrafts((current) => ({ ...current, [variable.key]: text }));
    setErrors((current) => omit(current, variable.key)); // judged again on blur
  };

  const onFieldKeyDown = (variable: Variable) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    // Esc closes the popover; the value typed so far is committed first.
    if (event.key === "Enter" || event.key === "Escape") {
      if (event.key === "Enter") event.preventDefault();
      commit(variable);
    }
  };

  // ── Name ───────────────────────────────────────────────────────

  const commitName = () => {
    if (nameDraft === null) return;
    const result = validateSetName(sets, set.id, nameDraft);
    if (!result.ok) {
      setNameError(result.message);
      return;
    }
    setNameDraft(null);
    setNameError(null);
    if (result.name !== set.name) onChange(renameSet(sets, set.id, result.name));
  };

  const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === "Escape") {
      if (event.key === "Enter") event.preventDefault();
      commitName();
    }
  };

  // ── Delete ─────────────────────────────────────────────────────

  const requestDelete = () => {
    if (isEdited(set, variables, today)) setConfirming(true);
    else onDelete();
  };

  // Cancelling puts focus back on Delete set, which comes back with the next render.
  const restoreDeleteFocus = useRef(false);
  useEffect(() => {
    if (confirming || !restoreDeleteFocus.current) return;
    restoreDeleteFocus.current = false;
    deleteRef.current?.focus({ preventScroll: true });
  }, [confirming]);

  const cancelDelete = () => {
    restoreDeleteFocus.current = true;
    setConfirming(false);
  };

  // The value that takes focus when the popover opens: the name of a new set, else the first
  // required value that was emptied, else the first value.
  const firstEmptyRequired = variables.find((v) => v.required && String(resolved[v.key]).trim() === "");
  const autofocusKey = focusName && custom ? null : (firstEmptyRequired ?? variables[0])?.key;

  if (!editable) {
    return (
      <dl className="m-0 flex min-h-0 flex-col gap-2.5 overflow-y-auto px-4 py-4">
        {variables.map((variable) => {
          const text = String(resolved[variable.key]);
          return (
            <div key={variable.key} className={ROW}>
              <dt className="min-w-0">
                <VariableLabel variable={variable} />
              </dt>
              <dd className="m-0 flex min-h-8 min-w-0 items-center text-[13px] text-text">
                {text.trim() === "" ? (
                  <>
                    <span aria-hidden className="text-text-subtle">
                      —
                    </span>
                    <span className="sr-only">Empty</span>
                  </>
                ) : (
                  <span className="truncate" title={formatValue(variable.type, text)}>
                    {formatValue(variable.type, text)}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return (
    <>
      {custom ? (
        <div className="border-b border-hairline px-4 py-3">
          <div className={ROW}>
            <label htmlFor={nameId} className="flex min-h-8 items-center text-[13px] text-text">
              Name
            </label>
            <div className="min-w-0">
              <Input
                id={nameId}
                {...(focusName ? { [AUTOFOCUS_ATTR]: "" } : {})}
                value={nameDraft ?? set.name}
                maxLength={MAX_SET_NAME_LENGTH}
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  setNameError(null);
                }}
                onFocus={(event) => {
                  if (selectNameOnFocus.current) {
                    selectNameOnFocus.current = false;
                    event.currentTarget.select();
                  }
                }}
                onBlur={commitName}
                onKeyDown={onNameKeyDown}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? `${nameId}-error` : undefined}
                className={cn(INPUT, "aria-invalid:border-destructive")}
              />
              {nameError ? <FieldError id={`${nameId}-error`}>{nameError}</FieldError> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div role="group" aria-label="Sample values" className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-4 py-4">
        {variables.map((variable) => {
          const key = variable.key;
          const draft = drafts[key];
          const error = errors[key];
          const stored = String(resolved[key]);
          const emptied = draft === undefined && stored.trim() === "";
          const markEmpty = emptied && variable.required;
          const errorId = error ? `${fieldId(key)}-error` : undefined;
          const emptyId = markEmpty ? `${fieldId(key)}-empty` : undefined;
          return (
            <div key={key} className={ROW}>
              <VariableLabel variable={variable} htmlFor={fieldId(key)} />
              <div className="min-w-0">
                <Input
                  id={fieldId(key)}
                  {...(key === autofocusKey ? { [AUTOFOCUS_ATTR]: "" } : {})}
                  value={draft ?? stored}
                  onChange={(event) => type(variable, event.target.value)}
                  onBlur={() => commit(variable)}
                  onKeyDown={onFieldKeyDown(variable)}
                  inputMode={INPUT_MODE[variable.type]}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={errorId ?? emptyId}
                  className={cn(
                    INPUT,
                    "aria-invalid:border-destructive",
                    markEmpty && "border-status-review-border bg-status-review",
                  )}
                />
                {markEmpty ? (
                  <span id={emptyId} className="sr-only">
                    Required, and empty
                  </span>
                ) : null}
                {error ? <FieldError id={errorId}>{error}</FieldError> : null}
              </div>
            </div>
          );
        })}
      </div>

      {custom ? (
        <div className="flex min-h-12 items-center gap-2 border-t border-hairline px-4 py-2">
          {confirming ? (
            <div
              role="group"
              aria-label="Confirm delete"
              className="flex w-full items-center gap-2"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                cancelDelete();
              }}
            >
              <p className="min-w-0 flex-1 text-[13px] leading-5 text-text-muted">Delete this set and its edits?</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                autoFocus
                onClick={cancelDelete}
                className={cn("font-normal text-text-muted", FOCUS_RING)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className={cn("font-normal text-danger-text hover:bg-danger-soft hover:text-danger-text", FOCUS_RING)}
              >
                Delete
              </Button>
            </div>
          ) : (
            <Button
              ref={deleteRef}
              type="button"
              variant="ghost"
              size="sm"
              onClick={requestDelete}
              className={cn(
                "-ml-1.5 gap-1.5 px-1.5 font-normal text-danger-text hover:bg-danger-soft hover:text-danger-text",
                FOCUS_RING,
              )}
            >
              <Trash2 strokeWidth={1.75} aria-hidden />
              Delete set
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}

/** The left cell of a row: type icon and label, the key under it in small mono. */
function VariableLabel({ variable, htmlFor }: { variable: Variable; htmlFor?: string }) {
  const name = (
    <>
      <TypeIcon type={variable.type} />
      <span className="truncate">{variable.label}</span>
    </>
  );
  const className = "flex min-w-0 items-center gap-1.5 text-[13px] leading-5 text-text";
  return (
    <div className="flex min-h-8 min-w-0 flex-col justify-center">
      {htmlFor ? (
        <label htmlFor={htmlFor} title={variable.label} className={className}>
          {name}
        </label>
      ) : (
        <span title={variable.label} className={className}>
          {name}
        </span>
      )}
      <span className="truncate pl-5 font-mono text-[11px] leading-4 text-text-subtle">{variable.key}</span>
    </div>
  );
}

function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-danger-text">
      {children}
    </p>
  );
}
