// Who a preview's output is from and to, and when: the email frame's two made-up lines (from the team,
// out to the sample set), and the phone's sender and clock for Push and SMS. Pure TypeScript.

import type { DeviceClock } from "@/components/device";
import { formatPhoneDate } from "@/domain/dates";
import type { TeamSenders } from "@/domain/platform-config";
import type { VariableValues } from "@/editor/model/types";
import type { PhoneSenders } from "./phone-output";

/**
 * "Coral Offers" sends from "no-reply@coraloffers.example". A name with no ASCII letter or digit in it sends
 * from Stencil's "no-reply@stencil.example". `.example` is reserved (RFC 2606), so no address here is real.
 */
export function senderOf(teamName: string): { name: string; address: string } {
  const domain = teamName.toLowerCase().replace(/[^a-z0-9]+/g, "") || "stencil";
  return { name: teamName, address: `no-reply@${domain}.example` };
}

/** Who a sample set's message is out to: first and last name when it has them, else a full-name value. */
export function recipientOf(values: VariableValues): string | null {
  const text = (key: string) => {
    const value = values[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const named = [text("first_name"), text("last_name")].filter((part): part is string => part !== null);
  if (named.length > 0) return named.join(" ");
  const full = Object.keys(values).find((key) => /^(?:(?:full|customer|cardholder|member)_)?name$/.test(key));
  return (full && text(full)) || null;
}

/**
 * Who the team's messages come from on the phone. The push's app is the team's app name, else its name
 * (a team always has one), so the app is never blank. The SMS's sender is the team's short code, else
 * none (""): a US text can't show a brand name there, and a made-up number would pass for the real one,
 * so the phone shows a neutral "No sender" instead (the kit's `NO_SENDER`).
 */
export function phoneSenders(senders: TeamSenders, teamName: string): PhoneSenders {
  return { appName: senders.appName?.trim() || teamName.trim(), smsSender: senders.smsSender?.trim() || "" };
}

/** The phone's clock: 9:41, as every phone preview shows it, on the demo clock's day ("Friday, October 9"). */
export function phoneClock(today: string): DeviceClock {
  return { time: "9:41", date: formatPhoneDate(today) };
}
