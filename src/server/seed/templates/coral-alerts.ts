import type { SeedCtx } from "../context";
import { emptyBody, inlineDoc, linesDoc } from "../content";
import { buildTemplate } from "./build";
import type { SeedTemplate } from "./types";

// Coral Offers' alerts: push and SMS on the Alert content type (decision 0034), one in each state an
// alert demo needs. Payment Due Reminder is Active with renders on both channels; Card Used Abroad
// waits for an approver; Rate Change Heads-up is a draft that pairs with the Rate Change Notice letter
// (a separate template: a letter plus a text heads-up is two templates). Times are days before the reset.
//
// Built after every other team's templates, so the seeded ids that came before alerts stay the same.
//
// Every version passes submit's message rules with its own sample sets (seed.test.ts): the SMS text is
// GSM-7, within the Alert's 3 parts with the long values and the footer, and links to no public
// shortener; each push fits in 4,096 bytes on both platforms. No push title carries anything private
// (Android shows the title on a locked phone with previews hidden): amounts, merchants and card digits
// sit in the body, or in the iPhone-only subtitle. Each SMS opens with the brand, because a US text
// shows a short code where a name would be; the content type's footer adds the opt-out.

export function seedCoralAlerts(ctx: SeedCtx) {
  const { vars } = ctx;

  const templates: SeedTemplate[] = [
    // v1 Active, made from the Payment reminder starter: renders to Push and SMS every day.
    {
      key: "payment-due-reminder",
      teamId: "coral-offers",
      contentType: "alert",
      name: "Payment Due Reminder",
      createdBy: "maya",
      createdAt: 58,
      starterKey: "payment_reminder",
      consumers: ["coral"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "active",
          body: emptyBody("payment-due-reminder"),
          variables: vars.list(["first_name", "card_last4", "amount_due", "due_date"]),
          channels: ["push", "sms"],
          channelFields: {
            push: {
              title: inlineDoc("Your payment is due soon"),
              subtitle: inlineDoc("Coral card ending in {card_last4}"),
              body: inlineDoc(
                "Hi {first_name}, your minimum payment of {amount_due} is due {due_date}. Pay in the app to avoid a late fee.",
              ),
            },
            sms: { text: linesDoc("Coral: Your minimum payment of {amount_due} is due {due_date}.", "Pay at coral.example/pay") },
          },
          createdBy: "maya",
          createdAt: 58,
          editSessions: 3,
          submittedBy: "maya",
          submittedAt: 53,
          submitNote: "Payment reminders move to Stencil from the card platform's own text. Same wording, now approved.",
          approvals: [{ actor: "jordan", decision: "approved", at: 51.5, seen: ["typical", "long", "minimum"] }],
          activatedAt: 51.5,
        },
      ],
    },

    // v1 In review: Priya submitted it yesterday, and Jordan or Alex approves it.
    {
      key: "card-used-abroad",
      teamId: "coral-offers",
      contentType: "alert",
      name: "Card Used Abroad",
      createdBy: "priya",
      createdAt: 6,
      starterKey: "card_activity",
      consumers: ["coral"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "in_review",
          body: emptyBody("card-used-abroad"),
          variables: vars.list(["card_last4", "transaction_amount", "merchant", "country"]),
          channels: ["push", "sms"],
          channelFields: {
            push: {
              title: inlineDoc("Was this you?"),
              subtitle: inlineDoc("Card ending in {card_last4}"),
              body: inlineDoc(
                "Your Coral card was used for {transaction_amount} at {merchant} in {country}. If it wasn't you, lock your card in the app.",
              ),
            },
            sms: {
              text: linesDoc(
                "Coral: Your card ending {card_last4} was used for {transaction_amount} at {merchant} in {country}.",
                "Not you? Call 1-800-555-0142.",
              ),
            },
          },
          createdBy: "priya",
          createdAt: 6,
          editSessions: 3,
          submittedBy: "priya",
          submittedAt: 1.2,
          submitNote: "Fraud Operations asked for a push and a text when a card is used outside the US.",
        },
      ],
    },

    // A draft from Blank, the text heads-up for the Rate Change Notice letter.
    {
      key: "rate-change-heads-up",
      teamId: "coral-offers",
      contentType: "alert",
      name: "Rate Change Heads-up",
      createdBy: "maya",
      createdAt: 2.5,
      consumers: ["coral"],
      versions: [
        {
          ref: "draft",
          number: null,
          state: "draft",
          body: emptyBody("rate-change-heads-up"),
          variables: vars.list(["first_name", "purchase_apr", "effective_date"]),
          channels: ["push", "sms"],
          channelFields: {
            push: {
              title: inlineDoc("A change to your account"),
              body: inlineDoc(
                "Hi {first_name}, your purchase APR changes to {purchase_apr} on {effective_date}. Your rate change notice explains what's changing and how to reject it.",
              ),
            },
            sms: {
              text: linesDoc(
                "Coral: Your purchase APR changes to {purchase_apr} on {effective_date}.",
                "Your notice and how to reject the change: coral.example/notices",
              ),
            },
          },
          createdBy: "maya",
          createdAt: 2.5,
          updatedAt: 0.4,
          editSessions: 2,
          rev: 17,
        },
      ],
    },
  ];

  for (const t of templates) buildTemplate(ctx, t);
}
