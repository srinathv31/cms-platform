// Static fake audit events for the audit mock. Times are on the demo clock (today = Mon Oct 5, 2026).

export const BASE = Date.UTC(2026, 9, 5);
const DAY = 86_400_000;

export type KindGroup = "Templates" | "Access" | "Platform";

export const KINDS = [
  { id: "created", label: "Template created", group: "Templates" },
  { id: "draft", label: "Draft edited", group: "Templates" },
  { id: "submitted", label: "Submitted", group: "Templates" },
  { id: "commented", label: "Commented", group: "Templates" },
  { id: "changes", label: "Changes requested", group: "Templates" },
  { id: "approved", label: "Approved", group: "Templates" },
  { id: "sunset-set", label: "Sunset set", group: "Templates" },
  { id: "sunset-passed", label: "Sunset passed", group: "Templates" },
  { id: "revoke-started", label: "Revoke started", group: "Templates" },
  { id: "revoke-confirmed", label: "Revoke confirmed", group: "Templates" },
  { id: "requested", label: "Access requested", group: "Access" },
  { id: "granted", label: "Access granted", group: "Access" },
  { id: "denied", label: "Access denied", group: "Access" },
  { id: "role", label: "Role changed", group: "Access" },
  { id: "recertified", label: "Recertified", group: "Access" },
  { id: "config", label: "Configuration changed", group: "Platform" },
] as const satisfies readonly { id: string; label: string; group: KindGroup }[];

export type KindId = (typeof KINDS)[number]["id"];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<KindId, (typeof KINDS)[number]>;
export const KIND_GROUPS: KindGroup[] = ["Templates", "Access", "Platform"];

export const TEAMS = [
  { id: "coral-offers", name: "Coral Offers" },
  { id: "deposits", name: "Deposits" },
  { id: "card-statements", name: "Card Statements" },
  { id: "platform", name: "Platform" },
] as const;
export const TEAM = Object.fromEntries(TEAMS.map((t) => [t.id, t.name])) as Record<string, string>;

export interface Actor {
  id: string;
  name: string;
  initials: string;
  hue: number;
}
export const ACTORS: Actor[] = [
  { id: "maya", name: "Maya Chen", initials: "MC", hue: 28 },
  { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 212 },
  { id: "alex", name: "Alex Kim", initials: "AK", hue: 152 },
  { id: "priya", name: "Priya Raman", initials: "PR", hue: 322 },
  { id: "sam", name: "Sam Ortiz", initials: "SO", hue: 48 },
  { id: "riley", name: "Riley Brooks", initials: "RB", hue: 266 },
  { id: "morgan", name: "Morgan Lee", initials: "ML", hue: 96 },
  { id: "chris", name: "Chris Morales", initials: "CM", hue: 130 },
  { id: "naomi", name: "Naomi Reyes", initials: "NR", hue: 12 },
  { id: "eli", name: "Eli Hartman", initials: "EH", hue: 240 },
  { id: "hana", name: "Hana Sato", initials: "HS", hue: 172 },
  { id: "system", name: "System", initials: "SY", hue: 90 },
];
export const ACTOR = Object.fromEntries(ACTORS.map((a) => [a.id, a])) as Record<string, Actor>;

export interface Tmpl {
  id: string;
  name: string;
  code: string;
  team: string;
}
export const TEMPLATES: Tmpl[] = [
  { id: "bt", name: "Balance Transfer Intro — Terms", code: "UC-4F7K2Q", team: "coral-offers" },
  { id: "cb", name: "Cash Back Welcome Bonus — Terms", code: "UC-8M2RWD", team: "coral-offers" },
  { id: "af", name: "Annual Fee Waiver — Terms", code: "UC-3Q9TXA", team: "coral-offers" },
  { id: "hp", name: "Holiday Points Promo — Terms", code: "UC-7H5NBC", team: "coral-offers" },
  { id: "rc", name: "Rate Change Notice", code: "UC-2D6VPE", team: "coral-offers" },
  { id: "sr", name: "Savings Rate Disclosure", code: "UC-5K8JYT", team: "deposits" },
  { id: "cf", name: "Checking Fee Schedule", code: "UC-9R3WMF", team: "deposits" },
  { id: "si", name: "Statement Insert — Rewards", code: "UC-6B4ZHN", team: "card-statements" },
];
export const TMPL = Object.fromEntries(TEMPLATES.map((t) => [t.id, t])) as Record<string, Tmpl>;

export interface AuditEvent {
  id: number;
  /** ms since epoch, UTC. */
  at: number;
  actor: string;
  team: string;
  template: string | null;
  version: number | null;
  kind: KindId;
  details: string;
}

type Row = [day: number, time: string, actor: string, team: string, template: string | null, version: number | null, kind: KindId, details: string];

// Newest first.
const ROWS: Row[] = [
  [0, "09:41", "maya", "coral-offers", "cb", 3, "submitted", "Breaking change: adds required variable annual_fee"],
  [0, "09:02", "maya", "coral-offers", "cb", 3, "draft", "14 changes in one session, 38 minutes"],
  [0, "08:05", "morgan", "coral-offers", null, null, "requested", "Author on Coral Offers. Reason: Spring Travel Rewards launch"],
  [-1, "16:20", "jordan", "coral-offers", "af", 1, "commented", "2 comments on Rates and fees"],
  [-1, "11:02", "chris", "coral-offers", null, null, "requested", "Viewer on Coral Offers. Reason: checks live disclosures"],
  [-1, "10:15", "priya", "coral-offers", "af", 1, "draft", "6 changes in one session, 21 minutes"],
  [-2, "15:33", "jordan", "coral-offers", "af", 1, "changes", "Rates and fees needs the APR range"],
  [-2, "14:10", "maya", "coral-offers", "af", 1, "submitted", "No contract change"],
  [-3, "17:45", "riley", "platform", null, null, "config", "Channel rules: Email turned on for Disclosure"],
  [-3, "09:30", "naomi", "deposits", "sr", 2, "approved", "Went Active. Superseded v1 with a 14-day sunset"],
  [-4, "13:18", "eli", "deposits", "sr", 2, "submitted", "Contract change: purchase_apr is now required"],
  [-4, "10:40", "eli", "deposits", "sr", 2, "draft", "9 changes in one session, 27 minutes"],
  [-5, "15:05", "alex", "coral-offers", null, null, "granted", "Author for Morgan Lee"],
  [-6, "11:50", "hana", "card-statements", "si", 1, "approved", "Went Active"],
  [-6, "09:12", "hana", "card-statements", "si", 1, "submitted", "First version"],
  [-7, "16:44", "priya", "coral-offers", "rc", 1, "commented", "1 comment on Legal notices"],
  [-8, "14:02", "alex", "coral-offers", null, null, "role", "Sam Ortiz: Author to Viewer"],
  [-9, "10:26", "jordan", "coral-offers", "hp", 2, "approved", "Went Active"],
  [-9, "09:05", "maya", "coral-offers", "hp", 2, "submitted", "Corrects the bonus amount"],
  [-11, "17:31", "riley", "platform", null, null, "config", "Approval chains: Disclosure has one stage, Compliance review"],
  [-12, "12:15", "jordan", "coral-offers", "bt", 1, "revoke-started", "Reason: wrong promotional APR"],
  [-12, "12:48", "alex", "coral-offers", "bt", 1, "revoke-confirmed", "Coral sends on v1 now fail"],
  [-14, "10:00", "system", "coral-offers", "bt", 1, "sunset-set", "v1 sunset on Nov 4 after v2 went Active"],
  [-15, "15:20", "jordan", "coral-offers", "bt", 2, "approved", "Went Active. v1 superseded"],
  [-16, "11:36", "maya", "coral-offers", "bt", 2, "submitted", "Breaking change: renames intro_apr"],
  [-18, "09:48", "naomi", "deposits", null, null, "denied", "Viewer for a contractor. Note: use the vendor team"],
  [-20, "14:30", "maya", "coral-offers", "cb", 2, "approved", "Went Active"],
  [-21, "10:11", "maya", "coral-offers", "cb", 2, "submitted", "No contract change"],
  [-24, "16:05", "alex", "coral-offers", null, null, "recertified", "Q3 2026: 6 of 6 members confirmed"],
  [-26, "13:40", "hana", "card-statements", "si", 1, "created", "From the Statement starter"],
  [-28, "09:20", "naomi", "deposits", "cf", 1, "approved", "Went Active"],
  [-29, "15:10", "eli", "deposits", "cf", 1, "submitted", "First version"],
  [-31, "11:25", "eli", "deposits", "cf", 1, "created", "Blank template"],
  [-33, "10:02", "riley", "platform", null, null, "config", "Content types: Disclosure requires Legal notices"],
  [-35, "14:15", "jordan", "coral-offers", "hp", 1, "revoke-started", "Reason: wrong bonus amount"],
  [-35, "14:52", "alex", "coral-offers", "hp", 1, "revoke-confirmed", "Coral sends on v1 now fail"],
  [-38, "12:30", "jordan", "coral-offers", "hp", 1, "approved", "Went Active"],
  [-39, "09:44", "maya", "coral-offers", "hp", 1, "submitted", "First version"],
  [-42, "16:50", "alex", "coral-offers", null, null, "granted", "Viewer for Sam Ortiz"],
  [-44, "10:18", "sam", "coral-offers", null, null, "requested", "Viewer on Coral Offers"],
  [-47, "11:05", "jordan", "coral-offers", "rc", 1, "approved", "Went Active"],
  [-48, "15:40", "maya", "coral-offers", "rc", 1, "submitted", "First version"],
  [-48, "10:30", "maya", "coral-offers", "rc", 1, "created", "From the Rate change starter"],
  [-52, "13:22", "riley", "platform", null, null, "config", "Channel rules: PDF turned on for Disclosure"],
  [-55, "09:35", "naomi", "deposits", "sr", 1, "approved", "Went Active"],
  [-56, "16:12", "eli", "deposits", "sr", 1, "submitted", "First version"],
  [-58, "10:44", "priya", "coral-offers", "af", 1, "created", "Blank template"],
  [-61, "14:08", "alex", "coral-offers", null, null, "granted", "Author for Priya Raman"],
  [-63, "11:55", "alex", "coral-offers", null, null, "role", "Priya Raman: Viewer to Author"],
  [-67, "15:30", "jordan", "coral-offers", "bt", 1, "approved", "Went Active"],
  [-68, "10:05", "maya", "coral-offers", "bt", 1, "submitted", "First version"],
  [-70, "13:10", "maya", "coral-offers", "bt", 1, "created", "Blank template"],
  [-74, "09:25", "riley", "platform", null, null, "config", "Approval chains: Disclosure set to Compliance review"],
  [-78, "16:35", "maya", "coral-offers", "cb", 1, "approved", "Went Active"],
  [-84, "12:00", "alex", "coral-offers", null, null, "recertified", "Q2 2026: 6 of 6 members confirmed"],
];

export const EVENTS: AuditEvent[] = ROWS.map(([day, time, actor, team, template, version, kind, details], i) => {
  const [h, m] = time.split(":").map(Number);
  return { id: i + 1, at: BASE + day * DAY + (h! * 60 + m!) * 60_000, actor, team, template, version, kind, details };
});

export function whenLabel(at: number): string {
  const d = new Date(at);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time}`;
}

export const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10);
export const TODAY = isoDay(BASE);
export const dayIso = (offset: number) => isoDay(BASE + offset * DAY);

export function rangeLabel(from: string | null, to: string | null): string {
  const f = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (from && to) return from === to ? f(from) : `${f(from)} – ${f(to)}`;
  if (from) return `From ${f(from)}`;
  if (to) return `Until ${f(to)}`;
  return "Any date";
}

export const PRESETS = [
  { id: "7", label: "Last 7 days", from: dayIso(-7), to: TODAY },
  { id: "30", label: "Last 30 days", from: dayIso(-30), to: TODAY },
  { id: "90", label: "Last 90 days", from: dayIso(-90), to: TODAY },
] as const;
