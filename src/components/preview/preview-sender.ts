// The email frame's two made-up lines: who the message is from (the team) and who it is out to (the
// sample set). Pure TypeScript.

import type { VariableValues } from "@/editor";

/** "Coral Offers" sends from "no-reply@coraloffers.example". */
export function senderOf(teamName: string): { name: string; address: string } {
  const domain = teamName.toLowerCase().replace(/[^a-z0-9]+/g, "") || "ucomp";
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
