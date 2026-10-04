import { cn } from "@/lib/utils";
import { Code, Group } from "./section";
import { StatusSwatch, Swatch } from "./swatches";

// ── Surfaces ──────────────────────────────────────────────────

const SURFACES = [
  { name: "App", util: "bg-app", role: "Window and sidebar" },
  { name: "Canvas", util: "bg-canvas", role: "The content panel" },
  { name: "Card", util: "bg-surface", role: "Cards, inputs, popovers" },
  { name: "Tinted card", util: "bg-surface-tinted", role: "Stat and row cards" },
  { name: "Sunken", util: "bg-surface-sunken", role: "Wells, keycaps, SHARE disc" },
] as const;

const RADII = [
  { util: "rounded-md", px: "6", role: "Chip" },
  { util: "rounded-lg", px: "8", role: "Control" },
  { util: "rounded-xl", px: "14", role: "Card" },
  { util: "rounded-2xl", px: "18", role: "Large card" },
  { util: "rounded-3xl", px: "22", role: "Modal" },
  { util: "rounded-4xl", px: "24", role: "Canvas" },
  { util: "rounded-full", px: "∞", role: "Pill, toggle" },
] as const;

export function Surfaces() {
  return (
    <>
      <Group title="Stone to canvas to card" aside="Depth comes from tone, not shadow">
        <div className="rounded-4xl bg-app p-3">
          <div className="rounded-4xl border border-hairline bg-canvas p-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-hairline bg-surface-tinted p-5">
                <p className="caps-label">Tinted card</p>
                <p className="mt-3 text-[14px] leading-5 text-text-muted">On the canvas, stat and row cards.</p>
              </div>
              <div className="rounded-xl border border-hairline bg-surface p-5">
                <p className="caps-label">Card</p>
                <p className="mt-3 text-[14px] leading-5 text-text-muted">White, for inputs and popovers.</p>
              </div>
              <div className="rounded-xl border border-hairline bg-surface-tinted p-5">
                <p className="caps-label">Inset well</p>
                <div className="mt-3 rounded-lg border border-hairline bg-surface-sunken px-3 py-2 text-[14px] leading-5 text-text-muted">
                  Sunken inside a card.
                </div>
              </div>
            </div>
          </div>
        </div>
      </Group>

      <Group title="Surface tokens">
        <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-3 xl:grid-cols-5">
          {SURFACES.map((s) => (
            <li key={s.util} className="flex flex-col gap-2">
              <div className={cn("h-24 rounded-xl border border-hairline", s.util)} aria-hidden />
              <div className="flex flex-col">
                <span className="text-[13px] leading-5 font-medium text-text">{s.name}</span>
                <Code>{s.util}</Code>
                <span className="text-[12px] leading-4 text-text-muted">{s.role}</span>
              </div>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Elevation" aside="Borders, not shadows. Only modals get a real one.">
        <div className="grid gap-6 rounded-2xl bg-app p-8 md:grid-cols-3">
          {[
            { name: "Hairline", util: "border border-hairline", role: "Cards, panels: no shadow" },
            { name: "Pop", util: "border border-hairline shadow-pop", role: "Menus and popovers" },
            { name: "Modal", util: "shadow-modal", role: "Modals only" },
          ].map((e) => (
            <div key={e.name} className="flex flex-col gap-3">
              <div className={cn("h-24 rounded-xl bg-surface", e.util)} aria-hidden />
              <div className="flex flex-col">
                <span className="text-[13px] leading-5 font-medium text-text">{e.name}</span>
                <Code>{e.util.replace("border border-hairline ", "").replace("border border-hairline", "none")}</Code>
                <span className="text-[12px] leading-4 text-text-muted">{e.role}</span>
              </div>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Radius scale">
        <ul className="m-0 grid list-none grid-cols-4 gap-x-4 gap-y-6 p-0 md:grid-cols-7">
          {RADII.map((r) => (
            <li key={r.util} className="flex flex-col gap-2">
              <div
                aria-hidden
                className={cn("size-20 border border-hairline-strong bg-surface-tinted", r.util)}
              />
              <div className="flex flex-col">
                <span className="text-[13px] leading-5 font-medium text-text">
                  {r.px === "∞" ? "Full" : `${r.px}px`}
                </span>
                <Code>{r.util.replace("rounded-", "")}</Code>
                <span className="text-[12px] leading-4 text-text-muted">{r.role}</span>
              </div>
            </li>
          ))}
        </ul>
      </Group>
    </>
  );
}

// ── Colour tokens ─────────────────────────────────────────────

const TOKEN_GROUPS: { title: string; tokens: { cssVar: string; name: string }[] }[] = [
  {
    title: "Surfaces",
    tokens: [
      { cssVar: "--app-bg", name: "app" },
      { cssVar: "--canvas", name: "canvas" },
      { cssVar: "--surface", name: "surface" },
      { cssVar: "--surface-tinted", name: "surface-tinted" },
      { cssVar: "--surface-sunken", name: "surface-sunken" },
      { cssVar: "--selected", name: "selected" },
      { cssVar: "--hover", name: "hover" },
      { cssVar: "--tan", name: "tan" },
    ],
  },
  {
    title: "Lines and text",
    tokens: [
      { cssVar: "--hairline", name: "hairline" },
      { cssVar: "--hairline-strong", name: "hairline-strong" },
      { cssVar: "--text", name: "text" },
      { cssVar: "--text-muted", name: "text-muted" },
      { cssVar: "--text-subtle", name: "text-subtle" },
      { cssVar: "--text-label", name: "label" },
      { cssVar: "--primary-fill", name: "primary" },
      { cssVar: "--focus-ring", name: "focus-ring" },
    ],
  },
  {
    title: "Brand and data",
    tokens: [
      { cssVar: "--brand", name: "brand" },
      { cssVar: "--brand-1", name: "brand-1" },
      { cssVar: "--brand-2", name: "brand-2" },
      { cssVar: "--brand-3", name: "brand-3" },
      { cssVar: "--brand-4", name: "brand-4" },
      { cssVar: "--brand-soft", name: "brand-soft" },
      { cssVar: "--heat-empty", name: "heat-empty" },
    ],
  },
  {
    title: "Feedback",
    tokens: [
      { cssVar: "--positive-bg", name: "positive-soft" },
      { cssVar: "--positive-text", name: "positive" },
      { cssVar: "--danger", name: "danger" },
      { cssVar: "--danger-text", name: "danger-text" },
      { cssVar: "--danger-soft", name: "danger-soft" },
    ],
  },
  {
    title: "Variable chips",
    tokens: [
      { cssVar: "--chip-bg", name: "chip" },
      { cssVar: "--chip-border", name: "chip-border" },
      { cssVar: "--chip-text", name: "chip-text" },
      { cssVar: "--chip-icon", name: "chip-icon" },
    ],
  },
];

const TONES = ["draft", "review", "changes", "active", "superseded", "revoked"];

export function ColorTokens() {
  return (
    <>
      {TOKEN_GROUPS.map((g) => (
        <Group key={g.title} title={g.title}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 xl:grid-cols-8">
            {g.tokens.map((t) => (
              <Swatch key={t.cssVar} {...t} />
            ))}
          </div>
        </Group>
      ))}
      <Group title="Status" aside="Fill, text and border, as the badge uses them">
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 xl:grid-cols-6">
          {TONES.map((tone) => (
            <StatusSwatch key={tone} tone={tone} />
          ))}
        </div>
      </Group>
    </>
  );
}
