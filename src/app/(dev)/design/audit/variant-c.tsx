"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTORS, ACTOR, KINDS, KIND, PRESETS, TEAMS, TEAM, TEMPLATES, TMPL, rangeLabel } from "./data";
import { toggle, type Filters } from "./filters";

/*
 * C: one query field. Filters are tokens (team:Deposits). Typing a key, or picking it from the list,
 * offers its values; plain text becomes a "contains" token. Backspace on an empty field takes the last
 * token back out. The tokens are a view of the same Filters the other layouts use.
 */

type Key = "team" | "person" | "action" | "template" | "date";
interface Token {
  key: Key | "contains";
  value: string;
  label: string;
}

const KEYS: Key[] = ["team", "person", "action", "template", "date"];

function valuesFor(key: Key): { value: string; label: string }[] {
  switch (key) {
    case "team": return TEAMS.map((t) => ({ value: t.id, label: t.name }));
    case "person": return ACTORS.map((a) => ({ value: a.id, label: a.name }));
    case "action": return KINDS.map((k) => ({ value: k.id, label: k.label }));
    case "template": return TEMPLATES.map((t) => ({ value: t.id, label: t.name }));
    case "date": return PRESETS.map((p) => ({ value: p.id, label: p.label }));
  }
}

function tokensOf(f: Filters): Token[] {
  return [
    ...f.teams.map((v): Token => ({ key: "team", value: v, label: TEAM[v]! })),
    ...f.people.map((v): Token => ({ key: "person", value: v, label: ACTOR[v]!.name })),
    ...f.kinds.map((v): Token => ({ key: "action", value: v, label: KIND[v as keyof typeof KIND].label })),
    ...f.templates.map((v): Token => ({ key: "template", value: v, label: TMPL[v]!.name })),
    ...(f.from || f.to ? [{ key: "date", value: "range", label: rangeLabel(f.from, f.to) } as Token] : []),
    ...(f.text.trim() ? [{ key: "contains", value: f.text.trim(), label: f.text.trim() } as Token] : []),
  ];
}

export function QueryField({ f, set }: { f: Filters; set: (f: Filters) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const tokens = tokensOf(f);

  // "team:cor" -> key team, partial "cor". Otherwise the text filters the list of keys.
  const m = /^(team|person|action|template|date):(.*)$/i.exec(text.trim());
  const key = (m?.[1]?.toLowerCase() as Key | undefined) ?? undefined;
  const partial = (m ? m[2]! : text).trim().toLowerCase();

  const options = useMemo(() => {
    if (key) {
      const range = key === "date" ? /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(partial) : null;
      if (range) return [{ kind: "range" as const, value: `${range[1]}..${range[2]}`, label: `Between ${rangeLabel(range[1]!, range[2]!)}` }];
      return valuesFor(key)
        .filter((o) => o.label.toLowerCase().includes(partial))
        .map((o) => ({ kind: "value" as const, value: o.value, label: o.label }));
    }
    const ks = KEYS.filter((k) => k.startsWith(partial)).map((k) => ({ kind: "key" as const, value: k, label: k, hint: String(valuesFor(k).length) }));
    return [
      ...ks,
      ...(partial ? [{ kind: "text" as const, value: text.trim(), label: `Details contain “${text.trim()}”`, hint: "" }] : []),
    ];
  }, [key, partial, text]);

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === "key") {
      setText(`${o.value}:`);
      setCursor(0);
      input.current?.focus();
      return;
    }
    if (o.kind === "text") set({ ...f, text: o.value });
    else if (o.kind === "range") {
      const [from, to] = o.value.split("..");
      set({ ...f, from: from!, to: to! });
    } else if (key === "team") set({ ...f, teams: f.teams.includes(o.value) ? f.teams : [...f.teams, o.value] });
    else if (key === "person") set({ ...f, people: f.people.includes(o.value) ? f.people : [...f.people, o.value] });
    else if (key === "action") set({ ...f, kinds: f.kinds.includes(o.value) ? f.kinds : [...f.kinds, o.value] });
    else if (key === "template") set({ ...f, templates: f.templates.includes(o.value) ? f.templates : [...f.templates, o.value] });
    else if (key === "date") {
      const p = PRESETS.find((x) => x.id === o.value)!;
      set({ ...f, from: p.from, to: p.to });
    }
    setText("");
    setCursor(0);
  };

  const remove = (t: Token) => {
    if (t.key === "team") set({ ...f, teams: toggle(f.teams, t.value) });
    if (t.key === "person") set({ ...f, people: toggle(f.people, t.value) });
    if (t.key === "action") set({ ...f, kinds: toggle(f.kinds, t.value) });
    if (t.key === "template") set({ ...f, templates: toggle(f.templates, t.value) });
    if (t.key === "date") set({ ...f, from: null, to: null });
    if (t.key === "contains") set({ ...f, text: "" });
  };

  return (
    <div className="relative">
      <div
        className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-hairline bg-surface px-3 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
        onClick={() => input.current?.focus()}
      >
        <Search aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-text-muted" />
        {tokens.map((t) => (
          <span key={`${t.key}${t.value}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-chip-border bg-chip pr-1 pl-2 text-[13px] text-chip-text">
            <span className="text-text-muted">{t.key === "contains" ? "contains" : t.key}</span>
            <span className="font-medium">{t.label}</span>
            <button type="button" aria-label={`Remove ${t.key} ${t.label}`} onClick={(e) => { e.stopPropagation(); remove(t); }} className="grid size-5 place-items-center rounded-sm text-chip-icon outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
              <X aria-hidden strokeWidth={1.75} className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label="Filter events"
          value={text}
          placeholder={tokens.length ? "" : "Filter events"}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => { setText(e.target.value); setCursor(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(cursor); }
            else if (e.key === "Escape") { setText(""); setOpen(false); }
            else if (e.key === "Backspace" && !text && tokens.length) remove(tokens[tokens.length - 1]!);
          }}
          className="h-7 min-w-48 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-muted"
        />
      </div>
      {open && options.length > 0 ? (
        <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-20 mt-1.5 max-h-72 overflow-y-auto rounded-xl bg-popover p-1.5 shadow-pop ring-1 ring-foreground/10">
          {options.map((o, i) => (
            <li key={`${o.kind}${o.value}`} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                onMouseEnter={() => setCursor(i)}
                className={cn("flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] text-text", i === cursor && "bg-selected")}
              >
                {o.kind === "key" ? <span className="font-mono text-[13px]">{o.label}:</span> : <span>{o.label}</span>}
                {"hint" in o && o.hint ? <span className="ml-auto text-[13px] text-text-muted">{o.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
