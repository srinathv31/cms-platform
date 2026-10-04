"use client";

import { Braces } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DocumentEditor, type JSONContent } from "@/editor";
import { FIXTURES, LAB_VARIABLES, type Fixture, type FixtureId } from "./fixtures";

const JSON_DEBOUNCE_MS = 250;

export function EditorLab({ serverPaint }: { serverPaint: ReactNode }) {
  const [fixtureId, setFixtureId] = useState<FixtureId>("long");
  const [readOnlyToggle, setReadOnlyToggle] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [json, setJson] = useState<JSONContent>(FIXTURES[0].content);

  const fixture = FIXTURES.find((f) => f.id === fixtureId) as Fixture;
  const forcedReadOnly = Boolean(fixture.readOnly);
  const readOnly = forcedReadOnly || readOnlyToggle;

  // The latest document lives in a ref; the JSON panel catches up on a debounce, and only while
  // it's open, so the lab never adds work to a keystroke.
  const latest = useRef<JSONContent>(fixture.content);
  const jsonOpenRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const onChange = useCallback((doc: JSONContent) => {
    latest.current = doc;
    if (!jsonOpenRef.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setJson(doc), JSON_DEBOUNCE_MS);
  }, []);

  const selectFixture = (id: FixtureId) => {
    const next = FIXTURES.find((f) => f.id === id);
    if (!next) return;
    window.clearTimeout(timer.current);
    latest.current = next.content;
    setJson(next.content);
    setFixtureId(id);
  };

  const toggleJson = (open: boolean) => {
    jsonOpenRef.current = open;
    if (open) setJson(latest.current);
    setJsonOpen(open);
  };

  return (
    <div className="min-h-dvh bg-app p-3">
      <Collapsible
        open={jsonOpen}
        onOpenChange={toggleJson}
        render={<main />}
        className="flex min-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-4xl border border-hairline bg-canvas"
      >
        <header className="flex flex-wrap items-center gap-x-8 gap-y-4 px-12 pt-9 pb-2">
          <div className="mr-auto flex flex-col gap-1">
            <span className="caps-label">Dev</span>
            <h1 className="display-lg text-text">Editor lab</h1>
          </div>

          <ToggleGroup
            aria-label="Fixture"
            variant="outline"
            size="sm"
            spacing={0}
            value={[fixtureId]}
            onValueChange={(value) => {
              const id = value[0] as FixtureId | undefined;
              if (id) selectFixture(id);
            }}
            className="bg-surface"
          >
            {FIXTURES.map((f) => (
              <ToggleGroupItem
                key={f.id}
                value={f.id}
                className="px-3 font-normal text-text-muted aria-pressed:bg-selected aria-pressed:text-text"
              >
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <label className="flex items-center gap-2.5 text-sm text-text-muted">
            <Switch
              checked={readOnly}
              disabled={forcedReadOnly}
              onCheckedChange={(checked) => setReadOnlyToggle(checked)}
              aria-label="Read-only"
            />
            Read-only
          </label>

          <CollapsibleTrigger
            render={<Button variant="outline" size="sm" className="gap-1.5 bg-surface font-normal" />}
          >
            <Braces className="size-4" strokeWidth={1.75} aria-hidden />
            JSON
          </CollapsibleTrigger>
        </header>

        <div className="flex min-h-0 flex-1">
          <section aria-label="Document" className="min-w-0 flex-1 px-6 pt-8 pb-32">
            {fixtureId === "static" ? (
              serverPaint
            ) : (
              <DocumentEditor
                key={fixtureId}
                content={fixture.content}
                variables={LAB_VARIABLES}
                readOnly={readOnly}
                onChange={onChange}
                autoFocus={fixtureId === "blank" ? "first-section" : false}
              />
            )}
          </section>

          <CollapsibleContent
            render={<aside aria-label="Document JSON" />}
            className="w-[26rem] shrink-0 border-l border-hairline bg-surface-sunken"
          >
            <pre className="sticky top-0 max-h-[calc(100dvh-8rem)] overflow-auto px-5 py-6 font-mono text-[11.5px] leading-relaxed text-text-muted">
              {JSON.stringify(json, null, 2)}
            </pre>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
