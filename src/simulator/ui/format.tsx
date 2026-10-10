import type { ApiChannel, ApiVariableType } from "@/contracts/api-v1";
import type { SimBatch, SimLinkSummary, SimPlatform, SimUpgrade } from "@/simulator/types";
import { Mono, type Tone } from "./bits";

// Pure display helpers shared by server and client components. Dates are ISO strings; they are always
// formatted in UTC so the server render and the browser agree.

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

/** "Mar 4, 2027". */
export const dayLabel = (iso: string) => DAY.format(new Date(iso));
/** "Mar 4, 2:02 PM UTC". */
export const whenLabel = (iso: string) => `${WHEN.format(new Date(iso))} UTC`;

export const CHANNEL_LABEL: Record<ApiChannel, string> = { pdf: "PDF", web: "Web", email: "Email", push: "Push", sms: "SMS" };
/** How the customer meets each channel. */
export const VIEW_LABEL: Record<ApiChannel, string> = { web: "Phone", email: "Inbox", pdf: "PDF", push: "Notification", sms: "Messages" };

export const PLATFORM_LABEL: Record<SimPlatform, string> = { ios: "iPhone", android: "Android" };

/** "+12015550142" → "(201) 555-0142"; anything that isn't a US number as stored. */
export function phoneLabel(e164: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}

const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hourCycle: "h12", timeZone: "UTC" });
const CLOCK_DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const STAMP_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const STAMP_WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const STAMP_DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** The phone's clock at a moment, for its status bar and lock screen: { time: "2:02", date: "Friday, October 9" }. */
export function phoneClock(iso: string): { time: string; date: string } {
  const at = new Date(iso);
  return { time: CLOCK.format(at).replace(/\s?[AP]M$/, ""), date: CLOCK_DATE.format(at) };
}

const dayNumber = (at: Date) => Math.floor(at.getTime() / 86_400_000);

/**
 * When a text arrived, as the thread prints it on a phone whose day is `today`'s: "Today", "Yesterday",
 * the weekday within a week, else "Mon, Oct 5"; and the time, "2:02 PM".
 */
export function messageStamp(iso: string, today: string): { day: string; time: string } {
  const at = new Date(iso);
  const ago = dayNumber(new Date(today)) - dayNumber(at);
  const day = ago <= 0 ? "Today" : ago === 1 ? "Yesterday" : ago < 7 ? STAMP_WEEKDAY.format(at) : STAMP_DAY.format(at);
  // Newer ICU puts a narrow no-break space before AM/PM; a phone prints a plain one.
  return { day, time: STAMP_TIME.format(at).replace(/\s/g, " ") };
}

export const TYPE_LABEL: Record<ApiVariableType, string> = {
  text: "Text",
  currency: "Currency",
  percent: "Percent",
  date: "Date",
  number: "Number",
  us_state: "US state",
};

/** "A", "A and B", "A, B and C". */
export function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
export const channelList = (channels: readonly ApiChannel[]) => andList(channels.map((c) => CHANNEL_LABEL[c]));

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "4 delivered, 1 failed" (the results headline). */
export function resultsHeadline(counts: SimBatch["counts"]): string {
  return counts.failed > 0 ? `${counts.delivered} delivered, ${counts.failed} failed` : `${counts.delivered} delivered`;
}

/** Text with `backticked` keys set in the mono face. */
export function withKeys(text: string): React.ReactNode {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <Mono key={i} className="text-(--sim-text)">
        {part.slice(1, -1)}
      </Mono>
    ) : (
      part
    ),
  );
}

export interface LinkStatus {
  tone: Tone;
  label: string;
  /** True when a send would fail today. */
  failing: boolean;
}

/** The link's state in one pill. The upgrade badge ("v3 available") is shown beside it, never instead of it. */
export function linkStatus(link: SimLinkSummary | null): LinkStatus {
  if (!link) return { tone: "plain", label: "Not linked", failing: false };
  if (link.pinnedState === "revoked" || link.revokedAt) return { tone: "bad", label: "Revoked", failing: true };
  if (link.sunsetPassed) return { tone: "bad", label: "Sunset passed", failing: true };
  if (link.pinnedState === "superseded") {
    return { tone: "warn", label: link.sunsetAt ? `Superseded · sunset ${dayLabel(link.sunsetAt)}` : "Superseded", failing: !link.renders };
  }
  return { tone: "ok", label: "Live", failing: !link.renders };
}

export const upgradeLabel = (upgrade: SimUpgrade) => `v${upgrade.toVersion} available`;
