import { describe, expect, it } from "vitest";
import type { JSONContent } from "@/domain/types";
import { MAX_BODY_SIZE, docProblem, normalizeName, parseDraftPatch, parseDraftPatchText } from "./parse-patch";

const base = { rev: 4, sessionKey: "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21" };
const doc: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "Hi", marks: [{ type: "bold" }] }] }],
};
const variable = { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" };

const ok = (input: unknown) => {
  const result = parseDraftPatch(input);
  if (!result.ok) throw new Error(result.message);
  return result.patch;
};
const message = (input: unknown) => {
  const result = parseDraftPatch(input);
  if (result.ok) throw new Error("expected a failure");
  return result.message;
};

describe("normalizeName", () => {
  it("trims", () => expect(normalizeName("  Annual fee  ")).toBe("Annual fee"));
  it("refuses empty and whitespace-only", () => {
    expect(normalizeName("")).toBeNull();
    expect(normalizeName("   \n ")).toBeNull();
  });
  it("allows exactly 120 characters and refuses 121", () => {
    expect(normalizeName("a".repeat(120))).toHaveLength(120);
    expect(normalizeName("a".repeat(121))).toBeNull();
  });
  it("counts an emoji as one character", () => {
    expect(normalizeName("😀".repeat(120))).not.toBeNull();
    expect(normalizeName("😀".repeat(121))).toBeNull();
  });
  it("counts the length after trimming", () => expect(normalizeName(` ${"a".repeat(120)} `)).toHaveLength(120));
});

describe("docProblem", () => {
  it("accepts an empty document and a nested one", () => {
    expect(docProblem({ type: "doc" })).toBeNull();
    expect(docProblem(doc)).toBeNull();
  });

  it("refuses things that are not documents", () => {
    for (const value of [null, "doc", [], 4, { type: "paragraph" }, { content: [] }]) {
      expect(docProblem(value)).not.toBeNull();
    }
  });

  it("refuses malformed nodes", () => {
    expect(docProblem({ type: "doc", content: "x" })).not.toBeNull();
    expect(docProblem({ type: "doc", content: [null] })).not.toBeNull();
    expect(docProblem({ type: "doc", content: [{ attrs: {} }] })).not.toBeNull();
    expect(docProblem({ type: "doc", content: [{ type: "paragraph", attrs: [] }] })).not.toBeNull();
    expect(docProblem({ type: "doc", content: [{ type: "text", text: 4 }] })).not.toBeNull();
    expect(docProblem({ type: "doc", content: [{ type: "text", text: "a", marks: [{}] }] })).not.toBeNull();
  });

  it("refuses a document nested too deeply, without overflowing the stack", () => {
    let deep: JSONContent = { type: "paragraph" };
    for (let i = 0; i < 5000; i++) deep = { type: "blockquote", content: [deep] };
    expect(docProblem({ type: "doc", content: [deep] })).toBe("is nested too deeply");
  });

  it("refuses a document with too many nodes", () => {
    const content = Array.from({ length: 100_001 }, () => ({ type: "horizontalRule" }));
    expect(docProblem({ type: "doc", content })).toBe("has too many nodes");
  });
});

describe("parseDraftPatch", () => {
  it("accepts each field on its own", () => {
    expect(ok({ ...base, body: doc }).body).toBe(doc);
    expect(ok({ ...base, variables: [variable] }).variables).toEqual([variable]);
    expect(ok({ ...base, channels: ["pdf", "email"] }).channels).toEqual(["pdf", "email"]);
    expect(ok({ ...base, sampleSets: [{ id: "s1", name: "Maya", values: { first_name: "Maya", n: 3 } }] }).sampleSets).toHaveLength(1);
    expect(ok({ ...base, "email.subject": doc })["email.subject"]).toBe(doc);
  });

  it("accepts null to clear the email subject and preheader", () => {
    const patch = ok({ ...base, "email.subject": null, "email.preheader": null });
    expect(patch["email.subject"]).toBeNull();
    expect(patch["email.preheader"]).toBeNull();
  });

  it("takes a channel field only by an id the registry has", () => {
    expect(message({ ...base, "email.footer": doc })).toMatch(/email\.footer/);
    expect(message({ ...base, emailSubject: doc })).toMatch(/emailSubject/);
  });

  it("trims the name", () => expect(ok({ ...base, name: "  New name " }).name).toBe("New name"));

  it("accepts an empty channel list (a draft can be mid-edit)", () => expect(ok({ ...base, channels: [] }).channels).toEqual([]));

  it("refuses a patch that changes nothing", () => expect(message(base)).toBe("Nothing to save."));

  it("refuses a bad rev", () => {
    for (const rev of [-1, 1.5, "3", null, undefined, NaN]) expect(message({ ...base, rev, body: doc })).toMatch(/^rev /);
  });

  it("refuses a missing or odd session key", () => {
    for (const sessionKey of [undefined, "", "short", "has spaces in it!", "x".repeat(65), 12]) {
      expect(message({ ...base, sessionKey, body: doc })).toMatch(/^sessionKey /);
    }
  });

  it("refuses unknown fields", () => expect(message({ ...base, body: doc, state: "active" })).toMatch(/state|unrecognized/i));

  it("refuses an empty or oversize name", () => {
    expect(message({ ...base, name: "  " })).toBe("The name must be 1 to 120 characters.");
    expect(message({ ...base, name: "x".repeat(121) })).toBe("The name must be 1 to 120 characters.");
    expect(message({ ...base, name: 5 })).toBe("The name must be 1 to 120 characters.");
  });

  it("refuses a bad body", () => {
    expect(message({ ...base, body: { type: "paragraph" } })).toMatch(/^body /);
    expect(message({ ...base, body: null })).toMatch(/^body /);
  });

  it("refuses variables with a bad key, type or shape", () => {
    expect(message({ ...base, variables: [{ ...variable, key: "First Name" }] })).toMatch(/^variables\.0\.key /);
    expect(message({ ...base, variables: [{ ...variable, type: "money" }] })).toMatch(/^variables\.0\.type /);
    expect(message({ ...base, variables: [{ ...variable, required: "yes" }] })).toMatch(/^variables\.0\.required /);
    expect(message({ ...base, variables: [{ ...variable, extra: 1 }] })).toMatch(/^variables\.0/);
    expect(message({ ...base, variables: "x" })).toMatch(/^variables /);
  });

  it("keeps a variable's id: a fresh one, or the key it had before a rename", () => {
    const created = { ...variable, key: "promo_code", id: "0b6f4c1e-5a7d-4e8b-9c2f-3d1a6e7b8c90" };
    const renamed = { ...variable, key: "given_name", id: "first_name" };
    expect(ok({ ...base, variables: [renamed, created] }).variables).toEqual([renamed, created]);
    expect(message({ ...base, variables: [{ ...variable, id: "" }] })).toMatch(/^variables\.0\.id /);
    expect(message({ ...base, variables: [{ ...variable, id: "a b" }] })).toMatch(/^variables\.0\.id /);
    expect(message({ ...base, variables: [{ ...variable, id: 7 }] })).toMatch(/^variables\.0\.id /);
  });

  it("refuses two variables that are one to the contract diff", () => {
    // `first_name` with no id is the variable `first_name`, and so is the renamed one.
    const renamed = { ...variable, key: "given_name", id: variable.key };
    expect(message({ ...base, variables: [variable, renamed] })).toMatch(/repeated variable id/);
    expect(message({ ...base, variables: [{ ...renamed, key: "a" }, renamed] })).toMatch(/repeated variable id/);
  });

  it("refuses repeated variable keys and sample set ids", () => {
    expect(message({ ...base, variables: [variable, variable] })).toMatch(/repeated key/);
    const set = { id: "s1", name: "A", values: {} };
    expect(message({ ...base, sampleSets: [set, set] })).toMatch(/repeated id/);
  });

  it("refuses unknown or repeated channels", () => {
    expect(message({ ...base, channels: ["fax"] })).toMatch(/^channels\b/);
    expect(message({ ...base, channels: ["pdf", "pdf"] })).toMatch(/repeated channel/);
  });

  it("refuses non-finite sample values", () => {
    expect(message({ ...base, sampleSets: [{ id: "s1", name: "A", values: { n: Infinity } }] })).toMatch(/^sampleSets\b/);
    expect(message({ ...base, sampleSets: [{ id: "s1", name: "A", values: { n: null } }] })).toMatch(/^sampleSets\b/);
  });

  it("refuses a body that is not an object", () => {
    for (const input of [null, "x", 7, []]) expect(parseDraftPatch(input).ok).toBe(false);
  });
});

describe("parseDraftPatchText", () => {
  it("parses JSON text", () => {
    const result = parseDraftPatchText(JSON.stringify({ ...base, name: "A" }));
    expect(result).toMatchObject({ ok: true, patch: { rev: 4, name: "A" } });
  });

  it("refuses text that is not JSON", () => {
    expect(parseDraftPatchText("{nope")).toEqual({ ok: false, message: "The request body is not valid JSON." });
    expect(parseDraftPatchText("")).toMatchObject({ ok: false });
  });

  it("refuses text over the size limit before parsing it", () => {
    const result = parseDraftPatchText(" ".repeat(MAX_BODY_SIZE + 1));
    expect(result).toEqual({ ok: false, message: "The draft is too large to save." });
  });

  it("keeps sample-set numbers as the exact text sent (21.90 stays 21.90, every digit kept)", () => {
    const text = `{"rev":4,"sessionKey":"${base.sessionKey}","sampleSets":[{"id":"s1","name":"Maya","values":{"apr":21.90,"fee":95,"big":1000000000000000000000,"name":"Maya","tiny":0.000001}}]}`;
    const result = parseDraftPatchText(text);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.patch.sampleSets?.[0].values).toEqual({ apr: "21.90", fee: "95", big: "1000000000000000000000", name: "Maya", tiny: "0.000001" });
  });

  it("sends an exponent through as its text, for the value's own check to refuse", () => {
    const result = parseDraftPatchText(`{"rev":4,"sessionKey":"${base.sessionKey}","sampleSets":[{"id":"s1","name":"A","values":{"n":1e3}}]}`);
    expect(result.ok && result.patch.sampleSets?.[0].values).toEqual({ n: "1e3" });
  });

  it("leaves numbers elsewhere alone", () => {
    const result = parseDraftPatchText(`{"rev":4.0,"sessionKey":"${base.sessionKey}","name":"A"}`);
    expect(result).toMatchObject({ ok: true, patch: { rev: 4 } });
  });
});
