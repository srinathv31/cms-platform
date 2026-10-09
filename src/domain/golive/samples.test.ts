import { describe, expect, it } from "vitest";
import { API_ERROR_STATUS } from "../golive-types";
import { CHANNELS, type Variable } from "../types";
import { CONSUMER_ERRORS, integrationSamples, RESPONSE_FORMATS, sampleBody, shellQuote } from "./samples";

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "last_name", label: "Last name", type: "text", required: true, sample: "O'Brien" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
  { key: "offer_end_date", label: "Offer end date", type: "date", required: false, sample: "" },
];

const input = (channel: (typeof CHANNELS)[number]) => ({
  origin: "http://localhost:3001/",
  templateId: "UC-4F7K2Q",
  versionNumber: 2,
  channel,
  variables: VARIABLES,
  consumerId: "coral",
});

/** Undoes the curl sample's quoting of the --data-raw argument. */
function dataRawOf(curl: string): string {
  const match = /--data-raw '([\s\S]*?)'(?: \\\n|$)/.exec(curl.replace(/'\\''/g, "\u0000"));
  return match![1]!.replace(/\u0000/g, "'");
}

describe("sampleBody", () => {
  it("is the version, the channel and every variable's sample (blank → the type's example)", () => {
    expect(sampleBody(2, "web", VARIABLES)).toEqual({
      version: 2,
      channel: "web",
      values: { first_name: "Maya", last_name: "O'Brien", purchase_apr: "21.99", offer_end_date: "2027-03-04" },
    });
  });
});

describe("integrationSamples: curl", () => {
  it("POSTs pretty JSON with the consumer header, and writes the PDF to a file", () => {
    const { curl } = integrationSamples(input("pdf"));
    const lines = curl.split(" \\\n");
    expect(lines[0]).toBe("curl -X POST 'http://localhost:3001/api/v1/templates/UC-4F7K2Q/render'");
    expect(lines[1]).toBe("  -H 'Content-Type: application/json'");
    expect(lines[2]).toBe("  -H 'X-Consumer-Id: coral'");
    expect(lines[3]).toMatch(/^ {2}--data-raw '\{\n {2}"version": 2,/);
    expect(lines.at(-1)).toBe("  --output 'UC-4F7K2Q-v2.pdf'");
    expect(JSON.parse(dataRawOf(curl))).toEqual(sampleBody(2, "pdf", VARIABLES));
  });

  it("web and email print to stdout", () => {
    for (const channel of ["web", "email"] as const) {
      const { curl } = integrationSamples(input(channel));
      expect(curl).not.toContain("--output");
      expect(JSON.parse(dataRawOf(curl))).toMatchObject({ channel });
    }
  });

  it("quotes single quotes for the shell", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(integrationSamples(input("web")).curl).toContain(`"last_name": "O'\\''Brien"`);
  });
});

describe("integrationSamples: fetch", () => {
  it("sends the same body and reads the result by channel", () => {
    const pdf = integrationSamples(input("pdf")).fetch;
    expect(pdf.split("\n")[0]).toBe('const res = await fetch("http://localhost:3001/api/v1/templates/UC-4F7K2Q/render", {');
    expect(pdf).toContain('"X-Consumer-Id": "coral",');
    expect(pdf).toContain("if (!res.ok) throw new Error((await res.json()).error.message);");
    expect(pdf.endsWith("const pdf = new Uint8Array(await res.arrayBuffer());")).toBe(true);
    expect(integrationSamples(input("web")).fetch.endsWith("const html = await res.text();")).toBe(true);
    expect(integrationSamples(input("email")).fetch.endsWith("const { subject, preheader, html, text } = await res.json();")).toBe(true);

    const body = /body: JSON\.stringify\(([\s\S]*?)\),\n\}\);/.exec(pdf)![1]!;
    expect(JSON.parse(body)).toEqual(sampleBody(2, "pdf", VARIABLES));
  });

  it("is syntactically valid JavaScript", () => {
    for (const channel of CHANNELS) {
      const code = integrationSamples(input(channel)).fetch;
      expect(() => new Function(`return (async () => {\n${code}\n});`)).not.toThrow();
    }
  });
});

describe("RESPONSE_FORMATS and CONSUMER_ERRORS", () => {
  it("covers every channel and the base64 opt-in, with JSON examples that parse", () => {
    expect(RESPONSE_FORMATS.map((f) => f.channel)).toEqual([...CHANNELS, "base64"]);
    for (const format of RESPONSE_FORMATS) {
      expect(format.body).toMatch(/\.$/);
      if (format.example !== null) expect(() => JSON.parse(format.example!)).not.toThrow();
    }
    expect(RESPONSE_FORMATS.find((f) => f.channel === "pdf")).toMatchObject({ contentType: "application/pdf", example: null });
  });

  it("lists the errors with the contract's statuses: 410s, 422s and 404s", () => {
    for (const e of CONSUMER_ERRORS) expect(e.status).toBe(API_ERROR_STATUS[e.code]);
    expect(new Set(CONSUMER_ERRORS.map((e) => e.status))).toEqual(new Set([410, 422, 404]));
    expect(CONSUMER_ERRORS.map((e) => e.code)).toEqual(expect.arrayContaining(["version_sunset", "version_revoked", "missing_variables", "invalid_values", "template_not_found"]));
  });

  it("says what to do when no version is Active, as after the Active version is revoked", () => {
    for (const code of ["version_sunset", "version_revoked"]) {
      expect(CONSUMER_ERRORS.find((e) => e.code === code)?.when).toMatch(/Move to the Active version, or wait for a new one if none is Active\.$/);
    }
  });
});
