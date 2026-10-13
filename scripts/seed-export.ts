// npm run seed:export [-- --out <file>]
// Writes the demo seed as one language-neutral JSON fixture, with times relative to the reset (decision 0069).
// The default file is data/seed-fixture.json, which git ignores. The shape is described in
// src/server/seed/README.md ("The fixture").

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildFixture, stringifyFixture } from "@/server/seed/fixture";

const { values } = parseArgs({
  options: { out: { type: "string", short: "o" } },
});
const out = resolve(values.out ?? "data/seed-fixture.json");

const fixture = buildFixture();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, stringifyFixture(fixture));

const rows = fixture.tables.reduce((sum, t) => sum + t.rows.length, 0);
console.log(
  `Wrote ${out}: ${fixture.tables.length} tables, ${rows} rows, ${Object.keys(fixture.templates).length} templates.`,
);
