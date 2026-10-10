// npm run golden:import -- <templateId> <version> <sampleSet> [case-name]
//
// A command-line script, so it lives with the other scripts; the golden files it writes are in
// src/server/render/golden/cases (see docs/render-spec.md section 13).
//
// Freezes one seeded version into a new golden case: cases/<case-name>/input.json holds the version's
// document, variable list, channel fields and one sample set's values, copied, with every channel of
// its family (and a message's SMS footer). Editing the seed later
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
import { familyChannels, familyOf } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
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
    const [row] = await db
      .select()
      .from(schema.versions)
      .where(and(eq(schema.versions.templateId, id), version === "draft" ? isNull(schema.versions.number) : eq(schema.versions.number, version)))
      .limit(1);
    if (!row) throw new Error(`${id} has no ${version === "draft" ? "open draft" : `version ${version}`}.`);
    const set = row.sampleSets.find((s) => s.id === setArg || s.name === setArg);
    if (!set) throw new Error(`${id} ${versionArg} has no sample set "${setArg}". It has: ${row.sampleSets.map((s) => s.id).join(", ")}`);

    const slug = nameArg ?? `seed-${key}-${version === "draft" ? "draft" : `v${version}`}-${set.id}`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`"${slug}" is not a usable case name (lowercase letters, digits and dashes).`);
    if (existsSync(inputPath(slug))) throw new Error(`cases/${slug}/input.json exists. Delete the folder to freeze it again, or pick another name.`);

    // Every channel of the version's family, on or not, so the case checks all of them; and for a
    // message, its content type's SMS footer.
    const [contentType] = await db.select().from(schema.contentTypes).where(eq(schema.contentTypes.id, template.contentTypeId)).limit(1);
    const family = familyOf(row.channels) ?? "document";
    const input: RenderFixture = {
      templateId: id,
      templateName: row.name,
      versionNumber: row.number,
      at: GOLDEN_AT,
      variables: row.variables,
      values: set.values,
      body: row.body,
      channelFields: row.channelFields,
      channels: [...familyChannels(family)],
      ...(family === "message" && contentType?.smsFooter ? { smsFooter: contentType.smsFooter } : {}),
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
