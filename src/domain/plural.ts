// The one way Stencil puts a count and a noun together. Pure, and safe on the server and the client.
//
//   plural(3, "version")             "3 versions"
//   plural(1, "policy", "policies")  "1 policy"
//   plural(1204, "render")           "1,204 renders" (the count is `formatCount`'s)
//   pluralWord(2, "variable")        "variables": the noun alone, for "adds the required variables a and b"
//   pluralName("Disclosure")         "Disclosures": a content type's name in the plural

import { formatCount } from "./numbers";

/** "1 version", "3 versions", "1,204 renders". `many` defaults to `one` plus "s". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${pluralWord(n, one, many)}`;
}

/** The noun alone, singular for 1 and plural otherwise (0 included). */
export function pluralWord(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "Disclosure" → "Disclosures", "Policy" → "Policies"; a name already ending in "s" ("Notices") stays. */
export function pluralName(name: string): string {
  if (/s$/i.test(name)) return name;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}
