import { describe, expect, it } from "vitest";
import type { ApiVariable } from "@/contracts/api-v1";
import { SIM_FIELDS, isSimFieldPath, simField } from "./fields";
import { blockedSentence, fieldValue, missingRequired, suggestMapping, valuesFor } from "./mapping";
import type { SimCustomerRecord, SimOfferRecord } from "./types";

const v = (key: string, label: string, type: ApiVariable["type"], required = true): ApiVariable => ({
  key,
  label,
  type,
  required,
  example: "",
});

const V3: ApiVariable[] = [
  v("first_name", "First name", "text"),
  v("last_name", "Last name", "text"),
  v("purchase_apr", "Purchase APR", "percent"),
  v("home_state", "Home state", "us_state"),
  v("annual_fee", "Annual fee", "currency"),
  v("offer_end_date", "Offer end date", "date", false),
];

const customer: SimCustomerRecord = {
  id: "cust_01",
  firstName: "Olivia",
  lastName: "Bennett",
  email: "olivia.bennett@example.com",
  homeState: "NJ",
  purchaseApr: "21.99",
  annualFee: "0",
  cardLast4: "3417",
  statement: { minimumDue: "35.00", dueDate: "2026-10-21" },
  lastPurchase: { amount: "48.20", merchant: "Café Lisboa", country: "Portugal" },
};

/** Card Used Abroad and Payment Due Reminder, Coral's alerts. */
const ALERT_VARS: ApiVariable[] = [
  v("first_name", "First name", "text"),
  v("card_last4", "Card last 4", "text"),
  v("amount_due", "Amount due", "currency"),
  v("due_date", "Due date", "date"),
  v("transaction_amount", "Purchase amount", "currency"),
  v("merchant", "Merchant", "text"),
  v("country", "Country", "text"),
];

const offer: SimOfferRecord = {
  id: "offer_spring_travel",
  name: "Spring Travel Rewards",
  headline: "Spend $1,000 in 3 months, get $200 back",
  terms: { spend: 1000, bonus: 200, months: 3, annualFee: 95, endsOn: "2027-06-30" },
};

describe("SIM_FIELDS", () => {
  it("lists every customer, card and offer path once, labelled by source", () => {
    const prefix = { customer: "Customer · ", card: "Card · ", offer: "Offer · " };
    expect(new Set(SIM_FIELDS.map((f) => f.path)).size).toBe(SIM_FIELDS.length);
    for (const f of SIM_FIELDS) {
      expect(f.path.startsWith(`${f.source}.`)).toBe(true);
      expect(f.label.startsWith(prefix[f.source])).toBe(true);
    }
    expect(simField("offer.annualFee")?.label).toBe("Offer · Annual fee");
    expect(isSimFieldPath("customer.ssn")).toBe(false);
  });
});

describe("suggestMapping", () => {
  it("auto-maps the keys it is sure of and leaves annual_fee for the person", () => {
    expect(suggestMapping(V3)).toEqual({
      first_name: "customer.firstName",
      last_name: "customer.lastName",
      purchase_apr: "customer.purchaseApr",
      home_state: "customer.homeState",
      offer_end_date: "offer.endsOn",
    });
  });

  it("keeps current mappings that still fit, and drops keys that are no longer variables", () => {
    const current = {
      first_name: "customer.fullName",
      annual_fee: "offer.annualFee",
      retired_key: "customer.email",
    } as const;
    expect(suggestMapping(V3, current)).toMatchObject({ first_name: "customer.fullName", annual_fee: "offer.annualFee" });
    expect(suggestMapping(V3, current)).not.toHaveProperty("retired_key");
  });

  it("drops a current mapping whose field no longer fits the variable's type", () => {
    const retyped = [v("purchase_apr", "Purchase APR", "date"), v("home_state", "Home state", "currency")];
    expect(suggestMapping(retyped, { purchase_apr: "customer.purchaseApr", home_state: "offer.annualFee" })).toEqual({
      home_state: "offer.annualFee",
    });
  });

  it("auto-maps an alert's keys to the customer's card", () => {
    expect(suggestMapping(ALERT_VARS)).toEqual({
      first_name: "customer.firstName",
      card_last4: "card.last4",
      amount_due: "card.minimumDue",
      due_date: "card.dueDate",
      transaction_amount: "card.purchaseAmount",
      merchant: "card.purchaseMerchant",
      country: "card.purchaseCountry",
    });
  });

  it("does not auto-map a known key when the type doesn't fit", () => {
    expect(suggestMapping([v("first_name", "First name", "date")])).toEqual({});
  });

  it("ignores unknown field paths in the current mapping", () => {
    expect(suggestMapping([v("annual_fee", "Annual fee", "currency")], { annual_fee: "customer.ssn" })).toEqual({});
  });
});

describe("missingRequired", () => {
  it("names unmapped required variables in contract order and ignores optional ones", () => {
    const missing = missingRequired(V3, { first_name: "customer.firstName", home_state: "customer.homeState" });
    expect(missing.map((m) => m.key)).toEqual(["last_name", "purchase_apr", "annual_fee"]);
  });

  it("treats null and unknown paths as unmapped", () => {
    expect(missingRequired([v("annual_fee", "Annual fee", "currency")], { annual_fee: null }).length).toBe(1);
    expect(missingRequired([v("annual_fee", "Annual fee", "currency")], { annual_fee: "nope" }).length).toBe(1);
    expect(missingRequired([v("annual_fee", "Annual fee", "currency")], { annual_fee: "offer.annualFee" })).toEqual([]);
  });
});

describe("valuesFor", () => {
  it("produces canonical strings from customer and offer fields", () => {
    const values = valuesFor(
      {
        first_name: "customer.firstName",
        last_name: "customer.lastName",
        purchase_apr: "customer.purchaseApr",
        home_state: "customer.homeState",
        annual_fee: "offer.annualFee",
        offer_end_date: "offer.endsOn",
      },
      customer,
      offer,
    );
    expect(values).toEqual({
      first_name: "Olivia",
      last_name: "Bennett",
      purchase_apr: "21.99",
      home_state: "NJ",
      annual_fee: "95",
      offer_end_date: "2027-06-30",
    });
  });

  it("covers every field path", () => {
    const all = Object.fromEntries(SIM_FIELDS.map((f) => [f.path, f.path]));
    expect(valuesFor(all as never, customer, offer)).toEqual({
      "customer.firstName": "Olivia",
      "customer.lastName": "Bennett",
      "customer.fullName": "Olivia Bennett",
      "customer.email": "olivia.bennett@example.com",
      "customer.homeState": "NJ",
      "customer.purchaseApr": "21.99",
      "customer.annualFee": "0",
      "card.last4": "3417",
      "card.minimumDue": "35.00",
      "card.dueDate": "2026-10-21",
      "card.purchaseAmount": "48.20",
      "card.purchaseMerchant": "Café Lisboa",
      "card.purchaseCountry": "Portugal",
      "offer.name": "Spring Travel Rewards",
      "offer.headline": "Spend $1,000 in 3 months, get $200 back",
      "offer.spend": "1000",
      "offer.bonus": "200",
      "offer.months": "3",
      "offer.annualFee": "95",
      "offer.endsOn": "2027-06-30",
    });
  });

  it("leaves out fields Coral has no value for, so UCOMP reports them", () => {
    const bare: SimOfferRecord = { ...offer, terms: { spend: 0, bonus: 0, months: 12 } };
    expect(valuesFor({ annual_fee: "offer.annualFee", end: "offer.endsOn" }, customer, bare)).toEqual({});
    expect(fieldValue("customer.annualFee", { ...customer, annualFee: null }, offer)).toBeNull();
  });

  it("has no offer terms for an alert, and no card values for a card without a statement or purchase", () => {
    const alert: SimOfferRecord = { id: "alert_card_abroad", name: "Card used abroad", headline: "A card is used outside the US", terms: null };
    const terms = ["offer.spend", "offer.bonus", "offer.months", "offer.annualFee", "offer.endsOn"] as const;
    expect(valuesFor(Object.fromEntries(terms.map((p) => [p, p])) as never, customer, alert)).toEqual({});
    const bare = { ...customer, statement: null, lastPurchase: null };
    expect(valuesFor(suggestMapping(ALERT_VARS), bare, alert)).toEqual({ first_name: "Olivia", card_last4: "3417" });
  });
});

describe("blockedSentence", () => {
  it("names the missing labels", () => {
    expect(blockedSentence([])).toBe("");
    expect(blockedSentence([{ label: "Annual fee" }])).toBe("Map Annual fee to send.");
    expect(blockedSentence([{ label: "First name" }, { label: "Annual fee" }])).toBe("Map First name and Annual fee to send.");
    expect(blockedSentence([{ label: "A" }, { label: "B" }, { label: "C" }])).toBe("Map A, B and C to send.");
  });
});
