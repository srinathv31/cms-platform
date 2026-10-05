// Static fake data for the simulator mock. Nothing here touches UCOMP, the DB or an action.

export type VariantId = "a" | "b" | "c";
export type ScreenId = "offers" | "link" | "map" | "send" | "customer" | "notices" | "relink";
/** How Spring Travel Rewards stands against UCOMP: the story of demo scenarios 4 and 5. */
export type Scenario = "live" | "v3" | "sunset" | "revoked";
export type ViewMode = "phone" | "inbox" | "pdf";

export const SCREENS: { id: ScreenId; label: string }[] = [
  { id: "offers", label: "Offers" },
  { id: "link", label: "Link" },
  { id: "map", label: "Map" },
  { id: "send", label: "Send" },
  { id: "customer", label: "Customer" },
  { id: "notices", label: "Notices" },
  { id: "relink", label: "Relink" },
];

export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "live", label: "v2 live" },
  { id: "v3", label: "v3 available" },
  { id: "sunset", label: "Sunset passed" },
  { id: "revoked", label: "Revoked" },
];

export interface Offer {
  id: string;
  name: string;
  headline: string;
  templateName: string | null;
  templateId: string | null;
  channels: string[];
  lastSend: string;
  sends30: number;
}

export const SPRING_ID = "offer_spring_travel";
export const SPRING_TEMPLATE = "Spring Travel Rewards — Terms";
export const SPRING_TEMPLATE_ID = "UC-7H2M9X";

export const OFFERS: Offer[] = [
  {
    id: SPRING_ID,
    name: "Spring Travel Rewards",
    headline: "Spend $1,000 in 3 months, get $200 back",
    templateName: SPRING_TEMPLATE,
    templateId: SPRING_TEMPLATE_ID,
    channels: ["PDF", "Web", "Email"],
    lastSend: "Today, 9:41 AM",
    sends30: 5,
  },
  {
    id: "offer_cash_back",
    name: "Cash Back Welcome Bonus",
    headline: "Spend $1,000 in 3 months, earn a $200 statement credit",
    templateName: "Cash Back Welcome Bonus — Terms",
    templateId: "UC-3C8N4V",
    channels: ["PDF", "Web"],
    lastSend: "Jan 29, 2:10 PM",
    sends30: 1840,
  },
  {
    id: "offer_balance_transfer",
    name: "Balance Transfer Intro",
    headline: "0% intro APR on balance transfers for 12 months",
    templateName: "Balance Transfer Intro — Terms",
    templateId: "UC-5T6K1B",
    channels: ["PDF", "Web"],
    lastSend: "Jan 30, 8:05 AM",
    sends30: 2210,
  },
  {
    id: "offer_holiday_points",
    name: "Holiday Points Promo",
    headline: "Spend $2,000 in 3 months, earn 20,000 bonus points",
    templateName: "Holiday Points Promo — Terms",
    templateId: "UC-9D4W2F",
    channels: ["PDF"],
    lastSend: "Jan 12, 11:30 AM",
    sends30: 312,
  },
];

export interface FoundTemplate {
  id: string;
  name: string;
  team: string;
  activeVersion: number;
  channels: string[];
  /** Older versions that can still be pinned, with their sunset. */
  older: { version: number; sunset: string }[];
}

/** Only Active templates are offered. */
export const FOUND: FoundTemplate[] = [
  {
    id: SPRING_TEMPLATE_ID,
    name: SPRING_TEMPLATE,
    team: "Coral Offers",
    activeVersion: 2,
    channels: ["PDF", "Web", "Email"],
    older: [{ version: 1, sunset: "Mar 1" }],
  },
  {
    id: "UC-3C8N4V",
    name: "Cash Back Welcome Bonus — Terms",
    team: "Coral Offers",
    activeVersion: 2,
    channels: ["PDF", "Web"],
    older: [],
  },
  {
    id: "UC-1R6J8Z",
    name: "Rate Change Notice",
    team: "Coral Offers",
    activeVersion: 1,
    channels: ["PDF", "Web", "Email"],
    older: [],
  },
];

export interface Variable {
  key: string;
  label: string;
  type: string;
  required: boolean;
  /** Simulator fields that fit this type. */
  fields: string[];
  mapped: string;
  addedIn?: number;
}

export const FIELD_OPTIONS = [
  "customer.firstName",
  "customer.lastName",
  "customer.purchaseApr",
  "customer.homeState",
  "customer.annualFee",
  "offer.endDate",
];

export const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "Text", required: true, fields: [], mapped: "customer.firstName" },
  { key: "last_name", label: "Last name", type: "Text", required: true, fields: [], mapped: "customer.lastName" },
  { key: "purchase_apr", label: "Purchase APR", type: "Percent", required: true, fields: [], mapped: "" },
  { key: "home_state", label: "Home state", type: "US state", required: true, fields: [], mapped: "customer.homeState" },
  { key: "offer_end_date", label: "Offer end date", type: "Date", required: false, fields: [], mapped: "offer.endDate" },
];

export const NEW_VARIABLE: Variable = {
  key: "annual_fee",
  label: "Annual fee",
  type: "Currency",
  required: true,
  fields: [],
  mapped: "",
  addedIn: 3,
};

export interface Customer {
  id: string;
  first: string;
  last: string;
  state: string;
  apr: string;
  fee: string;
  email: string;
  /** Sending to this customer fails the render: the value isn't a percentage. */
  badApr?: boolean;
}

export const CUSTOMERS: Customer[] = [
  { id: "c1", first: "Olivia", last: "Bennett", state: "NJ", apr: "21.99", fee: "95.00", email: "olivia.bennett@example.com" },
  { id: "c2", first: "Marcus", last: "Delgado", state: "CA", apr: "24.49", fee: "0.00", email: "marcus.delgado@example.com" },
  { id: "c3", first: "Anjali", last: "Kapoor", state: "TX", apr: "19.24", fee: "95.00", email: "anjali.kapoor@example.com" },
  { id: "c4", first: "Fatima", last: "Al-Sayed", state: "NY", apr: "N/A", fee: "95.00", email: "fatima.alsayed@example.com", badApr: true },
  { id: "c5", first: "Maximiliano-Bartholomew", last: "Featherstonehaugh-Villiers-Montgomery", state: "NC", apr: "29.99", fee: "695.00", email: "m.featherstonehaugh@example.com" },
  { id: "c6", first: "Jonas", last: "Eriksen", state: "WA", apr: "22.74", fee: "0.00", email: "jonas.eriksen@example.com" },
  { id: "c7", first: "Hiroshi", last: "Tanaka", state: "IL", apr: "20.49", fee: "0.00", email: "hiroshi.tanaka@example.com" },
  { id: "c8", first: "Camille", last: "Dubois", state: "FL", apr: "23.99", fee: "95.00", email: "camille.dubois@example.com" },
];

export const SELECTED_DEFAULT = ["c1", "c2", "c3", "c4", "c5"];

export function fullName(c: Customer) {
  return `${c.first} ${c.last}`;
}

export type Channel = "PDF" | "Web" | "Email";
export const CHANNEL_CHOICES: Channel[] = ["PDF", "Web", "Email"];

export interface Result {
  customer: Customer;
  channel: Channel;
  status: "delivered" | "failed";
  error?: string;
  /** The exact render-route message. */
}

export const SUNSET_ERROR = "Version 2 was sunset on February 15, 2027. Version 3 is active.";
export const REVOKED_ERROR = "Version 2 was revoked on February 3, 2027. Version 3 is active.";
export const BAD_APR_ERROR = "purchase_apr must be a percentage, like 21.99.";

/** What the render route returns for each selected customer, given where the link stands. */
export function resultsFor(scenario: Scenario, ids: string[], channel: Channel, pinned: number): Result[] {
  return CUSTOMERS.filter((c) => ids.includes(c.id)).map((customer) => {
    if (pinned === 2 && scenario === "sunset") return { customer, channel, status: "failed", error: SUNSET_ERROR };
    if (pinned === 2 && scenario === "revoked") return { customer, channel, status: "failed", error: REVOKED_ERROR };
    if (customer.badApr) return { customer, channel, status: "failed", error: BAD_APR_ERROR };
    return { customer, channel, status: "delivered" };
  });
}

export interface Notice {
  id: string;
  kind: "new_required" | "sunset" | "revoked" | "active";
  title: string;
  body: string;
  offer: string;
  at: string;
  unread: boolean;
  action: string;
}

export const NOTICES: Notice[] = [
  {
    id: "n1",
    kind: "new_required",
    title: "New required variable",
    body: "Spring Travel Rewards — Terms v3 adds annual_fee (Currency). Sends on v2 keep working until it is sunset.",
    offer: "Spring Travel Rewards",
    at: "Feb 1, 4:12 PM",
    unread: true,
    action: "Review v3",
  },
  {
    id: "n2",
    kind: "sunset",
    title: "Version 2 sunsets on February 15, 2027",
    body: "After that day, sends pinned to v2 fail. Relink to v3 before then.",
    offer: "Spring Travel Rewards",
    at: "Feb 1, 4:12 PM",
    unread: true,
    action: "Relink",
  },
  {
    id: "n3",
    kind: "revoked",
    title: "Template revoked",
    body: "Balance Transfer Intro — Terms v1 was revoked: the intro rate was wrong. Sends on Balance Transfer Intro now fail. Version 2 is active.",
    offer: "Balance Transfer Intro",
    at: "Jan 27, 10:03 AM",
    unread: false,
    action: "Relink",
  },
  {
    id: "n4",
    kind: "active",
    title: "Version 2 is now active",
    body: "Cash Back Welcome Bonus — Terms v2 is active. No variables changed.",
    offer: "Cash Back Welcome Bonus",
    at: "Jan 9, 1:48 PM",
    unread: false,
    action: "Dismiss",
  },
];

/** What a sent customer receives: the same sections in every channel. */
export function disclosureLines(c: Customer, version: 2 | 3) {
  return {
    title: "Spring Travel Rewards — Terms",
    greeting: `Hi ${c.first},`,
    offer: `Spend $1,000 on purchases in your first 3 months and earn a $200 statement credit. This offer ends March 31, 2027.`,
    rates: [
      ["Purchase APR", c.badApr ? "—" : `${c.apr}%`],
      ["Annual fee", version === 3 ? `$${c.fee}` : "None"],
      ["Home state", c.state],
    ] as [string, string][],
    legal:
      "Coral cards are issued by Coral Bank, N.A. Rates and fees are subject to change after account opening. Review your cardmember agreement for full terms.",
  };
}

export interface LinkStatus {
  tone: "ok" | "info" | "bad" | "warn";
  label: string;
  /** One sentence for the banner on the offer. */
  detail: string;
}

/** How the Spring Travel Rewards link reads in the simulator, per scenario. */
export function linkStatus(s: Scenario): LinkStatus {
  switch (s) {
    case "live":
      return { tone: "ok", label: "Pinned to v2", detail: "Sending on version 2." };
    case "v3":
      return { tone: "info", label: "v3 available", detail: "Version 3 adds annual_fee. Sends still use v2 until it is sunset on February 15, 2027." };
    case "sunset":
      return { tone: "bad", label: "Sends failing", detail: SUNSET_ERROR };
    case "revoked":
      return { tone: "bad", label: "Sends failing", detail: REVOKED_ERROR };
  }
}

export function offerStatus(o: Offer, s: Scenario): LinkStatus {
  if (o.id === SPRING_ID) return linkStatus(s);
  if (o.id === "offer_balance_transfer")
    return { tone: "warn", label: "On superseded v1", detail: "Version 1 is sunset in 21 days." };
  return { tone: "ok", label: "Pinned to v2", detail: "Sending on version 2." };
}

export function pinnedLabel(o: Offer): string {
  return o.id === "offer_balance_transfer" ? "v1" : "v2";
}
