// The one way Stencil writes a number people read: a count, or a stat card's short form. Pure, safe on
// the server and the client, and the same in every time zone and browser locale (always en-US).
//
//   formatCount    "812", "1,204"
//   compactCount   "812", "1.2k", "27.4k", "1.3m"
//
// A variable's value is not a number people read here: it prints exactly as sent
// (`formatValue` in src/editor/model/variables.ts, docs/render-spec.md).

const COUNT = new Intl.NumberFormat("en-US");
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** "1,204": a count, grouped by thousands. */
export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** A stat card's number: "812", "1.2k", "27.4k", "1.3m". */
export function compactCount(n: number): string {
  return n < 1000 ? COUNT.format(n) : COMPACT.format(n).toLowerCase();
}
