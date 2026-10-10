// npm run golden:import -- <templateId> <version> <sampleSet> [case-name]
//
// A command-line script, so it lives with the other scripts; the golden files it writes are in
// src/server/render/golden/cases (see docs/render-spec.md section 13).
//
// Freezes one seeded version into a new golden case: cases/<case-name>/input.json holds the version's
// document, variable list, email fields and one sample set's values, copied. Editing the seed later
// never moves the golden. The case name defaults to seed-<template key>-v<version>-<sample set>
// (version "draft" for the open draft). Then run `npm run golden:update` to write the expected files.
//
//   npm run golden:import -- UC-D6KSGY 2 typical
//   npm run golden:import -- UC-1FY7CY draft long overdraft-long
//
// The seed is read from a throwaway database made by the real seed (the same one render-template.test.ts
// uses), never from data/ucomp.db, so the result is the same on every machine.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { findRound } from "@/server/queries/find-round";
import { seedDatabase } from "@/server/seed";
import { caseDir, inputPath } from "@/server/render/golden/files";
import { GOLDEN_AT } from "@/server/render/golden/focused-cases";
import { json, type RenderFixture } from "@/server/render/testing/fixture";

const USAGE = "Usage: npm run golden:import -- <templateId> <version | draft> <sampleSet> [case-name]";

/** The seed's base time: any fixed instant gives the same structure; this one is the render tests'. */
const SEED_BASE = new Date("2026-10-04T12:00:00.000Z");

async function main() {
  const [templateArg, versionArg, setArg, nameArg] = process.argv.slice(2);
  if (!templateArg || !versionArg || !setArg) throw new Error(USAGE);
  const version = versionArg === "draft" ? "draft" : Number(versionArg);
  if (version !== "draft" && !Number.isInteger(version)) throw new Error(`The version must be a number or "draft". ${USAGE}`);

  const dir = mkdtempSync(path.join(tmpdir(), "golden-import-"));
  const client = createClient({ url: `file:${path.join(dir, "seed.db")}` });
  try {
    const db = drizzle(client, { schema }) as unknown as Db;
    await migrate(drizzle(client, { schema }), { migrationsFolder: "./src/server/db/migrations" });
    const seeded = await seedDatabase(db, { base: SEED_BASE });

    // The template by id (UC-D6KSGY) or by its seed key (balance-transfer).
    const id = seeded.templates[templateArg] ?? templateArg;
    const key = Object.entries(seeded.templates).find(([, value]) => value === id)?.[0];
    const [template] = await db.select().from(schema.templates).where(eq(schema.templates.id, id)).limit(1);
    if (!template || !key) {
      throw new Error(`No seeded template "${templateArg}". Seeded ids: ${Object.values(seeded.templates).join(", ")}`);
    }
    // A number is its head: the released row, else its latest round (what a consumer renders, or would).
    const [row] =
      version === "draft"
        ? await db.select().from(schema.versions).where(and(eq(schema.versions.templateId, id), isNull(schema.versions.number))).limit(1)
        : [await findRound(db, id, version)];
    if (!row) throw new Error(`${id} has no ${version === "draft" ? "open draft" : `version ${version}`}.`);
    const set = row.sampleSets.find((s) => s.id === setArg || s.name === setArg);
    if (!set) throw new Error(`${id} ${versionArg} has no sample set "${setArg}". It has: ${row.sampleSets.map((s) => s.id).join(", ")}`);

    const slug = nameArg ?? `seed-${key}-${version === "draft" ? "draft" : `v${version}`}-${set.id}`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`"${slug}" is not a usable case name (lowercase letters, digits and dashes).`);
    if (existsSync(inputPath(slug))) throw new Error(`cases/${slug}/input.json exists. Delete the folder to freeze it again, or pick another name.`);

    const input: RenderFixture = {
      templateId: id,
      templateName: row.name,
      versionNumber: row.number,
      at: GOLDEN_AT,
      variables: row.variables,
      values: set.values,
      body: row.body,
      emailSubject: row.emailSubject,
      emailPreheader: row.emailPreheader,
    };
    mkdirSync(caseDir(slug), { recursive: true });
    writeFileSync(inputPath(slug), json(input));
    console.log(`Froze ${id} ${version === "draft" ? "draft" : `v${version}`} (${set.id}) as cases/${slug}/input.json.\nNext: npm run golden:update`);
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
