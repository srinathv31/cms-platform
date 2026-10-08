import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IMPORT_LIMITS, IMPORT_REFUSALS, type ImportResponse } from "@/domain/import-types";
import { REASONS } from "@/domain/permissions";
import { DOCUMENT_MESSAGES } from "@/editor/model/document-check";
import { prepareBody } from "@/server/documents/prepare";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { getImportOriginalFile, getImportOriginalRef, getImportOriginalView } from "@/server/queries/import";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { importStatus, importTemplate } from "./create";

// importTemplate and the import queries end to end against a temporary database filled by the real
// seed, with uploads written to a temporary folder. Only the database handle and the clock are swapped.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-import-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));

const { auditEvents, contentTypes, templates, uploads, versions } = schema;

let db: Db;
let libsql: Client;
let root: string;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: env.now });
  for (const id of ["maya", "taylor", "morgan", "sam"]) people[id] = await loadPersona(db, id);
  root = mkdtempSync(join(tmpdir(), "ucomp-uploads-"));
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

const fixture = (name: string) => new Uint8Array(readFileSync(`e2e/fixtures/import/${name}`));

/** A minimal .docx whose body is `bodyXml` (WordprocessingML). */
async function docx(bodyXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
const run = (who: string, file: { name: string; bytes: Uint8Array } | null, teamSlug = "coral-offers") =>
  importTemplate(people[who]!, { teamSlug, file }, { uploadsRoot: root });

function ok(response: ImportResponse) {
  if (!response.ok) throw new Error(`refused: ${response.code}`);
  return response;
}

describe("importTemplate", () => {
  it("imports a .docx: the template, its draft, the upload row, the files and the audit event, in one go", async () => {
    const res = ok(await run("maya", { name: "../Spring offer.docx", bytes: fixture("spring-offer.docx") }));
    expect(res.href).toBe(`/coral-offers/templates/${res.templateId}`);
    expect(importStatus(res)).toBe(200);

    const tpl = await db.query.templates.findFirst({ where: eq(templates.id, res.templateId) });
    expect(tpl).toMatchObject({ name: "Spring Balance Transfer Offer", teamId: "coral-offers", starterKey: null, createdBy: "maya" });

    const draft = await db.query.versions.findFirst({ where: eq(versions.templateId, res.templateId) });
    expect(draft?.state).toBe("draft");
    expect(draft?.variables).toEqual([
      { key: "first_name", label: "First name", type: "text", required: true, sample: "" },
      { key: "purchase_apr", label: "Purchase APR", type: "text", required: true, sample: "" },
      { key: "offer_end_date", label: "Offer end date", type: "text", required: true, sample: "" },
      { key: "annual_fee", label: "Annual fee", type: "text", required: true, sample: "" },
    ]);
    expect(draft?.sampleSets).toHaveLength(3);
    expect(Object.keys(draft!.sampleSets[0]!.values)).toEqual(["first_name", "purchase_apr", "offer_end_date", "annual_fee"]);
    const ids = draft!.body.content!.map((b) => b.attrs?.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const upload = await db.query.uploads.findFirst({ where: eq(uploads.templateId, res.templateId) });
    expect(upload).toMatchObject({
      filename: "Spring offer.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: fixture("spring-offer.docx").length,
      createdBy: "maya",
    });
    expect(upload!.id).toMatch(/^up_[0-9a-z]{10}$/);
    expect(upload!.path).toBe(`${upload!.id}/original.docx`);
    expect(draft?.importUploadId).toBe(upload!.id);
    expect(readdirSync(join(root, upload!.id)).sort()).toEqual(["compare.html", "original.docx", "report.json"]);

    const audit = await db.query.auditEvents.findFirst({ where: eq(auditEvents.templateId, res.templateId) });
    expect(audit).toMatchObject({
      action: "template.created",
      actorId: "maya",
      details: { name: "Spring Balance Transfer Offer", source: "import:docx", filename: "Spring offer.docx" },
    });
  });

  it("imports a .pdf and a .txt", async () => {
    const pdf = ok(await run("maya", { name: "rate-change-notice.pdf", bytes: fixture("rate-change-notice.pdf") }));
    const txt = ok(await run("maya", { name: "spring_offer_notes.txt", bytes: fixture("spring_offer_notes.txt") }));
    const names = await Promise.all(
      [pdf, txt].map((r) => db.query.templates.findFirst({ where: eq(templates.id, r.templateId) }).then((t) => t?.name)),
    );
    expect(names).toEqual(["Rate Change Notice", "Spring offer notes"]);
  });

  it("takes only the channels the content type allows (as New template does)", async () => {
    const disclosure = await db.query.contentTypes.findFirst({ where: eq(contentTypes.key, "disclosure") });
    await db.update(contentTypes).set({ allowedChannels: ["web", "email"] }).where(eq(contentTypes.id, disclosure!.id));
    try {
      const res = ok(await run("maya", { name: "spring_offer_notes.txt", bytes: fixture("spring_offer_notes.txt") }));
      const draft = await db.query.versions.findFirst({ where: eq(versions.templateId, res.templateId) });
      expect(draft?.channels).toEqual(["web"]);
    } finally {
      await db.update(contentTypes).set({ allowedChannels: disclosure!.allowedChannels }).where(eq(contentTypes.id, disclosure!.id));
    }
  });

  it("checks the permission first: no create rights, or an unknown team, is 403 with the reason", async () => {
    for (const [who, team] of [["taylor", "coral-offers"], ["sam", "coral-offers"], ["maya", "nope"], ["maya", ""]] as const) {
      const res = await run(who, { name: "x.doc", bytes: new Uint8Array([0xd0, 0xcf]) }, team);
      expect(res).toEqual({ ok: false, code: "permission", reason: REASONS.generic });
      expect(importStatus(res)).toBe(403);
    }
  });

  it.each([
    ["empty", { name: "a.txt", bytes: new Uint8Array() }, 400],
    ["size", { name: "a.txt", bytes: new Uint8Array(IMPORT_LIMITS.maxBytes + 1).fill(0x61) }, 413],
    ["type", { name: "picture.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }, 415],
    ["legacyDoc", { name: "old.doc", bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) }, 415],
    ["notPdf", { name: "fake.pdf", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }, 415],
    ["notWord", { name: "fake.docx", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x4e, 0x0d, 0x0a, 0x1a, 0x0a]) }, 415],
    ["unreadable", null, 400],
    ["tooLong", { name: "a.txt", bytes: new Uint8Array(IMPORT_LIMITS.maxChars + 1).fill(0x61) }, 400],
  ] as const)("refuses %s with its sentence and status, writing nothing", async (code, file, status) => {
    const before = await db.select().from(templates);
    const folders = readdirSync(root).length;
    const res = await run("maya", file);
    expect(res).toEqual({ ok: false, code, reason: IMPORT_REFUSALS[code] });
    expect(importStatus(res)).toBe(status);
    expect(await db.select().from(templates)).toHaveLength(before.length);
    expect(readdirSync(root)).toHaveLength(folders);
  });

  it("refuses a document the check refuses (merged cells that overlap), with the check's sentence, writing nothing", async () => {
    // Row 3's two vertically merged cells continue C (row 2, two columns wide) and B (row 1): B then
    // spans rows 1 and 2, over C's second column. Normalization can't fix that without guessing.
    const cell = (text: string, props = "") => `<w:tc><w:tcPr>${props}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const rows = [
      cell("A") + cell("B"),
      cell("C", '<w:gridSpan w:val="2"/>'),
      cell("", "<w:vMerge/>") + cell("", "<w:vMerge/>"),
    ];
    const bytes = await docx(`<w:p><w:r><w:t>Fees</w:t></w:r></w:p><w:tbl>${rows.map((r) => `<w:tr>${r}</w:tr>`).join("")}</w:tbl>`);
    const before = await db.select().from(templates);
    const folders = readdirSync(root).length;
    const res = await run("maya", { name: "merged.docx", bytes });
    expect(res).toEqual({ ok: false, code: "content", reason: `${IMPORT_REFUSALS.content} ${DOCUMENT_MESSAGES.tableShape}` });
    expect(importStatus(res)).toBe(400);
    expect(await db.select().from(templates)).toHaveLength(before.length);
    expect(readdirSync(root)).toHaveLength(folders);
  });

  it("stores the body exactly as an autosave of it would store it", async () => {
    const res = ok(await run("maya", { name: "Spring offer.docx", bytes: fixture("spring-offer.docx") }));
    const draft = await db.query.versions.findFirst({ where: eq(versions.templateId, res.templateId) });
    expect(prepareBody(draft!.body)).toEqual({ ok: true, doc: draft!.body });
    expect(JSON.stringify(draft!.body)).not.toMatch(/"(?:align|colwidth|type)":null/);
  });

  it("removes the upload's folder when the transaction fails", async () => {
    const folders = readdirSync(root).sort();
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("disk full"));
    await expect(run("maya", { name: "a.txt", bytes: fixture("spring_offer_notes.txt") })).rejects.toThrow("disk full");
    spy.mockRestore();
    expect(readdirSync(root).sort()).toEqual(folders);
  });
});

describe("import queries", () => {
  let docx: string;
  let pdf: string;
  let txt: string;
  const uploadOf = async (templateId: string) => (await getImportOriginalRef(templateId))!.uploadId;

  beforeAll(async () => {
    env.now = new Date("2026-10-04T13:00:00.000Z");
    docx = ok(await run("maya", { name: "Spring offer.docx", bytes: fixture("spring-offer.docx") })).templateId;
    pdf = ok(await run("maya", { name: "rate-change-notice.pdf", bytes: fixture("rate-change-notice.pdf") })).templateId;
    txt = ok(await run("maya", { name: "notes.txt", bytes: fixture("spring_offer_notes.txt") })).templateId;
  });

  it("getImportOriginalRef: the cheap ref for the workspace, null for a template that wasn't imported", async () => {
    expect(await getImportOriginalRef(docx)).toEqual({
      uploadId: expect.stringMatching(/^up_/),
      filename: "Spring offer.docx",
      kind: "docx",
      size: fixture("spring-offer.docx").length,
      uploadedAt: "2026-10-04T13:00:00.000Z",
      uploadedByName: "Maya Chen",
    });
    const seeded = await db.query.templates.findFirst();
    expect(await getImportOriginalRef(seeded!.id)).toBeNull();
  });

  it("getImportOriginalView: the source for each kind, the report and its lines", async () => {
    const maya = people.maya!;
    const d = await getImportOriginalView(maya, await uploadOf(docx), root);
    expect(d?.source.kind).toBe("docx");
    expect(d?.source.kind === "docx" && d.source.html.startsWith("<h1>Spring Balance Transfer Offer</h1>")).toBe(true);
    expect(d?.lines.detected[0]).toBe("4 variables, all Text and required: First name, Purchase APR, Offer end date, Annual fee");

    const pId = await uploadOf(pdf);
    expect((await getImportOriginalView(maya, pId, root))?.source).toEqual({ kind: "pdf", fileUrl: `/api/imports/${pId}/file`, pages: 2 });

    const t = await getImportOriginalView(maya, await uploadOf(txt), root);
    expect(t?.source).toEqual({ kind: "txt", text: readFileSync("e2e/fixtures/import/spring_offer_notes.txt", "utf8") });
    expect(t?.report.nameFrom).toBe("filename");
  });

  it("getImportOriginalFile: the bytes as uploaded", async () => {
    const file = await getImportOriginalFile(people.maya!, await uploadOf(pdf), root);
    expect(file?.ref.kind).toBe("pdf");
    expect(Buffer.from(file!.bytes).equals(Buffer.from(fixture("rate-change-notice.pdf")))).toBe(true);
  });

  it("nothing for a viewer who can't see the team, an unknown id, or a malformed one", async () => {
    const id = await uploadOf(docx);
    expect(await getImportOriginalView(people.morgan!, id, root)).toBeNull();
    expect(await getImportOriginalFile(people.morgan!, id, root)).toBeNull();
    expect(await getImportOriginalView(people.taylor!, id, root)).not.toBeNull(); // the auditor sees every team
    expect(await getImportOriginalView(people.maya!, "up_0000000000", root)).toBeNull();
    expect(await getImportOriginalFile(people.maya!, "../../etc", root)).toBeNull();
  });

  it("an upload whose files are gone reads as missing, not as an error", async () => {
    const id = await uploadOf(txt);
    rmSync(join(root, id), { recursive: true });
    expect(existsSync(join(root, id))).toBe(false);
    expect(await getImportOriginalView(people.maya!, id, root)).toBeNull();
    expect(await getImportOriginalFile(people.maya!, id, root)).toBeNull();
  });
});
