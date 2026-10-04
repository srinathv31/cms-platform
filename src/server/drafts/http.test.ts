import { describe, expect, it } from "vitest";
import type { DraftSaveError } from "@/domain/types";
import { DRAFT_SAVE_STATUS, statusOf } from "./http";

describe("statusOf", () => {
  it("is 200 for a save", () => {
    expect(statusOf({ ok: true, rev: 2, savedAt: "2026-10-04T10:00:00.000Z" })).toBe(200);
  });

  it("maps each refusal to its HTTP status", () => {
    const table: Record<DraftSaveError, number> = {
      not_found: 404,
      forbidden: 403,
      not_draft: 409,
      conflict: 409,
      invalid: 400,
    };
    for (const [error, status] of Object.entries(table)) {
      expect(statusOf({ ok: false, error: error as DraftSaveError, message: "m" })).toBe(status);
    }
    expect(Object.keys(DRAFT_SAVE_STATUS).sort()).toEqual(Object.keys(table).sort());
  });
});
