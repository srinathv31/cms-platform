import { rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import type { Client } from "@libsql/client";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { readFileSync } from "node:fs";
import { asPersona, openDb } from "./helpers";

// The import API (Phase 7a): POST /api/imports with each kind of file, the refusals, the permission
// check, and the two read routes (the original's bytes and the Original tab's view), called the way
// the Library's import row calls them. The generated fixtures live in e2e/fixtures/import
// (make-fixtures.mjs). Every template this spec creates is deleted again at the end (rows only; the
// upload folders it made are removed too).

const FIXTURES = path.join(process.cwd(), "e2e", "fixtures", "import");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));

const REFUSALS = {
  legacyDoc: "Only .docx, .pdf and .txt files can be imported. Save it as .docx first.",
  size: "This file is larger than 10 MB.",
  empty: "This file is empty.",
} as const;

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
} as const;

interface Imported {
  ok: true;
  templateId: string;
  href: string;
}

let db: Client;
const created: string[] = [];

test.beforeAll(() => {
  db = openDb();
});

test.afterAll(async () => {
  for (const id of created) {
    const { rows } = await db.execute({ sql: "SELECT id FROM uploads WHERE template_id = ?", args: [id] });
    for (const row of rows) await rm(path.join(process.cwd(), "data", "uploads", String(row.id)), { recursive: true, force: true });
    for (const table of ["uploads", "audit_events", "versions"]) {
      await db.execute({ sql: `DELETE FROM ${table} WHERE template_id = ?`, args: [id] });
    }
    await db.execute({ sql: "DELETE FROM templates WHERE id = ?", args: [id] });
  }
  db.close();
});

function upload(request: APIRequestContext, file: { name: string; mimeType: string; buffer: Buffer }, team = "coral-offers") {
  return request.post(`/api/imports?team=${team}`, { multipart: { file } });
}

async function expectRefusal(res: APIResponse, status: number, code: string, reason: string) {
  expect(res.status(), `status for ${code}`).toBe(status);
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(await res.json()).toEqual({ ok: false, code, reason });
}

async function imported(res: APIResponse): Promise<Imported> {
  expect(res.status()).toBe(200);
  const body = (await res.json()) as Imported;
  expect(body).toEqual({ ok: true, templateId: expect.stringMatching(/^UC-[0-9A-Z]{6}$/), href: `/coral-offers/templates/${body.templateId}` });
  created.push(body.templateId);
  // The one-shot cookies: the name is selected and the rail opens on Original on arrival.
  const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
  expect(cookies.some((c) => c.startsWith(`ucomp_created=${body.templateId}`))).toBe(true);
  expect(cookies.some((c) => c.startsWith(`ucomp_imported=${body.templateId}`))).toBe(true);
  return body;
}

async function rowsFor(templateId: string) {
  const template = (await db.execute({ sql: "SELECT starter_key FROM templates WHERE id = ?", args: [templateId] })).rows[0];
  const version = (await db.execute({ sql: "SELECT name, body, variables, import_upload_id FROM versions WHERE template_id = ?", args: [templateId] })).rows[0];
  const upload = (await db.execute({ sql: "SELECT id, filename, mime, path FROM uploads WHERE template_id = ?", args: [templateId] })).rows[0];
  return {
    name: String(version?.name),
    starterKey: template?.starter_key ?? null,
    body: JSON.stringify(JSON.parse(String(version?.body))),
    variables: (JSON.parse(String(version?.variables)) as { key: string; type: string; required: boolean }[]),
    importUploadId: String(version?.import_upload_id),
    upload: { id: String(upload?.id), filename: String(upload?.filename), mime: String(upload?.mime), path: String(upload?.path) },
  };
}

test.describe("POST /api/imports", () => {
  test("a .docx becomes a draft: title as name, chips, the table, sections; the view and the file read back", async ({ playwright, baseURL }) => {
    await asPersona(playwright, baseURL!, "maya", async (request) => {
      const bytes = fixture("spring-offer.docx");
      const res = await imported(await upload(request, { name: "Spring offer.docx", mimeType: MIME.docx, buffer: bytes }));
      const rows = await rowsFor(res.templateId);

      expect(rows.name).toBe("Spring Balance Transfer Offer");
      expect(rows.starterKey).toBeNull();
      expect(rows.variables.map((v) => [v.key, v.type, v.required])).toEqual([
        ["first_name", "text", true],
        ["purchase_apr", "text", true],
        ["offer_end_date", "text", true],
        ["annual_fee", "text", true],
      ]);
      expect(rows.body).toContain('{"type":"variable","attrs":{"key":"first_name"}}');
      expect(rows.body).toContain('"type":"tableHeader"');
      expect(rows.body).toContain('"requiredKey":"legal_notices"');
      expect(rows.body).toContain("{{#if member}}");
      expect(rows.upload).toEqual({ id: rows.importUploadId, filename: "Spring offer.docx", mime: MIME.docx, path: `${rows.importUploadId}/original.docx` });

      const view = await request.get(`/api/imports/${rows.upload.id}/view`);
      expect(view.status()).toBe(200);
      const json = await view.json();
      expect(json.ref).toMatchObject({ uploadId: rows.upload.id, filename: "Spring offer.docx", kind: "docx", size: bytes.length, uploadedByName: "Maya Chen" });
      expect(json.source.kind).toBe("docx");
      expect(json.source.html).toContain("<table>");
      expect(json.source.html).toContain('<img src="data:image/png;base64,');
      expect(json.lines).toEqual({
        detected: ["4 variables, all Text and required: First name, Purchase APR, Offer end date, Annual fee", "1 table", "Added empty section: Legal notices"],
        dropped: ["1 image (still shown in Original)", "1 comment", "Headers and footers", "Quote formatting"],
        kept: ["{{#if member}} … {{/if}} shows to customers as written."],
      });

      const file = await request.get(`/api/imports/${rows.upload.id}/file`);
      expect(file.status()).toBe(200);
      expect(file.headers()["content-type"]).toBe(MIME.docx);
      expect(file.headers()["content-disposition"]).toBe("inline; filename*=UTF-8''Spring%20offer.docx");
      expect(file.headers()["cache-control"]).toBe("private, no-store");
      expect(Buffer.compare(await file.body(), bytes)).toBe(0);
    });
  });

  test("a .pdf becomes a draft: pdf.js reads it on the server; the view points at the file", async ({ playwright, baseURL }) => {
    await asPersona(playwright, baseURL!, "maya", async (request) => {
      const bytes = fixture("rate-change-notice.pdf");
      const res = await imported(await upload(request, { name: "rate-change-notice.pdf", mimeType: MIME.pdf, buffer: bytes }));
      const rows = await rowsFor(res.templateId);

      expect(rows.name).toBe("Rate Change Notice");
      expect(rows.variables.map((v) => v.key)).toEqual(["first_name", "effective_date", "purchase_apr", "balance_transfer_apr", "cash_apr", "annual_fee"]);
      expect(rows.body).toContain('"type":"bulletList"');
      expect(rows.body).not.toContain("Page 1 of 2");

      const json = await (await request.get(`/api/imports/${rows.upload.id}/view`)).json();
      expect(json.source).toEqual({ kind: "pdf", fileUrl: `/api/imports/${rows.upload.id}/file`, pages: 2 });
      expect(json.lines.dropped).toContain("2 repeated header or footer lines");

      const file = await request.get(json.source.fileUrl);
      expect(file.headers()["content-type"]).toBe(MIME.pdf);
      expect(Buffer.compare(await file.body(), bytes)).toBe(0);
    });
  });

  test("a .txt becomes a draft named from the file, with every section added", async ({ playwright, baseURL }) => {
    await asPersona(playwright, baseURL!, "maya", async (request) => {
      const bytes = fixture("spring_offer_notes.txt");
      const res = await imported(await upload(request, { name: "spring_offer_notes.txt", mimeType: "text/plain", buffer: bytes }));
      const rows = await rowsFor(res.templateId);
      expect(rows.name).toBe("Spring offer notes");
      expect(rows.variables.map((v) => v.key)).toEqual(["first_name", "purchase_apr", "effective_date"]);

      const json = await (await request.get(`/api/imports/${rows.upload.id}/view`)).json();
      expect(json.source).toEqual({ kind: "txt", text: bytes.toString("utf8") });
      expect(json.lines.detected).toEqual([
        "3 variables, all Text and required: First name, Purchase APR, Effective date",
        "Added empty sections: Offer details, Rates and fees and Legal notices",
        "The text stays above the first section",
      ]);
      expect((await request.get(`/api/imports/${rows.upload.id}/file`)).headers()["content-type"]).toBe(MIME.txt);
    });
  });

  test("refuses a legacy .doc (415), an empty file (400) and a file over 10 MB (413)", async ({ playwright, baseURL }) => {
    await asPersona(playwright, baseURL!, "maya", async (request) => {
      const doc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
      await expectRefusal(await upload(request, { name: "old.doc", mimeType: "application/msword", buffer: doc }), 415, "legacyDoc", REFUSALS.legacyDoc);
      await expectRefusal(await upload(request, { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) }), 400, "empty", REFUSALS.empty);
      const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
      await expectRefusal(await upload(request, { name: "big.txt", mimeType: "text/plain", buffer: big }), 413, "size", REFUSALS.size);
    });
  });

  test("a chunked upload with no Content-Length: refused before the body for no permission (403), and once it passes 10 MB (413)", async ({ baseURL }) => {
    /** POSTs `megabytes` of a multipart body in 1 MB chunks (Transfer-Encoding: chunked); stops when the answer comes. */
    const chunked = (persona: string, megabytes: number) =>
      new Promise<{ status: number; body: string; sentMb: number }>((resolve, reject) => {
        const url = new URL("/api/imports?team=coral-offers", baseURL);
        const boundary = "----ucomp-chunked";
        const req = httpRequest(url, {
          method: "POST",
          headers: { Cookie: `ucomp_persona=${persona}`, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Transfer-Encoding": "chunked" },
        });
        let sentMb = 0;
        let answered = false;
        req.on("response", (res) => {
          answered = true;
          let body = "";
          res.on("data", (d: Buffer) => (body += d.toString()));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, sentMb }));
        });
        req.on("error", (error) => (answered ? undefined : reject(error)));
        req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.txt"\r\nContent-Type: text/plain\r\n\r\n`);
        const chunk = Buffer.alloc(1024 * 1024, 0x61);
        const pump = () => {
          if (answered) return req.destroy();
          if (sentMb >= megabytes) return req.end(`\r\n--${boundary}--\r\n`);
          sentMb += 1;
          if (req.write(chunk)) setImmediate(pump);
          else req.once("drain", pump);
        };
        pump();
      });

    const taylor = await chunked("taylor", 64);
    expect(taylor.status).toBe(403);
    expect(JSON.parse(taylor.body)).toMatchObject({ ok: false, code: "permission" });
    expect(taylor.sentMb).toBeLessThan(64);

    const maya = await chunked("maya", 64);
    expect(maya.status).toBe(413);
    expect(JSON.parse(maya.body)).toEqual({ ok: false, code: "size", reason: REFUSALS.size });
    expect(maya.sentMb).toBeLessThan(64);
  });

  test("a viewer without create rights gets 403; who can't see the team gets 404 on the reads", async ({ playwright, baseURL }) => {
    const bytes = fixture("spring_offer_notes.txt");
    await asPersona(playwright, baseURL!, "taylor", async (request) => {
      await expectRefusal(
        await upload(request, { name: "notes.txt", mimeType: "text/plain", buffer: bytes }),
        403,
        "permission",
        "You don't have access to do this.",
      );
    });

    const uploadId = await asPersona(playwright, baseURL!, "maya", async (request) => {
      const res = await imported(await upload(request, { name: "notes.txt", mimeType: "text/plain", buffer: bytes }));
      return (await rowsFor(res.templateId)).upload.id;
    });
    await asPersona(playwright, baseURL!, "morgan", async (request) => {
      expect((await request.get(`/api/imports/${uploadId}/view`)).status()).toBe(404);
      expect((await request.get(`/api/imports/${uploadId}/file`)).status()).toBe(404);
    });
    await asPersona(playwright, baseURL!, "taylor", async (request) => {
      expect((await request.get(`/api/imports/${uploadId}/view`)).status()).toBe(200);
    });
  });
});
