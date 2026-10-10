import type { Channel } from "@/domain/types";
import type { RenderErrorCode } from "@/domain/render/types";
import { DAY, HOUR, type SeedCtx, type VersionRef } from "./context";
import type { ConsumerId } from "./platform";
import { int, type Rng } from "./rng";

// About 90 days of synthetic render history. It records WHO rendered WHAT and WHEN, never any
// variable values or customer data (the render log has no column for them).

interface Stream {
  tpl: string;
  ver: string;
  consumer: ConsumerId;
  /** Days before the reset where the stream begins (older) and ends (newer). Max 90. */
  from: number;
  to: number;
  /** Renders per day at ramp 1 on a weekday. */
  perDay: number;
  /** Multiplier at `from` and at `to`; linear in between. */
  ramp?: [number, number];
}

const STREAMS: Stream[] = [
  // Coral still renders Balance Transfer v1 (pinned) and v2. v1 fades but never stops.
  { tpl: "balance-transfer", ver: "v1", consumer: "coral", from: 90, to: 47.5, perDay: 70, ramp: [1, 0.9] },
  { tpl: "balance-transfer", ver: "v1", consumer: "coral", from: 47.5, to: 0, perDay: 70, ramp: [0.35, 0.12] },
  { tpl: "balance-transfer", ver: "v2", consumer: "coral", from: 47.5, to: 0, perDay: 55, ramp: [0.3, 1] },

  { tpl: "cash-back", ver: "v1", consumer: "coral", from: 90, to: 86.5, perDay: 80 },
  { tpl: "cash-back", ver: "v1", consumer: "coral", from: 86.5, to: 70, perDay: 80, ramp: [0.15, 0.02] },
  { tpl: "cash-back", ver: "v2", consumer: "coral", from: 86.5, to: 0, perDay: 110, ramp: [0.6, 1] },

  // Holiday Points v1 stops at the revoke; v2 carries on.
  { tpl: "holiday-points", ver: "v1", consumer: "coral", from: 90, to: 34.3, perDay: 60 },
  { tpl: "holiday-points", ver: "v2", consumer: "coral", from: 35, to: 0, perDay: 70, ramp: [1, 0.7] },

  { tpl: "rate-change-notice", ver: "v1", consumer: "coral", from: 90, to: 0, perDay: 20 },

  { tpl: "high-yield-savings", ver: "v1", consumer: "deposits-online", from: 90, to: 70, perDay: 40, ramp: [1, 0.8] },
  { tpl: "high-yield-savings", ver: "v1", consumer: "deposits-online", from: 70, to: 50, perDay: 40, ramp: [0.4, 0.05] },
  { tpl: "high-yield-savings", ver: "v2", consumer: "deposits-online", from: 70, to: 0, perDay: 55, ramp: [0.5, 1] },
  { tpl: "checking-fees", ver: "v1", consumer: "deposits-online", from: 90, to: 0, perDay: 35 },

  // Statement inserts reach customers through digital banking.
  { tpl: "statement-rate-change", ver: "v1", consumer: "deposits-online", from: 90, to: 0, perDay: 25 },
  { tpl: "statement-paperless", ver: "v1", consumer: "deposits-online", from: 90, to: 0, perDay: 40, ramp: [0.5, 1] },
];

/** Previews are authors and reviewers looking at drafts; no consumer, no customer. */
const PREVIEWS: { tpl: string; ver: string; from: number; to: number; count: number }[] = [
  { tpl: "cash-back", ver: "v3", from: 5, to: 0.9, count: 14 },
  { tpl: "annual-fee-waiver", ver: "draft", from: 3.9, to: 0.8, count: 9 },
  { tpl: "annual-fee-waiver", ver: "v1", from: 10, to: 4.5, count: 6 },
  { tpl: "balance-transfer", ver: "v2", from: 55, to: 50, count: 7 },
  { tpl: "holiday-points", ver: "v2", from: 36, to: 35.6, count: 4 },
  { tpl: "overdraft-protection", ver: "draft", from: 12, to: 1.5, count: 6 },
  { tpl: "statement-privacy", ver: "draft", from: 9, to: 2, count: 5 },
  { tpl: "cash-back", ver: "v2", from: 90, to: 88, count: 3 },
];

/** A handful of failures, so the Usage page has something honest to show. */
const ERRORS: { tpl: string; ver: string; consumer: ConsumerId; at: number; count: number; code: RenderErrorCode; channel: Channel }[] = [
  { tpl: "cash-back", ver: "v2", consumer: "coral", at: 22.3, count: 6, code: "missing_variables", channel: "pdf" },
  { tpl: "balance-transfer", ver: "v1", consumer: "coral", at: 31.1, count: 2, code: "invalid_values", channel: "web" },
  { tpl: "cash-back", ver: "v2", consumer: "coral", at: 14.6, count: 1, code: "channel_not_enabled", channel: "email" },
  { tpl: "rate-change-notice", ver: "v1", consumer: "coral", at: 9.4, count: 1, code: "render_failed", channel: "pdf" },
  { tpl: "high-yield-savings", ver: "v2", consumer: "deposits-online", at: 18.2, count: 2, code: "missing_variables", channel: "web" },
];

/** The latest render of each Active/Superseded version that Coral or Deposits Online still uses. */
const LATEST: { tpl: string; ver: string; consumer: ConsumerId; minutesAgo: number }[] = [
  { tpl: "balance-transfer", ver: "v1", consumer: "coral", minutesAgo: 37 },
  { tpl: "balance-transfer", ver: "v2", consumer: "coral", minutesAgo: 12 },
  { tpl: "cash-back", ver: "v2", consumer: "coral", minutesAgo: 4 },
  { tpl: "holiday-points", ver: "v2", consumer: "coral", minutesAgo: 22 },
];

/** How often each channel is asked for, among a version's channels (a version is one family). */
const CHANNEL_WEIGHT: Record<Channel, number> = { pdf: 0.5, web: 0.35, email: 0.15, push: 0.6, sms: 0.4 };

function pickChannel(rng: Rng, channels: Channel[]): Channel {
  const total = channels.reduce((sum, c) => sum + CHANNEL_WEIGHT[c], 0);
  let roll = rng() * total;
  for (const c of channels) {
    roll -= CHANNEL_WEIGHT[c];
    if (roll <= 0) return c;
  }
  return channels[0];
}

/** How long a render takes, in ms: at least `min`, plus up to `spread`. */
const CHANNEL_DURATION: Record<Channel, readonly [min: number, spread: number]> = {
  pdf: [180, 420],
  web: [35, 90],
  email: [55, 110],
  // A message resolves a few short fields: no layout.
  push: [6, 14],
  sms: [5, 12],
};

function duration(rng: Rng, channel: Channel): number {
  const [min, spread] = CHANNEL_DURATION[channel];
  const slow = rng() < 0.05 ? 3 : 1;
  return Math.round((min + rng() * spread) * slow);
}

/** Business hours bias (UTC), so the heatmap and any hourly view are not flat. */
function hourWeight(ms: number): number {
  const hour = new Date(ms).getUTCHours();
  return 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(((hour - 15) / 24) * 2 * Math.PI));
}

function weekdayFactor(ms: number): number {
  switch (new Date(ms).getUTCDay()) {
    case 0:
      return 0.35;
    case 6:
      return 0.5;
    case 1:
      return 1.1;
    case 5:
      return 0.95;
    default:
      return 1;
  }
}

function timeIn(rng: Rng, from: number, to: number, base: number): number {
  // `from` > `to` in days-ago; return epoch ms in between, biased to business hours.
  for (let i = 0; i < 8; i++) {
    const ms = base - (to + rng() * (from - to)) * DAY;
    if (rng() < hourWeight(ms)) return ms;
  }
  return base - (to + rng() * (from - to)) * DAY;
}

export function seedHistory(ctx: SeedCtx) {
  const { rng, base, sink } = ctx;
  let counter = 0;

  const row = (o: {
    tpl: string;
    ver: string;
    at: number;
    consumer: ConsumerId | null;
    channel: Channel;
    preview?: boolean;
    outcome?: "ok" | "error";
    code?: string;
    durationMs?: number;
  }) => {
    const t = ctx.template(o.tpl);
    const v: VersionRef | undefined = t.versions[o.ver];
    if (!v) throw new Error(`Seed: history references unknown version ${o.tpl}/${o.ver}`);
    counter += 1;
    // A preview made before the version was submitted had no number yet.
    const daysAgo = (base - o.at) / DAY;
    const numbered = v.number !== null && (v.submittedDaysAgo === undefined || daysAgo <= v.submittedDaysAgo);
    sink.renderLog.push({
      id: `rl_${counter.toString(36).padStart(5, "0")}`,
      at: new Date(o.at),
      templateId: t.id,
      versionId: v.id,
      versionNumber: numbered ? v.number : null,
      consumerId: o.consumer,
      channel: o.channel,
      isPreview: o.preview ?? false,
      correlationId: `req_${Math.floor(rng() * 36 ** 6).toString(36).padStart(6, "0")}${Math.floor(rng() * 36 ** 6)
        .toString(36)
        .padStart(6, "0")}`,
      outcome: o.outcome ?? "ok",
      errorCode: o.code ?? null,
      durationMs: o.durationMs ?? duration(rng, o.channel),
    });
  };

  for (const s of STREAMS) {
    const channels = ctx.template(s.tpl).versions[s.ver]?.channels;
    if (!channels) throw new Error(`Seed: history references unknown version ${s.tpl}/${s.ver}`);
    const [r0, r1] = s.ramp ?? [1, 1];

    // Walk rolling 24-hour windows back from the reset, so nothing lands in the future.
    for (let k = Math.floor(s.to); k < s.from; k++) {
      const lo = Math.max(k, s.to);
      const hi = Math.min(k + 1, s.from);
      if (hi <= lo) continue;
      const mid = base - ((lo + hi) / 2) * DAY;
      const progress = (s.from - (lo + hi) / 2) / (s.from - s.to);
      const ramp = r0 + (r1 - r0) * progress;
      const mean = s.perDay * ramp * weekdayFactor(mid) * (hi - lo);
      const count = Math.max(0, Math.round(mean + (rng() - 0.5) * 2 * Math.sqrt(mean) * 0.8));
      for (let i = 0; i < count; i++) {
        row({
          tpl: s.tpl,
          ver: s.ver,
          at: timeIn(rng, hi, lo, base),
          consumer: s.consumer,
          channel: pickChannel(rng, channels),
        });
      }
    }
  }

  for (const l of LATEST) {
    const channels = ctx.template(l.tpl).versions[l.ver].channels;
    row({
      tpl: l.tpl,
      ver: l.ver,
      at: base - l.minutesAgo * 60_000,
      consumer: l.consumer,
      channel: pickChannel(rng, channels),
    });
  }

  for (const pv of PREVIEWS) {
    const all = ctx.template(pv.tpl).versions[pv.ver].channels;
    const channels = all.filter((c) => c !== "email");
    for (let i = 0; i < pv.count; i++) {
      row({
        tpl: pv.tpl,
        ver: pv.ver,
        at: timeIn(rng, pv.from, pv.to, base),
        consumer: null,
        channel: pickChannel(rng, channels.length ? channels : all),
        preview: true,
      });
    }
  }

  for (const e of ERRORS) {
    for (let i = 0; i < e.count; i++) {
      row({
        tpl: e.tpl,
        ver: e.ver,
        // Errors cluster: a consumer bug shows up as a burst, not a trickle.
        at: base - e.at * DAY + int(rng, 0, 50) * 60_000 - (i * HOUR) / 20,
        consumer: e.consumer,
        channel: e.channel,
        outcome: "error",
        code: e.code,
        durationMs: e.code === "render_failed" ? 30_000 : int(rng, 6, 24),
      });
    }
  }
}
