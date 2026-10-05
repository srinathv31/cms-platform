// Static, deterministic fake render history for the Usage mocks. No DB, no actions.
// 90 days ending Jan 31, 2027 (the demo clock starts Feb 1, 2027).

export type VariantId = "a" | "b" | "c";
export type ScopeId = "team" | "template";
export type Channel = "pdf" | "web" | "email";

export const CHANNELS: { id: Channel; label: string }[] = [
  { id: "pdf", label: "PDF" },
  { id: "web", label: "Web" },
  { id: "email", label: "Email" },
];

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 10, 3); // Nov 3, 2026
export const DAY_COUNT = 90;

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export const CONSUMERS = { coral: "Coral", deposits: "Deposits Online" } as const;
export type ConsumerId = keyof typeof CONSUMERS;

export interface Row {
  id: string;
  consumer: ConsumerId;
  template: string;
  templateId: string;
  version: number;
  state: "active" | "superseded";
  sunsetInDays?: number;
  mix: [number, number, number];
  lastRender: string;
  daily: number[];
  failed: number[];
}

interface Spec {
  id: string;
  consumer: ConsumerId;
  template: string;
  templateId: string;
  version: number;
  state: Row["state"];
  sunsetInDays?: number;
  mix: [number, number, number];
  lastRender: string;
  shape: (i: number) => number;
  seed: number;
  spike?: { day: number; rate: number };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const SPECS: Spec[] = [
  { id: "bt1", consumer: "coral", template: "Balance Transfer Intro — Terms", templateId: "UC-5T6K1B", version: 1, state: "superseded", sunsetInDays: 21, mix: [0.55, 0.45, 0], lastRender: "Today", seed: 11, shape: (i) => 62 - i * 0.22 },
  { id: "bt2", consumer: "coral", template: "Balance Transfer Intro — Terms", templateId: "UC-5T6K1B", version: 2, state: "active", mix: [0.5, 0.5, 0], lastRender: "Today", seed: 12, shape: (i) => (i < 38 ? 0 : 14 + (i - 38) * 1.3) },
  { id: "cb2", consumer: "coral", template: "Cash Back Welcome Bonus — Terms", templateId: "UC-3C8N4V", version: 2, state: "active", mix: [0.4, 0.35, 0.25], lastRender: "Today", seed: 13, shape: (i) => 62 + i * 0.5, spike: { day: 44, rate: 0.09 } },
  { id: "hp2", consumer: "coral", template: "Holiday Points Promo — Terms", templateId: "UC-9D4W2F", version: 2, state: "active", mix: [0.7, 0.3, 0], lastRender: "Jan 12", seed: 14, shape: (i) => 8 + 38 * Math.exp(-(((i - 40) / 12) ** 2)) },
  { id: "rc1", consumer: "coral", template: "Rate Change Notice", templateId: "UC-1R6J8Z", version: 1, state: "active", mix: [0.3, 0, 0.7], lastRender: "Yesterday", seed: 15, shape: (i) => 24 + (i % 14 === 0 ? 40 : 0) },
  { id: "rc1d", consumer: "deposits", template: "Rate Change Notice", templateId: "UC-1R6J8Z", version: 1, state: "active", mix: [0, 1, 0], lastRender: "Today", seed: 16, shape: (i) => 14 + i * 0.07 },
  { id: "sp2", consumer: "coral", template: "Spring Travel Rewards — Terms", templateId: "UC-7H2M9X", version: 2, state: "active", mix: [0.2, 0.4, 0.4], lastRender: "Today", seed: 17, shape: (i) => (i >= 86 ? 5 : 0) },
];

const weekday = (i: number) => {
  const d = new Date(START + i * DAY_MS).getUTCDay();
  return d === 0 ? 0.45 : d === 6 ? 0.6 : 1;
};

export const ROWS: Row[] = SPECS.map((sp) => {
  const r = rng(sp.seed);
  const daily: number[] = [];
  const failed: number[] = [];
  for (let i = 0; i < DAY_COUNT; i += 1) {
    const base = Math.max(0, sp.shape(i)) * weekday(i) * (0.85 + 0.3 * r());
    const v = Math.round(base);
    daily.push(v);
    const rate = sp.spike && i === sp.spike.day ? sp.spike.rate : clamp01(0.002 + r() * 0.006);
    failed.push(Math.round(v * rate));
  }
  return { ...sp, daily, failed };
});

export interface Day {
  i: number;
  label: string;
  long: string;
  total: number;
  failed: number;
  channels: Record<Channel, number>;
  consumers: Record<ConsumerId, number>;
}

export const DAYS: Day[] = Array.from({ length: DAY_COUNT }, (_, i) => {
  const date = new Date(START + i * DAY_MS);
  const channels: Record<Channel, number> = { pdf: 0, web: 0, email: 0 };
  const consumers: Record<ConsumerId, number> = { coral: 0, deposits: 0 };
  let total = 0;
  let failed = 0;
  for (const row of ROWS) {
    const v = row.daily[i];
    const pdf = Math.round(v * row.mix[0]);
    const web = Math.round(v * row.mix[1]);
    channels.pdf += pdf;
    channels.web += web;
    channels.email += v - pdf - web;
    consumers[row.consumer] += v;
    total += v;
    failed += row.failed[i];
  }
  return { i, label: shortDate.format(date), long: longDate.format(date), total, failed, channels, consumers };
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// Calendar months: Dec and Jan are the last two full months in the window.
const JAN = DAYS.slice(-31);
const DEC = DAYS.slice(-62, -31);

const janTotal = sum(JAN.map((d) => d.total));
const decTotal = sum(DEC.map((d) => d.total));
const janFailed = sum(JAN.map((d) => d.failed));
const janChannels = {
  pdf: sum(JAN.map((d) => d.channels.pdf)),
  web: sum(JAN.map((d) => d.channels.web)),
  email: sum(JAN.map((d) => d.channels.email)),
};

export const STATS = {
  month: janTotal,
  lastMonth: decTotal,
  trendPct: Math.round(((janTotal - decTotal) / decTotal) * 100),
  failed: janFailed,
  successPct: Math.round((1 - janFailed / janTotal) * 1000) / 10,
  channels: janChannels,
  activeTemplates: 5,
  consumers: 2,
  nearingSunset: 1,
  busiest: Math.max(...DAYS.map((d) => d.total)),
  streakDays: 0,
};

export const ERROR_REASONS = [
  { label: "A value had the wrong format", share: 0.52 },
  { label: "A required value was missing", share: 0.31 },
  { label: "The render itself failed", share: 0.12 },
  { label: "The version was sunset", share: 0.05 },
].map((r) => ({ ...r, count: Math.round(janFailed * r.share) }));

export interface Weekly {
  label: string;
  total: number;
  channels: Record<Channel, number>;
  consumers: Record<ConsumerId, number>;
  failed: number;
}

// 13 weeks, oldest first, ending Jan 31. The first week has six days: the window is 90 days.
function weekDays(w: number): Day[] {
  const start = w * 7 - 1;
  return DAYS.filter((d) => d.i >= start && d.i < start + 7);
}

export const WEEKS: Weekly[] = Array.from({ length: 13 }, (_, w) => {
  const days = weekDays(w);
  return {
    label: `Week of ${days[0].label}`,
    total: sum(days.map((d) => d.total)),
    failed: sum(days.map((d) => d.failed)),
    channels: { pdf: sum(days.map((d) => d.channels.pdf)), web: sum(days.map((d) => d.channels.web)), email: sum(days.map((d) => d.channels.email)) },
    consumers: { coral: sum(days.map((d) => d.consumers.coral)), deposits: sum(days.map((d) => d.consumers.deposits)) },
  };
});

// ── Aggregates for the lists ─────────────────────────────────────────────────

export interface RowTotals extends Row {
  renders: number;
  failedCount: number;
  spark: number[];
}

export const ROW_TOTALS: RowTotals[] = ROWS.map((row) => ({
  ...row,
  renders: sum(row.daily.slice(-30)),
  failedCount: sum(row.failed.slice(-30)),
  // Last 30 days as 15 two-day points.
  spark: Array.from({ length: 15 }, (_, k) => row.daily[60 + k * 2] + row.daily[61 + k * 2]),
})).filter((r) => r.renders > 0);

export function groupBy<T extends string>(keyOf: (r: RowTotals) => T) {
  const m = new Map<T, number>();
  for (const r of ROW_TOTALS) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + r.renders);
  return [...m.entries()].map(([key, renders]) => ({ key, renders })).sort((a, b) => b.renders - a.renders);
}

export const ON_ACTIVE_PCT = Math.round((sum(ROW_TOTALS.filter((r) => r.state === "active").map((r) => r.renders)) / sum(ROW_TOTALS.map((r) => r.renders))) * 100);
export const ON_SUPERSEDED = sum(ROW_TOTALS.filter((r) => r.state === "superseded").map((r) => r.renders));

export const TOP_TEMPLATES = groupBy((r) => r.template);
export const BY_CONSUMER = groupBy((r) => CONSUMERS[r.consumer]);

export function sunsetTag(row: Row): string | null {
  if (row.state === "superseded") return `On superseded v${row.version} · sunset in ${row.sunsetInDays} days`;
  return null;
}

export const fmt = new Intl.NumberFormat("en-US");

// ── Per-template (Balance Transfer Intro — Terms) ────────────────────────────

export const TEMPLATE = {
  name: "Balance Transfer Intro — Terms",
  id: "UC-5T6K1B",
  rows: ROW_TOTALS.filter((r) => r.templateId === "UC-5T6K1B"),
  weeks: WEEKS.map((w, k) => {
    const d = weekDays(k);
    const v1 = sum(d.map((x) => ROWS[0].daily[x.i]));
    const v2 = sum(d.map((x) => ROWS[1].daily[x.i]));
    return { label: w.label, v1, v2 };
  }),
};
