"use client";

// The compact variable form: label, key, type, required, sample. One component for every place a
// variable is made or changed: Create in the `{{` picker, New variable and Edit in the panel.
//
// The key follows the label (snake_case, unique) until someone edits it. Enter saves from any field,
// the type Select's trigger included; Esc cancels. Messages appear only once a save is blocked.

import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select as SelectParts } from "@base-ui/react/select";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cx } from "../lib/cx";
import { generatedKey, sampleForType, validateDraft, type DraftErrors, type DraftField, type VariableDraft } from "../model/draft";
import { VARIABLE_TYPES, type Variable, type VariableType } from "../model/types";
import { TYPE_META } from "../model/variables";
import type { VariableResult } from "../state/variable-store";
import { FIELD_FOCUS_RING, FOCUS_RING } from "./classes";
import { TYPE_ICONS } from "./type-icon";

export interface VariableFormProps {
  mode: "create" | "edit";
  initial: VariableDraft;
  /** Keys already in the list, except the edited variable's own. */
  takenKeys: ReadonlySet<string>;
  /** Saves the variable; a refusal (a key taken meanwhile) shows on the key field. */
  onSubmit: (variable: Variable) => VariableResult;
  onCancel: () => void;
  /** Edit only: shows Delete. */
  onDelete?: () => void;
  className?: string;
}

/** Where a Select's options render (a portal): keys pressed there belong to the Select. */
export const SELECT_CONTENT_SELECTOR = '[data-slot="select-content"]';

const INPUT = cx("h-8 rounded-lg bg-surface px-2.5 text-sm", FIELD_FOCUS_RING);
const FIELD_LABEL = "text-xs text-text-muted";

const INPUT_MODE: Partial<Record<VariableType, "decimal" | "numeric" | "text">> = {
  currency: "decimal",
  percent: "decimal",
  number: "decimal",
};

export function VariableForm({ mode, initial, takenKeys, onSubmit, onCancel, onDelete, className }: VariableFormProps) {
  const id = useId();
  const [draft, setDraft] = useState<VariableDraft>(initial);
  const [keyEdited, setKeyEdited] = useState(mode === "edit");
  const [errors, setErrors] = useState<DraftErrors>({});
  const [attempted, setAttempted] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const input = labelRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const update = (next: VariableDraft) => {
    setDraft(next);
    if (attempted) {
      const result = validateDraft(next, { takenKeys });
      setErrors(result.ok ? {} : result.errors);
    }
  };

  const follows = mode === "create" && !keyEdited;

  const setLabel = (label: string) => update({ ...draft, label, key: follows ? generatedKey(label, takenKeys) : draft.key });

  const setKey = (key: string) => {
    setKeyEdited(key !== "");
    update({ ...draft, key });
  };

  const setType = (type: VariableType) => update({ ...draft, type, sample: sampleForType(draft.sample, type) });

  const submit = () => {
    setAttempted(true);
    const result = validateDraft(draft, { takenKeys });
    if (!result.ok) {
      setErrors(result.errors);
      const first = (["label", "key", "sample"] as DraftField[]).find((field) => result.errors[field]);
      if (first) formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-${first}`)}`)?.focus();
      return;
    }
    const saved = onSubmit(result.variable);
    if (!saved.ok) setErrors({ key: saved.reason === "invalid_key" ? "Use a–z, 0–9 and _, starting with a letter" : "Another variable has this key" });
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  // Capture phase, so Enter on the closed type Select saves instead of opening it, and Esc
  // cancels from any field. Keys inside an open Select's options stay with the Select.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(SELECT_CONTENT_SELECTOR)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    const slot = target.dataset.slot;
    if (target instanceof HTMLButtonElement && slot !== "select-trigger" && slot !== "switch") return; // Enter = click
    event.preventDefault();
    event.stopPropagation();
    submit();
  };

  const fieldId = (field: string) => `${id}-${field}`;
  const errorId = (field: DraftField) => (errors[field] ? `${id}-${field}-error` : undefined);

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={mode === "create" ? "New variable" : `Edit ${initial.label}`}
      onSubmit={onFormSubmit}
      onKeyDownCapture={onKeyDownCapture}
      className={cx("grid gap-3", className)}
    >
      <Field label="Label" htmlFor={fieldId("label")} error={errors.label} errorId={errorId("label")}>
        <Input
          ref={labelRef}
          id={fieldId("label")}
          value={draft.label}
          onChange={(event) => setLabel(event.target.value)}
          autoComplete="off"
          aria-invalid={errors.label ? true : undefined}
          aria-describedby={errorId("label")}
          className={INPUT}
        />
      </Field>

      <Field label="Key" htmlFor={fieldId("key")} error={errors.key} errorId={errorId("key")}>
        <Input
          id={fieldId("key")}
          value={draft.key}
          onChange={(event) => setKey(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={errors.key ? true : undefined}
          aria-describedby={errorId("key")}
          className={cx(INPUT, "font-mono text-[13px]")}
        />
      </Field>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <Field label="Type" htmlFor={fieldId("type")}>
          <Select value={draft.type} onValueChange={(value) => value && setType(value as VariableType)}>
            <SelectTrigger id={fieldId("type")} className={cx("h-8 w-full bg-surface", FIELD_FOCUS_RING)}>
              <SelectValue>{(value: VariableType) => <TypeLabel type={value} />}</SelectValue>
            </SelectTrigger>
            {/* The options render inside the form (so inside the panel's or the picker's region), fixed
                so the picker's scroll box doesn't clip them. Same look as shadcn's SelectContent. */}
            <SelectParts.Portal container={formRef}>
              <SelectParts.Positioner positionMethod="fixed" sideOffset={4} alignItemWithTrigger className="isolate z-50">
                <SelectParts.Popup
                  data-slot="select-content"
                  className="relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-pop ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
                >
                  <SelectParts.List>
                    {VARIABLE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        <TypeLabel type={type} />
                      </SelectItem>
                    ))}
                  </SelectParts.List>
                </SelectParts.Popup>
              </SelectParts.Positioner>
            </SelectParts.Portal>
          </Select>
        </Field>
        <Field label="Required" htmlFor={fieldId("required")}>
          <span className="flex h-8 items-center">
            <Switch
              id={fieldId("required")}
              aria-label="Required"
              className={cx("data-unchecked:bg-control-off", FOCUS_RING)}
              checked={draft.required}
              onCheckedChange={(required) => update({ ...draft, required })}
            />
          </span>
        </Field>
      </div>

      <Field label="Sample" htmlFor={fieldId("sample")} error={errors.sample} errorId={errorId("sample")}>
        <Input
          id={fieldId("sample")}
          type={draft.type === "date" ? "date" : "text"}
          inputMode={INPUT_MODE[draft.type]}
          value={draft.sample}
          onChange={(event) => update({ ...draft, sample: event.target.value })}
          autoComplete="off"
          aria-invalid={errors.sample ? true : undefined}
          aria-describedby={errorId("sample")}
          className={INPUT}
        />
      </Field>

      <div className="flex items-center gap-2 pt-0.5">
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className={cx("-ml-1.5 gap-1.5 px-1.5 font-normal text-danger-text hover:bg-danger-soft hover:text-danger-text", FOCUS_RING)}
          >
            <Trash2 strokeWidth={1.75} aria-hidden />
            Delete
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} className={cx("font-normal text-text-muted", FOCUS_RING)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" className={cx("px-3", FOCUS_RING)}>
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TypeLabel({ type }: { type: VariableType }) {
  const Icon = TYPE_ICONS[type];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-text-muted" strokeWidth={1.75} aria-hidden />
      <span className="truncate">{TYPE_META[type].label}</span>
    </span>
  );
}
