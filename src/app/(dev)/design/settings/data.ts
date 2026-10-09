// Static fake data for the settings mock. Days are whole days relative to the demo clock's start (day 0 = Mon Oct 5, 2026).

export type Role = "Viewer" | "Author" | "Approver" | "Team Admin";
export const ROLES: Role[] = ["Viewer", "Author", "Approver", "Team Admin"];

export const BASE = Date.UTC(2026, 9, 5);
const DAY = 86_400_000;

export function dayLabel(day: number, withYear = false): string {
  return new Date(BASE + day * DAY).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

export function daysAgo(n: number): string {
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  return `${n} days ago`;
}

export interface Person {
  id: string;
  name: string;
  first: string;
  title: string;
  initials: string;
  hue: number;
}

export const PEOPLE: Record<string, Person> = {
  maya: { id: "maya", name: "Maya Chen", first: "Maya", title: "Senior Content Designer", initials: "MC", hue: 28 },
  jordan: { id: "jordan", name: "Jordan Ellis", first: "Jordan", title: "Offer Compliance Manager", initials: "JE", hue: 212 },
  alex: { id: "alex", name: "Alex Kim", first: "Alex", title: "Offers Operations Lead", initials: "AK", hue: 152 },
  priya: { id: "priya", name: "Priya Raman", first: "Priya", title: "Content Strategist", initials: "PR", hue: 322 },
  sam: { id: "sam", name: "Sam Ortiz", first: "Sam", title: "Product Manager, Offers", initials: "SO", hue: 48 },
  devon: { id: "devon", name: "Devon Lin", first: "Devon", title: "Business Analyst, Offers", initials: "DL", hue: 70 },
  morgan: { id: "morgan", name: "Morgan Lee", first: "Morgan", title: "Marketing Associate", initials: "ML", hue: 96 },
  chris: { id: "chris", name: "Chris Morales", first: "Chris", title: "Marketing Coordinator", initials: "CM", hue: 130 },
  dana: { id: "dana", name: "Dana Park", first: "Dana", title: "Legal Reviewer, Consumer Compliance", initials: "DP", hue: 350 },
  riley: { id: "riley", name: "Riley Brooks", first: "Riley", title: "Content Platform Owner", initials: "RB", hue: 266 },
  naomi: { id: "naomi", name: "Naomi Reyes", first: "Naomi", title: "Deposits Content Lead", initials: "NR", hue: 12 },
  hana: { id: "hana", name: "Hana Sato", first: "Hana", title: "Statements Program Lead", initials: "HS", hue: 172 },
};

export interface MemberRow {
  id: string;
  role: Role;
  /** Day of the last login (0 = today). */
  lastActive: number;
  /** Day they were added. */
  added: number;
  drafts: number;
}

/** Coral Offers, as seeded. Alex is the viewer in the Team group. */
export const COHORT: MemberRow[] = [
  { id: "maya", role: "Author", lastActive: 0, added: -212, drafts: 3 },
  { id: "jordan", role: "Approver", lastActive: 0, added: -230, drafts: 1 },
  { id: "alex", role: "Team Admin", lastActive: 0, added: -230, drafts: 0 },
  { id: "priya", role: "Author", lastActive: -1, added: -150, drafts: 2 },
  { id: "sam", role: "Viewer", lastActive: -1, added: -97, drafts: 0 },
  { id: "devon", role: "Viewer", lastActive: -95, added: -190, drafts: 0 },
];

export const INACTIVE_FLAG_DAYS = 90;
export const INACTIVE_SUSPEND_DAYS = 120;
/** The recertification deadline, in demo-clock days. */
export const RECERT_DEADLINE = 30;
export const RECERT_NAME = "Q4 2026 recertification";
/** Confirmed before the mock opens: "4 of 6". */
export const RECERT_CONFIRMED: Record<string, string> = {
  maya: "Alex Kim · Oct 1",
  jordan: "Alex Kim · Oct 1",
  alex: "Riley Brooks · Oct 2",
  priya: "Alex Kim · Oct 3",
};

export interface RequestRow {
  id: string;
  who: string;
  role: Role;
  asked: string;
  reason: string;
}

export const REQUESTS: RequestRow[] = [
  {
    id: "r-morgan",
    who: "morgan",
    role: "Author",
    asked: "2 hours ago",
    reason: "Joining the Spring Travel Rewards launch. I will draft the terms with Maya.",
  },
  {
    id: "r-chris",
    who: "chris",
    role: "Viewer",
    asked: "Yesterday",
    reason: "I check the live disclosures before each campaign goes out.",
  },
];

export interface TeamRow {
  id: string;
  name: string;
  admin: string;
  members: number;
  templates: number;
}

export const TEAMS: TeamRow[] = [
  { id: "coral-offers", name: "Coral Offers", admin: "alex", members: 6, templates: 5 },
  { id: "deposits", name: "Deposits", admin: "naomi", members: 5, templates: 4 },
  { id: "card-statements", name: "Card Statements", admin: "hana", members: 3, templates: 2 },
];

export const CHANNELS = ["PDF", "Web", "Email"] as const;
export type ChannelName = (typeof CHANNELS)[number];
export const REQUIRED_SECTIONS = ["Offer details", "Rates and fees", "Legal notices"];
/** Active templates per channel, for the turn-off consequence. */
export const ACTIVE_ON_CHANNEL: Record<ChannelName, number> = { PDF: 5, Web: 5, Email: 3 };

export interface Stage {
  id: string;
  name: string;
  reviewers: string[];
}

export const INITIAL_STAGES: Stage[] = [{ id: "s1", name: "Compliance review", reviewers: ["jordan", "alex"] }];
export const LEGAL_STAGE: Stage = { id: "s2", name: "Legal reviewer", reviewers: ["dana"] };
export const IN_REVIEW_NOW = "Cash Back Welcome Bonus v3";
