"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { ContentTypeView } from "@/domain/access-types";
import { SECTION_TITLE_MAX, describeSectionsChange, removeSectionRefusal } from "@/domain/platform-config";
import { CHANNEL_LABELS } from "@/domain/render/errors";
import type { RequiredSection } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateContentType } from "@/server/actions/platform";
import { Blocked, FullRow, HeaderRow, Strip, plural, useFocusAfterCommit } from "./ui";

// Settings > Platform > Content types. One dense row per type; "Edit sections" opens the required
// sections under the row (rename, reorder, add, remove) with the consequence strip: required sections
// shape templates created from then on, and no existing template changes. The domain words the strip
// and checks the draft as it changes (`describeSectionsChange`), the same check `updateContentType` runs.

const COLS = "minmax(0,1.1fr) minmax(0,1.6fr) minmax(0,1fr) 8.5rem";

export function ContentTypesSectionView({ types }: { types: ContentTypeView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement | null>());

  const focusAfter = useFocusAfterCommit();

  const close = (id: string) => {
    focusAfter(() => openers.current.get(id));
    setOpen(null);
  };

  return (
    <div data-slot="platform-section" data-section="content-types" role="table" aria-label="Content types">
      <HeaderRow cols={COLS} columns={["Content type", "Required sections", "Channels", null]} />
      {types.map((type) => (
        <div key={type.id} role="rowgroup" className="border-b border-hairline">
          <div role="row" className="grid min-h-16 items-center gap-x-4 py-2.5" style={{ gridTemplateColumns: COLS }}>
            <div role="cell" className="min-w-0">
              <div className="truncate text-[15px] font-medium text-text">{type.name}</div>
              <div className="truncate text-[13px] text-text-muted">{plural(type.templates, "template")}</div>
            </div>
            <div role="cell" className="min-w-0 text-[14px] leading-snug text-text">
              {type.requiredSections.map((s) => s.title).join(", ")}
            </div>
            <div role="cell" className="min-w-0 text-[14px] text-text">
              {type.allowedChannels.map((c) => CHANNEL_LABELS[c]).join(", ")}
            </div>
            <div role="cell" className="flex justify-end">
              {open === type.id ? null : (
                <Button
                  ref={(el) => {
                    openers.current.set(type.id, el);
                  }}
                  variant="outline"
                  aria-label={`Edit ${type.name} sections`}
                  onClick={() => setOpen(type.id)}
                >
                  Edit sections
                </Button>
              )}
            </div>
          </div>
          {open === type.id ? (
            <FullRow span={4}>
              <SectionsEditor type={type} onClose={() => close(type.id)} />
            </FullRow>
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface Draft {
  /** The section's key; a section being added has a local `new-n` key (the server makes the real one). */
  key: string;
  title: string;
}

function SectionsEditor({ type, onClose }: { type: ContentTypeView; onClose: () => void }) {
  const [rows, setRows] = useState<Draft[]>(() => type.requiredSections.map((s) => ({ ...s })));
  const nextNew = useRef(1);
  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // Focus: the first title on open, the new row after Add, the neighbour after Remove.
  useEffect(() => {
    const key = focusKey ?? rows[0]?.key;
    inputs.current.get(key ?? "")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  const next: RequiredSection[] = rows.map((r) => ({ key: r.key, title: r.title }));
  // The server's own check and the strip's lines, as the admin edits: nothing known to fail is sent.
  const { problem, changed, lines } = describeSectionsChange({
    contentTypeName: type.name,
    current: type.requiredSections,
    next,
  });
  const removeBlocked = removeSectionRefusal(rows.length);

  const move = (index: number, by: -1 | 1) =>
    setRows((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to]!, copy[index]!];
      return copy;
    });

  return (
    <div
      className="mb-3 flex flex-col gap-3 rounded-lg bg-surface-sunken p-4"
      data-slot="sections-editor"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <ol aria-label={`${type.name} required sections`} className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center gap-2">
            <span className="w-5 text-right text-[13px] text-text-muted tabular-nums">{index + 1}</span>
            <Input
              ref={(el) => {
                inputs.current.set(row.key, el);
              }}
              value={row.title}
              maxLength={SECTION_TITLE_MAX}
              aria-label={`Section ${index + 1} title`}
              onChange={(e) => setRows((list) => list.map((r) => (r.key === row.key ? { ...r, title: e.target.value } : r)))}
              className="flex-1 bg-surface"
            />
            <Button variant="ghost" size="icon" aria-label={`Move ${row.title || `section ${index + 1}`} up`} aria-disabled={index === 0} onClick={() => move(index, -1)} className="aria-disabled:opacity-40">
              <ArrowUp aria-hidden strokeWidth={1.75} />
            </Button>
            <Button variant="ghost" size="icon" aria-label={`Move ${row.title || `section ${index + 1}`} down`} aria-disabled={index === rows.length - 1} onClick={() => move(index, 1)} className="aria-disabled:opacity-40">
              <ArrowDown aria-hidden strokeWidth={1.75} />
            </Button>
            <Blocked reason={removeBlocked}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${row.title || `section ${index + 1}`}`}
                aria-disabled={!!removeBlocked}
                className="aria-disabled:opacity-40"
                onClick={() => {
                  if (removeBlocked) return;
                  setRows((list) => list.filter((r) => r.key !== row.key));
                  setFocusKey(rows[index + 1]?.key ?? rows[index - 1]?.key ?? null);
                }}
              >
                <X aria-hidden strokeWidth={1.75} />
              </Button>
            </Blocked>
          </li>
        ))}
      </ol>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            const key = `new-${nextNew.current++}`;
            setRows((list) => [...list, { key, title: "" }]);
            setFocusKey(key);
          }}
        >
          <Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />
          Add section
        </Button>
      </div>
      <Strip
        focusOnMount={false}
        lines={lines}
        confirmLabel="Save sections"
        blocked={!changed || !!problem}
        message={problem}
        onConfirm={() => updateContentType({ contentTypeId: type.id, requiredSections: next })}
        onCancel={onClose}
        onDone={onClose}
        className="bg-transparent p-0"
      />
    </div>
  );
}
