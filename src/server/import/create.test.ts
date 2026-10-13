import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  IMPORT_LIMITS,
  IMPORT_MIME,
  IMPORT_REFUSALS,
  type ImportResponse,
} from "@/domain/import-types";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { DOCUMENT_MESSAGES } from "@/editor/model/document-check";
import { prepareBody } from "@/server/documents/prepare";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import { refusal } from "@/server/services/results";
import { getImportOriginalView } from "@/server/queries/import";
import { importStatus, importTemplate } from "./create";

// Import as the BFF runs it, against the in-memory fake (decision 0068), with real files: the file is sniffed and
// converted, the draft built and prepared for the content type the backend names, and the backend stores it
// (`templates.createImported`). The order of the refusals is the contract's (src/domain/import-types.ts). What the
// backend decides is the contract suite's (src/server/services/contract/templates.ts); what it keeps on disk is
// tested against the local implementation in src/server/services/local/templates.test.ts. The BFF reads no clock:
// this file fails if it does.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("@/server/services/local/clock", () => ({
  now: () => {
    throw new Error("The BFF read the clock.");
  },
}));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`e2e/fixtures/import/${name}`));

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
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

const run = (
  who: string,
  file: { name: string; bytes: Uint8Array } | null,
  teamSlug = "coral-offers",
) => importTemplate(backend.as(who), { teamSlug, file });

function ok(response: ImportResponse) {
  if (!response.ok) throw new Error(`refused: ${response.code}`);
  return response;
}

/** What the BFF handed the backend to store, for the call just made. */
const storing = () => vi.spyOn(services().templates, "createImported");
const sent = (spy: ReturnType<typeof storing>) => spy.mock.calls.at(-1)![1];

describe("importTemplate", () => {
  it("imports a .docx: the converted draft, the original, the report and the Compare HTML go to the backend in one call", async () => {
    const spy = storing();
    const bytes = fixture("spring-offer.docx");
    const res = ok(await run("maya", { name: "../Spring offer.docx", bytes }));
    expect(importStatus(res)).toBe(200);
    expect(res.href).toBe(`/coral-offers/templates/${res.templateId}`);

    const call = sent(spy);
    expect(call).toMatchObject({
      teamId: "t_coral",
      contentTypeId: "ct_disclosure",
      original: {
        filename: "Spring offer.docx",
        mime: IMPORT_MIME.docx,
        bytes,
      },
      report: { kind: "docx", filename: "Spring offer.docx" },
    });
    expect(
      call.compareHtml?.startsWith("<h1>Spring Balance Transfer Offer</h1>"),
    ).toBe(true);
    const { draft } = call;
    expect(draft).toMatchObject({
      name: "Spring Balance Transfer Offer",
      starterKey: null,
    });
    expect(draft.variables).toEqual([
      {
        key: "first_name",
        label: "First name",
        type: "text",
        required: true,
        sample: "",
      },
      {
        key: "purchase_apr",
        label: "Purchase APR",
        type: "text",
        required: true,
        sample: "",
      },
      {
        key: "offer_end_date",
        label: "Offer end date",
        type: "text",
        required: true,
        sample: "",
      },
      {
        key: "annual_fee",
        label: "Annual fee",
        type: "text",
        required: true,
        sample: "",
      },
    ]);
    expect(draft.sampleSets).toHaveLength(3);
    expect(Object.keys(draft.sampleSets[0]!.values)).toEqual([
      "first_name",
      "purchase_apr",
      "offer_end_date",
      "annual_fee",
    ]);
    const ids = draft.body.content!.map((b) => b.attrs?.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(ids.length);

    // And the backend has it: the original comes back as it went in, and the Original tab reads.
    const maya = backend.as("maya");
    expect(
      await services().templates.importOriginal(maya, {
        uploadId: (await spy.mock.results.at(-1)!.value).uploadId,
      }),
    ).toMatchObject({ ok: true, filename: "Spring offer.docx", bytes });
    const view = await getImportOriginalView(
      maya,
      (await spy.mock.results.at(-1)!.value).uploadId,
    );
    expect(view).toMatchObject({
      ok: true,
      view: {
        ref: {
          filename: "Spring offer.docx",
          kind: "docx",
          uploadedByName: "Maya Chen",
        },
        source: { kind: "docx" },
      },
    });
  });

  it("imports a .pdf and a .txt", async () => {
    const spy = storing();
    const pdf = ok(
      await run("maya", {
        name: "rate-change-notice.pdf",
        bytes: fixture("rate-change-notice.pdf"),
      }),
    );
    expect(sent(spy)).toMatchObject({
      draft: { name: "Rate Change Notice" },
      original: { mime: IMPORT_MIME.pdf },
      report: { kind: "pdf", pages: 2 },
      compareHtml: null,
    });
    const txt = ok(
      await run("maya", {
        name: "spring_offer_notes.txt",
        bytes: fixture("spring_offer_notes.txt"),
      }),
    );
    expect(sent(spy)).toMatchObject({
      draft: { name: "Spring offer notes" },
      original: { mime: IMPORT_MIME.txt },
      report: { kind: "txt" },
      compareHtml: null,
    });
    expect(pdf.templateId).not.toBe(txt.templateId);
  });

  it("takes only the channels the content type allows (as New template does)", async () => {
    vi.spyOn(services().templates, "newTemplateType").mockResolvedValue({
      ok: true,
      asOf: BASE.toISOString(),
      contentTypeId: "ct_disclosure",
      requiredSections: [
        { key: "offer_details", title: "Offer details" },
        { key: "rates_and_fees", title: "Rates and fees" },
        { key: "legal_notices", title: "Legal notices" },
      ],
      allowedChannels: ["web", "email"],
    });
    const spy = storing();
    ok(
      await run("maya", {
        name: "spring_offer_notes.txt",
        bytes: fixture("spring_offer_notes.txt"),
      }),
    );
    expect(sent(spy).draft.channels).toEqual(["web"]);
  });

  it("stores the body exactly as an autosave of it would store it", async () => {
    const spy = storing();
    ok(
      await run("maya", {
        name: "Spring offer.docx",
        bytes: fixture("spring-offer.docx"),
      }),
    );
    const { body } = sent(spy).draft;
    expect(prepareBody(body)).toEqual({ ok: true, doc: body });
    expect(JSON.stringify(body)).not.toMatch(/"(?:align|colwidth|type)":null/);
  });

  it("refuses, rather than fails, when no content type makes documents: 409 no_content_type, nothing sent", async () => {
    vi.spyOn(services().templates, "newTemplateType").mockResolvedValue(
      refusal(409, REFUSALS.noContentType("document")),
    );
    const spy = storing();
    const res = await run("maya", {
      name: "notes.txt",
      bytes: fixture("spring_offer_notes.txt"),
    });
    expect(res).toEqual({ ok: false, ...REFUSALS.noContentType("document") });
    expect(importStatus(res)).toBe(409);
    expect(spy).not.toHaveBeenCalled();
  });

  it("checks the permission first: no create rights, a team the viewer can't enter, or an unknown or missing team, is 403 with the reason", async () => {
    const spy = storing();
    const refused = [
      // The auditor sees every team and may create on none; Sam only views Coral Offers.
      ["taylor", "coral-offers", REASONS.generic.code],
      ["sam", "coral-offers", REASONS.generic.code],
      // Maya may not enter Deposits, "nope" is no team, and a missing team arrives empty: all read as no space.
      ["maya", "deposits", "space_unavailable"],
      ["maya", "nope", "space_unavailable"],
      ["maya", "", "space_unavailable"],
      // Riley may enter All teams, which isn't a team to create in.
      ["riley", "all", REQUEST_REFUSALS.teamGone.code],
    ] as const;
    for (const [who, team, code] of refused) {
      const res = await run(
        who,
        { name: "x.doc", bytes: new Uint8Array([0xd0, 0xcf]) },
        team,
      );
      expect(res, `${who} on ${team}`).toMatchObject({ ok: false, code });
      expect(importStatus(res)).toBe(403);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps nobody signed in to 401: the route answers it before the import runs", () => {
    expect(importStatus({ ok: false, ...REQUEST_REFUSALS.signedOut })).toBe(
      401,
    );
  });

  it.each([
    ["empty", { name: "a.txt", bytes: new Uint8Array() }, 400],
    [
      "size",
      {
        name: "a.txt",
        bytes: new Uint8Array(IMPORT_LIMITS.maxBytes + 1).fill(0x61),
      },
      413,
    ],
    [
      "type",
      {
        name: "picture.png",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      415,
    ],
    [
      "legacyDoc",
      {
        name: "old.doc",
        bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      },
      415,
    ],
    [
      "notPdf",
      {
        name: "fake.pdf",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      415,
    ],
    [
      "notWord",
      {
        name: "fake.docx",
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x4e, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      415,
    ],
    ["unreadable", null, 400],
    [
      "tooLong",
      {
        name: "a.txt",
        bytes: new Uint8Array(IMPORT_LIMITS.maxChars + 1).fill(0x61),
      },
      400,
    ],
  ] as const)(
    "refuses %s with its code, sentence and status, sending nothing",
    async (name, file, status) => {
      const spy = storing();
      const res = await run("maya", file);
      expect(res).toEqual({
        ok: false,
        code: IMPORT_REFUSALS[name].code,
        reason: IMPORT_REFUSALS[name].reason,
      });
      expect(importStatus(res)).toBe(status);
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("refuses a document the check refuses (merged cells that overlap), with the check's sentence, sending nothing", async () => {
    // Row 3's two vertically merged cells continue C (row 2, two columns wide) and B (row 1): B then
    // spans rows 1 and 2, over C's second column. Normalization can't fix that without guessing.
    const cell = (text: string, props = "") =>
      `<w:tc><w:tcPr>${props}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const rows = [
      cell("A") + cell("B"),
      cell("C", '<w:gridSpan w:val="2"/>'),
      cell("", "<w:vMerge/>") + cell("", "<w:vMerge/>"),
    ];
    const bytes = await docx(
      `<w:p><w:r><w:t>Fees</w:t></w:r></w:p><w:tbl>${rows.map((r) => `<w:tr>${r}</w:tr>`).join("")}</w:tbl>`,
    );
    const spy = storing();
    const res = await run("maya", { name: "merged.docx", bytes });
    expect(res).toEqual({
      ok: false,
      code: "import_content",
      reason: `This file can't be imported as it is. ${DOCUMENT_MESSAGES.tableShape}`,
    });
    expect(importStatus(res)).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("answers the backend's refusal as the import's own: its code, its sentence, nothing of the read's status", async () => {
    vi.spyOn(services().templates, "createImported").mockResolvedValue({
      ok: false,
      ...REQUEST_REFUSALS.contentTypeGone,
    });
    const res = await run("maya", {
      name: "notes.txt",
      bytes: fixture("spring_offer_notes.txt"),
    });
    expect(res).toEqual({ ok: false, ...REQUEST_REFUSALS.contentTypeGone });
    expect(importStatus(res)).toBe(403);
  });
});
