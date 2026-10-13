import { readFileSync, readdirSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";
import { versions } from "@/server/db/schema/ucomp";
import { prepareDraftPatch } from "@/server/drafts/prepare-patch";
import { localServices } from "@/server/services/local";
import type { RequestContext } from "@/server/services/types";
import {
  createTemplateWithDraft,
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";

// The SQL that filled two columns of `versions` for rows that existed before the column did: run again over
// versions the app wrote, it must reach what the app records. `writers` (maker-checker) from each version's
// creator, submitter, edits and returned rounds; `sms_footer` from the content type, frozen at submit.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-version-backfills-");
});

const MIGRATIONS = "./src/server/db/migrations";
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let libsql: Client;
seededDatabasePerTest({ base: BASE });
let clock = BASE;
const { review, drafts } = localServices({ clock: async () => clock });

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
});

/** The backfill statement of the migration whose file ends with `suffix` (the one after its breakpoint). */
function backfillOf(suffix: string) {
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith(suffix))!;
  const [, backfill] = readFileSync(`${MIGRATIONS}/${file}`, "utf8").split(
    "--> statement-breakpoint",
  );
  return backfill!;
}

// Every step a minute after the last.
let minute = 0;
async function as(userId: string): Promise<RequestContext> {
  minute += 1;
  clock = new Date(BASE.getTime() + minute * 60_000);
  return {
    viewer: await loadPersona(db, userId),
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

const draftOf = (templateId: string) =>
  db.query.versions
    .findFirst({
      where: and(
        eq(versions.templateId, templateId),
        eq(versions.state, "draft"),
      ),
    })
    .then((v) => v!);

/** An autosave by this person, as the workspace sends it: a paragraph added to the open draft. */
async function edit(userId: string, templateId: string, text: string) {
  const ctx = await as(userId);
  const draft = await draftOf(templateId);
  // Prepared as the autosave route prepares it, then saved by the backend.
  const prepared = prepareDraftPatch({
    rev: draft.rev,
    sessionKey: `session-${userId}-${minute}`,
    body: {
      ...draft.body,
      content: [
        ...(draft.body.content ?? []),
        { type: "paragraph", content: [{ type: "text", text }] },
      ],
    },
  });
  if (!prepared.ok) throw new Error(prepared.reason);
  const saved = await drafts.save(ctx, {
    versionId: draft.id,
    patch: prepared.patch,
  });
  expect(saved.ok, `${userId}'s save lands`).toBe(true);
}

async function submit(userId: string, templateId: string) {
  const ctx = await as(userId);
  const { rev } = await draftOf(templateId);
  expect(await review.submit(ctx, { templateId, rev })).toMatchObject({
    ok: true,
  });
}

describe("the writers backfill", () => {
  it("rebuilds every version's writers from its creator, submitter, edits and returned rounds", async () => {
    const writersById = async () =>
      Object.fromEntries(
        (
          await db
            .select({ id: versions.id, writers: versions.writers })
            .from(versions)
        ).map((v) => [v.id, [...v.writers].sort()]),
      );

    // Priya edits Maya's draft before Maya submits it, and the round Jordan sends back carries both writers on;
    // Priya submits another template Maya created.
    const edited = (
      await createTemplateWithDraft(db, {
        teamId: "t_coral",
        createdBy: "maya",
        at: BASE,
      })
    ).templateId;
    await edit("priya", edited, "Priya's sentence.");
    await submit("maya", edited);
    expect(
      await review.requestChanges(await as("jordan"), {
        templateId: edited,
        versionNumber: 1,
        round: 1,
        reason: "Spell out the APR.",
      }),
    ).toEqual({ ok: true });
    await edit("maya", edited, "The APR is 21.99%.");
    await submit("maya", edited);
    const submittedByPriya = (
      await createTemplateWithDraft(db, {
        teamId: "t_coral",
        createdBy: "maya",
        at: BASE,
      })
    ).templateId;
    await submit("priya", submittedByPriya);

    const recorded = await writersById();
    expect(
      Object.values(recorded).some((w) => w.length > 1),
      "some version has two writers",
    ).toBe(true);
    await libsql.execute("UPDATE versions SET writers = '[]'");
    await libsql.execute(backfillOf("_version_writers.sql"));
    expect(await writersById()).toEqual(recorded);
  });
});

describe("the SMS footer backfill", () => {
  it("gives every submitted version its content type's footer, and leaves drafts and documents without one", async () => {
    const footers = async () =>
      Object.fromEntries(
        (
          await db
            .select({ id: versions.id, smsFooter: versions.smsFooter })
            .from(versions)
        ).map((v) => [v.id, v.smsFooter]),
      );

    const recorded = await footers();
    expect(
      Object.values(recorded).filter(Boolean).length,
      "some alert versions are submitted",
    ).toBeGreaterThan(0);
    await libsql.execute("UPDATE versions SET sms_footer = NULL");
    await libsql.execute(backfillOf("_version_sms_footer.sql"));
    expect(await footers()).toEqual(recorded);
  });
});
