"use client";

import { Braces } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DocumentEditor,
  EditorRoot,
  InlineVariableField,
  VariablesPanel,
  type CommentRequest,
  type DocumentEditorHandle,
  type JSONContent,
  type RequiredSection,
  type ThreadAnchor,
  type Variable,
} from "@/editor";
import { FIXTURES, LAB_THREADS, LAB_VARIABLES, type Fixture, type FixtureId } from "./fixtures";

const JSON_DEBOUNCE_MS = 250;

const LAB_SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];

interface LabState {
  doc: JSONContent;
  variables: Variable[];
}

export function EditorLab({ serverPaint }: { serverPaint: ReactNode }) {
  const [fixtureId, setFixtureId] = useState<FixtureId>("long");
  const [readOnlyToggle, setReadOnlyToggle] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  // Review comments: the lab plays the host (threads in state, a request adds one).
  const [commentsOn, setCommentsOn] = useState(false);
  const [threads, setThreads] = useState<ThreadAnchor[]>(LAB_THREADS);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const editorRef = useRef<DocumentEditorHandle>(null);
  const [json, setJson] = useState<LabState>({ doc: FIXTURES[0].content, variables: LAB_VARIABLES });

  const fixture = FIXTURES.find((f) => f.id === fixtureId) as Fixture;
  const forcedReadOnly = Boolean(fixture.readOnly);
  const readOnly = forcedReadOnly || readOnlyToggle;

  // The latest state lives in a ref; the JSON panel catches up on a debounce, and only while
  // it's open, so the lab never adds work to a keystroke.
  const latest = useRef<LabState>({ doc: fixture.content, variables: fixture.variables ?? LAB_VARIABLES });
  const jsonOpenRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const refreshJson = useCallback(() => {
    if (!jsonOpenRef.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setJson({ ...latest.current }), JSON_DEBOUNCE_MS);
  }, []);

  const onChange = useCallback(
    (doc: JSONContent) => {
      latest.current.doc = doc;
      refreshJson();
    },
    [refreshJson],
  );

  const onVariablesChange = useCallback(
    (variables: Variable[]) => {
      latest.current.variables = variables;
      refreshJson();
    },
    [refreshJson],
  );

  const selectFixture = (id: FixtureId) => {
    const next = FIXTURES.find((f) => f.id === id);
    if (!next) return;
    window.clearTimeout(timer.current);
    latest.current = { doc: next.content, variables: next.variables ?? LAB_VARIABLES };
    setJson({ ...latest.current });
    setFixtureId(id);
  };

  const requestComment = useCallback((anchor: CommentRequest) => {
    const id = `lab-new-${Date.now().toString(36)}`;
    setThreads((list) => [...list, { id, blockId: anchor.blockId, quote: anchor.quote ?? null, status: "open" }]);
    setActiveThreadId(id);
  }, []);

  const focusThread = (id: string) => {
    setActiveThreadId(id);
    editorRef.current?.focusThread(id);
  };

  const toggleJson = (open: boolean) => {
    jsonOpenRef.current = open;
    if (open) setJson({ ...latest.current });
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
            className="flex-wrap bg-surface"
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

          <label className="flex items-center gap-2.5 text-sm text-text-muted">
            <Switch checked={commentsOn} onCheckedChange={(checked) => setCommentsOn(checked)} aria-label="Comments" />
            Comments
          </label>

          <CollapsibleTrigger
            render={<Button variant="outline" size="sm" className="gap-1.5 bg-surface font-normal" />}
          >
            <Braces className="size-4" strokeWidth={1.75} aria-hidden />
            JSON
          </CollapsibleTrigger>

          {commentsOn ? (
            <ToggleGroup
              aria-label="Threads"
              variant="outline"
              size="sm"
              spacing={0}
              value={activeThreadId ? [activeThreadId] : []}
              onValueChange={(value) => {
                const id = value[0] as string | undefined;
                if (id) focusThread(id);
                else setActiveThreadId(null);
              }}
              className="basis-full flex-wrap justify-end bg-surface"
            >
              {threads.map((thread) => (
                <ToggleGroupItem
                  key={thread.id}
                  value={thread.id}
                  className="max-w-56 px-3 font-normal text-text-muted aria-pressed:bg-selected aria-pressed:text-text"
                >
                  <span className="truncate">{thread.quote ?? "Whole block"}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
        </header>

        {/* One root per fixture: the document, the inline field and the panel share its variable list. */}
        <EditorRoot
          key={fixtureId}
          variables={fixture.variables ?? LAB_VARIABLES}
          baseline={fixture.baseline ?? null}
          requiredSections={LAB_SECTIONS}
          readOnly={readOnly}
          onVariablesChange={onVariablesChange}
        >
          <div className="flex min-h-0 flex-1">
            {/* Deep bottom room, like the workspace: menus near the end of the document open below. */}
            <section aria-label="Document" className="min-w-0 flex-1 px-6 pt-8 pb-[max(3.5rem,40svh)]">
              {fixture.subject !== undefined ? (
                <div className="mx-auto mb-10 grid max-w-(--doc-width) gap-2">
                  <span className="caps-label">Email subject</span>
                  <InlineVariableField label="Email subject" value={fixture.subject} />
                </div>
              ) : null}
              {fixtureId === "static" ? (
                serverPaint
              ) : (
                <DocumentEditor
                  ref={editorRef}
                  content={fixture.content}
                  onChange={onChange}
                  autoFocus={fixtureId === "blank" ? "first-section" : false}
                  threads={commentsOn ? threads : undefined}
                  activeThreadId={commentsOn ? activeThreadId : null}
                  onThreadClick={setActiveThreadId}
                  onCaretThreadChange={(id) => {
                    if (id) setActiveThreadId(id);
                  }}
                  onRequestComment={commentsOn ? requestComment : undefined}
                />
              )}
            </section>

            <aside aria-label="Variables" className="w-[300px] shrink-0 border-l border-hairline px-3 pt-8 pb-16">
              <VariablesPanel className="sticky top-6" />
            </aside>

            <CollapsibleContent
              render={<aside aria-label="Document JSON" />}
              className="w-[26rem] shrink-0 border-l border-hairline bg-surface-sunken"
            >
              <pre className="sticky top-0 max-h-[calc(100dvh-8rem)] overflow-auto px-5 py-6 font-mono text-[11.5px] leading-relaxed text-text-muted">
                {JSON.stringify(json, null, 2)}
              </pre>
            </CollapsibleContent>
          </div>
        </EditorRoot>
      </Collapsible>
    </div>
  );
}
