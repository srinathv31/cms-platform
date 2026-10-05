import type { SeedCtx } from "./context";

// "Coral — simulated": the consumer's own data. UCOMP never reads these tables; the simulator
// reaches UCOMP only through /api/v1. Mapping values are simulator field paths.

export const SIM_FIELDS = {
  first_name: "customer.firstName",
  last_name: "customer.lastName",
  purchase_apr: "customer.purchaseApr",
  home_state: "customer.homeState",
  annual_fee: "customer.annualFee",
} as const;

// Customers without a card fee carry "0", so mapping annual_fee to the customer never leaves a gap.

const CUSTOMERS: {
  first: string;
  last: string;
  state: string;
  apr: string;
  fee: string;
}[] = [
  { first: "Olivia", last: "Bennett", state: "NJ", apr: "21.99", fee: "95" },
  { first: "Marcus", last: "Delgado", state: "CA", apr: "24.49", fee: "0" },
  { first: "Anjali", last: "Kapoor", state: "TX", apr: "19.24", fee: "95" },
  { first: "Jonas", last: "Eriksen", state: "WA", apr: "22.74", fee: "0" },
  { first: "Fatima", last: "Al-Sayed", state: "NY", apr: "26.99", fee: "95" },
  { first: "Hiroshi", last: "Tanaka", state: "IL", apr: "20.49", fee: "0" },
  { first: "Camille", last: "Dubois", state: "FL", apr: "23.99", fee: "95" },
  { first: "Tomasz", last: "Kowalski", state: "OH", apr: "18.99", fee: "0" },
  { first: "Imani", last: "Walker", state: "GA", apr: "27.24", fee: "95" },
  // Layout test: a very long name and the highest APR
  { first: "Maximiliano-Bartholomew", last: "Featherstonehaugh-Villiers-Montgomery", state: "NC", apr: "29.99", fee: "695" },
];

export function seedSimulator(ctx: SeedCtx) {
  const { sink } = ctx;

  // Scenario 4 links this one live, so it starts with no link.
  const offers = [
    // annualFee and endsOn feed the offer.* mapping fields (scenario 5 maps annual_fee to offer.annualFee).
    { id: "offer_spring_travel", name: "Spring Travel Rewards", headline: "Spend $1,000 in 3 months, get $200 back", terms: { spend: 1000, bonus: 200, months: 3, annualFee: 95, endsOn: ctx.at(-120).toISOString().slice(0, 10) } },
    { id: "offer_balance_transfer", name: "Balance Transfer Intro", headline: "0% intro APR on balance transfers for 12 months", terms: { spend: 0, bonus: 0, months: 12 } },
    { id: "offer_cash_back", name: "Cash Back Welcome Bonus", headline: "Spend $1,000 in 3 months, earn a $200 statement credit", terms: { spend: 1000, bonus: 200, months: 3 } },
    { id: "offer_holiday_points", name: "Holiday Points Promo", headline: "Spend $2,000 in 3 months, earn 20,000 bonus points", terms: { spend: 2000, bonus: 20000, months: 3 } },
  ];
  sink.simOffers.push(...offers);

  CUSTOMERS.forEach((c, i) => {
    sink.simCustomers.push({
      id: `cust_${String(i + 1).padStart(2, "0")}`,
      firstName: c.first,
      lastName: c.last,
      email: `${c.first}.${c.last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
      homeState: c.state,
      purchaseApr: c.apr,
      annualFee: c.fee,
    });
  });

  const mapping = (keys: (keyof typeof SIM_FIELDS)[]) =>
    Object.fromEntries(keys.map((k) => [k, SIM_FIELDS[k]]));
  const customerKeys = ["first_name", "last_name", "purchase_apr", "home_state"] as const;

  const links = [
    // Pinned on purpose: Balance Transfer stays on v1 (now Superseded, with a sunset date).
    { offer: "offer_balance_transfer", tpl: "balance-transfer", ver: "v1", linkedAt: 146 },
    { offer: "offer_cash_back", tpl: "cash-back", ver: "v2", linkedAt: 85 },
    // Relinked to v2 after v1 was revoked.
    { offer: "offer_holiday_points", tpl: "holiday-points", ver: "v2", linkedAt: 33 },
  ];
  for (const l of links) {
    const t = ctx.template(l.tpl);
    const v = t.versions[l.ver];
    sink.simLinks.push({
      id: ctx.id("lnk"),
      offerId: l.offer,
      templateId: t.id,
      templateName: t.name,
      pinnedVersion: v.number ?? 0,
      channels: v.channels.filter((c) => c !== "email"),
      mapping: mapping([...customerKeys]),
      linkedAt: ctx.at(l.linkedAt),
    });
  }

  // Coral has read every seeded notice except the latest: Balance Transfer v1's sunset (set 2 days ago).
  const coralNotices = sink.consumerNotices.filter((n) => n.consumerId === "coral");
  const latest = coralNotices.reduce<(typeof coralNotices)[number] | null>(
    (a, n) => (a === null || n.createdAt.getTime() > a.createdAt.getTime() ? n : a),
    null,
  );
  for (const n of coralNotices) {
    if (n === latest) continue;
    sink.simNoticeReads.push({ noticeId: n.id, readAt: new Date(n.createdAt.getTime() + 3_600_000) });
  }
}
