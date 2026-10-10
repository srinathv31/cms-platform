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
//
// Each has a phone: a fictional number (555-0100 to 555-0199 are set aside for fiction, in any area
// code; here the home state's), iPhone and Android in turn. And a card account, the alerts' values: the
// statement's minimum payment and due day (days from the reset), and the last purchase, made abroad. A
// few merchants have a letter outside the SMS character set (ó, â, ń), so their "Card used abroad" text
// goes as UCS-2, as Stencil reports; é is in it. The long-name customer has the longest values.

const CUSTOMERS: {
  first: string;
  last: string;
  state: string;
  apr: string;
  fee: string;
  phone: string;
  platform: "ios" | "android";
  last4: string;
  due: { amount: string; inDays: number };
  purchase: { amount: string; merchant: string; country: string };
}[] = [
  { first: "Olivia", last: "Bennett", state: "NJ", apr: "21.99", fee: "95", phone: "+12015550142", platform: "ios", last4: "3417", due: { amount: "35.00", inDays: 12 }, purchase: { amount: "48.20", merchant: "Café Lisboa", country: "Portugal" } },
  { first: "Marcus", last: "Delgado", state: "CA", apr: "24.49", fee: "0", phone: "+14155550118", platform: "android", last4: "9052", due: { amount: "58.12", inDays: 9 }, purchase: { amount: "23.75", merchant: "Barcelona Tapas Bar", country: "Spain" } },
  { first: "Anjali", last: "Kapoor", state: "TX", apr: "19.24", fee: "95", phone: "+15125550163", platform: "ios", last4: "6128", due: { amount: "25.00", inDays: 15 }, purchase: { amount: "1240.00", merchant: "Hotel Kraków Old Town", country: "Poland" } },
  { first: "Jonas", last: "Eriksen", state: "WA", apr: "22.74", fee: "0", phone: "+12065550127", platform: "android", last4: "0459", due: { amount: "112.40", inDays: 6 }, purchase: { amount: "312.60", merchant: "Nordic Outfitters", country: "Norway" } },
  { first: "Fatima", last: "Al-Sayed", state: "NY", apr: "26.99", fee: "95", phone: "+12125550190", platform: "ios", last4: "7783", due: { amount: "74.89", inDays: 18 }, purchase: { amount: "86.10", merchant: "Dubai Mall Electronics", country: "United Arab Emirates" } },
  { first: "Hiroshi", last: "Tanaka", state: "IL", apr: "20.49", fee: "0", phone: "+13125550154", platform: "android", last4: "2290", due: { amount: "25.00", inDays: 11 }, purchase: { amount: "54.00", merchant: "Shibuya Ramen", country: "Japan" } },
  { first: "Camille", last: "Dubois", state: "FL", apr: "23.99", fee: "95", phone: "+13055550136", platform: "ios", last4: "5531", due: { amount: "41.30", inDays: 20 }, purchase: { amount: "19.90", merchant: "Boulangerie Poilâne", country: "France" } },
  { first: "Tomasz", last: "Kowalski", state: "OH", apr: "18.99", fee: "0", phone: "+12165550171", platform: "android", last4: "8846", due: { amount: "93.75", inDays: 8 }, purchase: { amount: "140.35", merchant: "Gdańsk Amber Gallery", country: "Poland" } },
  { first: "Imani", last: "Walker", state: "GA", apr: "27.24", fee: "95", phone: "+14045550109", platform: "ios", last4: "1904", due: { amount: "150.00", inDays: 14 }, purchase: { amount: "67.45", merchant: "Nairobi Craft Market", country: "Kenya" } },
  // Layout test: a very long name, the highest APR and the longest values
  { first: "Maximiliano-Bartholomew", last: "Featherstonehaugh-Villiers-Montgomery", state: "NC", apr: "29.99", fee: "695", phone: "+17045550185", platform: "android", last4: "6670", due: { amount: "4975.62", inDays: 25 }, purchase: { amount: "9875.40", merchant: "Pastelaria e Confeitaria Nacional de Belém", country: "United Kingdom of Great Britain and Northern Ireland" } },
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
  // Coral's alerts: servicing messages it sends to a customer's phone when something happens on their
  // card. Payment due renders Payment Due Reminder every day (history.ts); Card used abroad waits for its
  // template's approval, and the demo links it live.
  const alerts = [
    { id: "alert_payment_due", kind: "alert" as const, name: "Payment due", headline: "A statement's minimum payment is due soon", terms: null },
    { id: "alert_card_abroad", kind: "alert" as const, name: "Card used abroad", headline: "A card is used outside the US", terms: null },
  ];
  sink.simOffers.push(...offers, ...alerts);

  CUSTOMERS.forEach((c, i) => {
    sink.simCustomers.push({
      id: `cust_${String(i + 1).padStart(2, "0")}`,
      firstName: c.first,
      lastName: c.last,
      email: `${c.first}.${c.last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
      homeState: c.state,
      purchaseApr: c.apr,
      annualFee: c.fee,
      phone: c.phone,
      platform: c.platform,
      cardLast4: c.last4,
      statement: { minimumDue: c.due.amount, dueDate: ctx.at(-c.due.inDays).toISOString().slice(0, 10) },
      lastPurchase: c.purchase,
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
      // The seeded offers deliver PDF and web.
      channels: v.channels.filter((c): c is "pdf" | "web" => c === "pdf" || c === "web"),
      mapping: mapping([...customerKeys]),
      linkedAt: ctx.at(l.linkedAt),
    });
  }

  // The payment alert, linked when its template went live, on both of its channels.
  const payment = ctx.template("payment-due-reminder");
  sink.simLinks.push({
    id: ctx.id("lnk"),
    offerId: "alert_payment_due",
    templateId: payment.id,
    templateName: payment.name,
    pinnedVersion: payment.versions.v1.number ?? 0,
    channels: ["push", "sms"],
    mapping: { first_name: "customer.firstName", card_last4: "card.last4", amount_due: "card.minimumDue", due_date: "card.dueDate" },
    linkedAt: ctx.at(51.5),
  });

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
