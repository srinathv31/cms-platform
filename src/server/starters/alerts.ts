import type { ChannelFields } from "@/domain/channel-fields";
import type { Channel, JSONContent, Variable } from "@/domain/types";
import { emptyBody, inlineDoc, linesDoc } from "../seed/content";
import type { VarKey, VariableKit } from "../seed/variables";

// The Alert starters: a push and an SMS, with no body (decision 0034). Each passes submit's message
// rules as it comes (starters.test.ts): its SMS text is GSM-7 and within the Alert's 3 parts with the
// long sample values and the footer, it links to no public shortener, and its push fits in 4,096 bytes.
// No push title carries anything private: Android shows the title on a locked phone even when previews
// are hidden. The SMS opens with the brand, because a US text shows a short code where a name would be.
// Every declared variable is used.

/** What an alert starter contributes, besides its key and name. */
export interface AlertStarter {
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  channelFields: ChannelFields;
}

const ALERT_CHANNELS: Channel[] = ["push", "sms"];

function alert(scope: string, kit: VariableKit, keys: VarKey[], channelFields: ChannelFields): AlertStarter {
  return { body: emptyBody(scope), variables: kit.list(keys), channels: [...ALERT_CHANNELS], channelFields };
}

/** Push and SMS on, nothing written yet. */
export function blankAlert(scope: string, kit: VariableKit): AlertStarter {
  return alert(scope, kit, [], {});
}

export function paymentReminder(scope: string, kit: VariableKit): AlertStarter {
  return alert(scope, kit, ["first_name", "amount_due", "due_date"], {
    push: {
      title: inlineDoc("Your payment is due soon"),
      body: inlineDoc("Hi {first_name}, your minimum payment of {amount_due} is due {due_date}. Pay in the app to avoid a late fee."),
    },
    sms: { text: linesDoc("Coral: Your minimum payment of {amount_due} is due {due_date}.", "Pay at coral.example/pay") },
  });
}

export function cardActivity(scope: string, kit: VariableKit): AlertStarter {
  return alert(scope, kit, ["card_last4", "transaction_amount", "merchant"], {
    push: {
      title: inlineDoc("Check a recent purchase"),
      subtitle: inlineDoc("Card ending in {card_last4}"),
      body: inlineDoc("Your card was used for {transaction_amount} at {merchant}. If it wasn't you, lock your card in the app."),
    },
    sms: {
      text: linesDoc(
        "Coral: Your card ending {card_last4} was used for {transaction_amount} at {merchant}.",
        "Not you? Call 1-800-555-0142.",
      ),
    },
  });
}

export function statementReady(scope: string, kit: VariableKit): AlertStarter {
  return alert(scope, kit, ["first_name", "statement_balance", "amount_due", "due_date"], {
    push: {
      title: inlineDoc("Your statement is ready"),
      body: inlineDoc(
        "Hi {first_name}, your new statement is ready. Your balance is {statement_balance}, and your minimum payment of {amount_due} is due {due_date}.",
      ),
    },
    sms: { text: linesDoc("Coral: Your statement is ready. Minimum payment {amount_due} due {due_date}.", "coral.example/statements") },
  });
}
