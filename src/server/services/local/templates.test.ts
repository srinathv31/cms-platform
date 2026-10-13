import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { IMPORT_MIME } from "@/domain/import-types";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { createAppClient } from "@/lib/serialized-writes";
import type { RequestContext } from "@/server/context/request";
import { importTemplate } from "@/server/import/create";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { Services } from "../types";
import { localServices } from "./index";

// The local implementation's templates against a temporary database filled by the real seed, with uploads written
// to a temporary folder: what only this implementation has (the SQL it writes, the files an import keeps, the
// serialized write queue), and the BFF's import end to end on top of it. What every implementation must show is the
// contract suite's (src/server/services/contract/templates.ts).

const env = vi.hoisted(() => ({
  now: new Date("2026-10-04T12:00:00.000Z"),
  services: undefined as unknown as Services,
}));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-templates-");
});
vi.mock("@/server/services", () => ({ services: () => env.services }));
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));

const { auditEvents, contentTypes, templates, uploads, versions } = schema;

let db: Db;
let root: string;
let maya: RequestContext;
const ids = seededDatabasePerTest({ base: env.now });

const contextOf = async (userId: string): Promise<RequestContext> => ({
  viewer: await loadPersona(db, userId),
  correlationId: "req_test",
  credential: { kind: "in_process", userId },
});

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
  maya = await contextOf("maya");
}, 60_000);

// Each test's uploads go to a folder of its own, like its database.
beforeEach(() => {
  env.now = new Date("2026-10-04T12:00:00.000Z");
  root = mkdtempSync(join(tmpdir(), "ucomp-uploads-"));
  env.services = localServices({
    uploadsRoot: root,
    clock: async () => env.now,
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`e2e/fixtures/import/${name}`));

const rows = async () => ({
  templates: await db.select({ id: templates.id }).from(templates),
  uploads: await db.select({ id: uploads.id }).from(uploads),
});

describe("an import, from the BFF to the files", () => {
  it("stores the template, its draft, the upload row, the files and the audit event in one go", async () => {
    const res = await importTemplate(maya, {
      teamSlug: "coral-offers",
      file: {
        name: "../Spring offer.docx",
        bytes: fixture("spring-offer.docx"),
      },
    });
    if (!res.ok) throw new Error(`refused: ${res.code}`);

    expect(
      await db.query.templates.findFirst({
        where: eq(templates.id, res.templateId),
      }),
    ).toMatchObject({ teamId: "t_coral", starterKey: null, createdBy: "maya" });
    const draft = await db.query.versions.findFirst({
      where: eq(versions.templateId, res.templateId),
    });
    expect(draft).toMatchObject({
      state: "draft",
      name: "Spring Balance Transfer Offer",
      writers: ["maya"],
      rev: 0,
    });
    const upload = await db.query.uploads.findFirst({
      where: eq(uploads.templateId, res.templateId),
    });
    expect(upload).toMatchObject({
      filename: "Spring offer.docx",
      mime: IMPORT_MIME.docx,
      size: fixture("spring-offer.docx").length,
      createdBy: "maya",
      createdAt: env.now,
    });
    expect(upload!.id).toMatch(/^up_[0-9a-z]{10}$/);
    expect(upload!.path).toBe(`${upload!.id}/original.docx`);
    expect(draft?.importUploadId).toBe(upload!.id);
    expect(readdirSync(join(root, upload!.id)).sort()).toEqual([
      "compare.html",
      "original.docx",
      "report.json",
    ]);
    expect(
      await db.query.auditEvents.findFirst({
        where: eq(auditEvents.templateId, res.templateId),
      }),
    ).toMatchObject({
      action: "template.created",
      actorId: "maya",
      at: env.now,
      details: {
        name: "Spring Balance Transfer Offer",
        source: "import:docx",
        filename: "Spring offer.docx",
      },
    });
  });

  it("serves the original and the Original tab's facts from the files it kept", async () => {
    const res = await importTemplate(maya, {
      teamSlug: "coral-offers",
      file: {
        name: "rate-change-notice.pdf",
        bytes: fixture("rate-change-notice.pdf"),
      },
    });
    if (!res.ok) throw new Error(`refused: ${res.code}`);
    const { uploadId } = await db.query.uploads
      .findFirst({
        where: eq(uploads.templateId, res.templateId),
      })
      .then((u) => ({ uploadId: u!.id }));

    const original = await env.services.templates.importOriginal(maya, {
      uploadId,
    });
    expect(original).toMatchObject({ ok: true, mime: IMPORT_MIME.pdf });
    expect(
      original.ok &&
        Buffer.from(original.bytes).equals(
          Buffer.from(fixture("rate-change-notice.pdf")),
        ),
    ).toBe(true);
    expect(
      await env.services.templates.importOriginalView(maya, { uploadId }),
    ).toMatchObject({
      ok: true,
      original: { kind: "pdf" },
      report: { kind: "pdf", pages: 2 },
      compareHtml: null,
    });
  });

  it("reads an upload whose files are gone as missing, not as an error", async () => {
    const res = await importTemplate(maya, {
      teamSlug: "coral-offers",
      file: { name: "notes.txt", bytes: fixture("spring_offer_notes.txt") },
    });
    if (!res.ok) throw new Error(`refused: ${res.code}`);
    const upload = (await db.query.uploads.findFirst({
      where: eq(uploads.templateId, res.templateId),
    }))!;
    rmSync(join(root, upload.id), { recursive: true });
    expect(existsSync(join(root, upload.id))).toBe(false);

    for (const read of [
      env.services.templates.importOriginal(maya, { uploadId: upload.id }),
      env.services.templates.importOriginalView(maya, { uploadId: upload.id }),
    ])
      expect(await read).toMatchObject({
        ok: false,
        status: 404,
        code: "upload_unavailable",
      });
  });

  it("refuses, rather than fails, when no content type makes documents: nothing written, no folder", async () => {
    // Every content type makes alerts only, so there is no document type to import into.
    await db.update(contentTypes).set({ allowedChannels: ["push", "sms"] });
    const before = await rows();
    const res = await importTemplate(maya, {
      teamSlug: "coral-offers",
      file: { name: "notes.txt", bytes: fixture("spring_offer_notes.txt") },
    });
    expect(res).toEqual({ ok: false, ...REFUSALS.noContentType("document") });
    expect(await rows()).toEqual(before);
    expect(readdirSync(root)).toEqual([]);
  });

  it("removes the upload's folder when the transaction fails after the files were written, and writes no rows", async () => {
    const before = await rows();
    const run = db.transaction.bind(db) as (
      body: (tx: never) => Promise<unknown>,
    ) => Promise<unknown>;
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce(((
      body: (tx: never) => Promise<unknown>,
    ) =>
      run(async (tx) => {
        await body(tx);
        // The files are down and the rows are in; then the commit fails.
        expect(readdirSync(root)).toHaveLength(1);
        throw new Error("disk full");
      })) as never);
    await expect(
      importTemplate(maya, {
        teamSlug: "coral-offers",
        file: { name: "a.txt", bytes: fixture("spring_offer_notes.txt") },
      }),
    ).rejects.toThrow("disk full");
    spy.mockRestore();
    expect(readdirSync(root)).toEqual([]);
    expect(await rows()).toEqual(before);
  });

  it("removes the folder when the id it draws is taken three times, and writes nothing", async () => {
    const taken = ids["balance-transfer"]!;
    env.services = localServices({
      uploadsRoot: root,
      clock: async () => env.now,
      ids: { templateId: () => taken },
    });
    const before = await rows();
    await expect(
      importTemplate(maya, {
        teamSlug: "coral-offers",
        file: { name: "a.txt", bytes: fixture("spring_offer_notes.txt") },
      }),
    ).rejects.toThrow();
    expect(await rows()).toEqual(before);
    expect(readdirSync(root)).toEqual([]);
  });

  it("writes no folder for a refusal: not the permission's, and not a channel the content type doesn't allow", async () => {
    const sam = await contextOf("sam");
    expect(
      await importTemplate(sam, {
        teamSlug: "coral-offers",
        file: { name: "a.txt", bytes: fixture("spring_offer_notes.txt") },
      }),
    ).toMatchObject({ ok: false, code: "generic" });
    expect(
      await env.services.templates.createImported(maya, {
        teamId: "t_coral",
        contentTypeId: "ct_disclosure",
        draft: {
          name: "x",
          body: { type: "doc", content: [] },
          channelFields: {},
          channels: ["push"],
          variables: [],
          sampleSets: [],
          starterKey: null,
        },
        original: {
          filename: "x.txt",
          mime: IMPORT_MIME.txt,
          bytes: new Uint8Array([1]),
        },
        report: {
          kind: "txt",
          filename: "x.txt",
          size: 1,
          nameFrom: "filename",
          placeholders: [],
          skippedPlaceholders: [],
          sections: { matched: [], added: [] },
          counts: { headings: 0, paragraphs: 0, lists: 0, tables: 0 },
          dropped: [],
        },
        compareHtml: null,
      }),
    ).toMatchObject({ ok: false, code: REFUSALS.channelNotAllowed.code });
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("a new template takes the content type as Platform settings leave it", () => {
  it("names no content type for a kind none makes, as a refusal", async () => {
    await db
      .update(contentTypes)
      .set({ allowedChannels: ["pdf"] })
      .where(eq(contentTypes.id, "ct_alert"));
    expect(
      await env.services.templates.newTemplateType(maya, {
        teamId: "t_coral",
        family: "message",
      }),
    ).toMatchObject({
      ok: false,
      status: 409,
      code: REFUSALS.noContentType.code,
    });
  });

  it("reads the sections and channels as they stand now", async () => {
    await db
      .update(contentTypes)
      .set({
        requiredSections: [{ key: "eligibility", title: "Eligibility" }],
        allowedChannels: ["pdf", "web"],
      })
      .where(eq(contentTypes.id, "ct_disclosure"));
    expect(
      await env.services.templates.newTemplateType(maya, {
        teamId: "t_coral",
        family: "document",
      }),
    ).toMatchObject({
      ok: true,
      contentTypeId: "ct_disclosure",
      requiredSections: [{ key: "eligibility", title: "Eligibility" }],
      allowedChannels: ["pdf", "web"],
    });
  });

  it("refuses a draft whose channels the content type has stopped allowing since the BFF built it", async () => {
    await db
      .update(contentTypes)
      .set({ allowedChannels: ["pdf", "web"] })
      .where(eq(contentTypes.id, "ct_disclosure"));
    const before = await rows();
    expect(
      await env.services.templates.create(maya, {
        teamId: "t_coral",
        contentTypeId: "ct_disclosure",
        draft: {
          name: "x",
          body: { type: "doc", content: [] },
          channelFields: {},
          channels: ["pdf", "email"],
          variables: [],
          sampleSets: [],
          starterKey: null,
        },
      }),
    ).toMatchObject({ ok: false, code: REFUSALS.channelNotAllowed.code });
    expect(await rows()).toEqual(before);
  });
});

// "Edit" on an Active template sometimes did nothing: another write in the server held the file at that moment,
// startDraft's `BEGIN IMMEDIATE` failed with SQLITE_BUSY, and the failure poisoned that pooled connection, so every
// retry failed too (`src/lib/serialized-writes.ts`). The action answered 500 and the page stayed on Active. Writes
// now take turns, so startDraft waits and opens the draft.
describe("startDraft while another write holds the file", () => {
  it("still opens one draft", async () => {
    const [active] = await db
      .select({ templateId: versions.templateId })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .where(and(eq(templates.teamId, "t_coral"), eq(versions.state, "active")))
      .limit(1);
    expect(active, "the seed has an Active Coral template").toBeTruthy();
    const { templateId } = active!;
    const draftsOf = () =>
      db
        .select({ id: versions.id })
        .from(versions)
        .where(
          and(eq(versions.templateId, templateId), eq(versions.state, "draft")),
        );
    expect(await draftsOf()).toHaveLength(0);

    // A write on the simulator's client (its own pool on the same file, as `src/simulator/db.ts` opens it),
    // holding the file across an await as a real command's transaction does.
    const sim = createAppClient({
      url: (await import("@/server/db/client")).DATABASE_URL,
    });
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const other = (async () => {
      const tx = await sim.transaction("write");
      await tx.execute(
        "UPDATE templates SET starter_key = starter_key WHERE id = 'nonexistent'",
      );
      holding();
      await new Promise((resolve) => setTimeout(resolve, 60));
      await tx.commit();
    })();
    await held;

    let result;
    try {
      result = await env.services.templates.startDraft(maya, { templateId });
    } finally {
      await other;
      sim.close();
    }

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(await draftsOf()).toHaveLength(1);
  });
});
