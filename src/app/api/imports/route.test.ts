import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_LIMITS, IMPORT_REFUSALS, JUST_IMPORTED_COOKIE, type ImportResponse } from "@/domain/import-types";
import type { Viewer } from "@/domain/types";
import { importTemplate } from "@/server/import/create";
import { getViewer } from "@/server/viewer";
import { POST } from "./route";

// The route is thin: the viewer, the import and Next's cookie and cache calls are mocked; these tests
// check the form parsing, the HTTP mapping and the one-shot cookies. The import itself is tested
// against a real database in src/server/import/create.test.ts.
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/import/create", async (original) => ({
  ...(await original<typeof import("@/server/import/create")>()),
  importTemplate: vi.fn(),
}));
const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const viewer = { userId: "maya" } as Viewer;

function post(form: FormData | string, headers: Record<string, string> = {}) {
  const request = new Request("http://localhost/api/imports", {
    method: "POST",
    headers,
    body: form,
  }) as NextRequest;
  return POST(request);
}

function formWith(file: File | null, team: string | null = "coral-offers") {
  const form = new FormData();
  if (file) form.set("file", file);
  if (team !== null) form.set("team", team);
  return form;
}

const answerWith = (response: ImportResponse) => vi.mocked(importTemplate).mockResolvedValue(response);

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
  vi.mocked(importTemplate).mockReset();
  jar.set.mockReset();
  vi.mocked(cookies).mockClear();
  vi.mocked(revalidatePath).mockReset();
});

describe("POST /api/imports", () => {
  it("200: passes the viewer, the team and the file's name and bytes; sets both one-shot cookies; refreshes the Library", async () => {
    answerWith({ ok: true, templateId: "UC-4F7K2Q", href: "/coral-offers/templates/UC-4F7K2Q" });
    const res = await post(formWith(new File(["hello"], "notes.txt", { type: "text/plain" })));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, templateId: "UC-4F7K2Q", href: "/coral-offers/templates/UC-4F7K2Q" });

    const [who, input] = vi.mocked(importTemplate).mock.calls[0]!;
    expect(who).toBe(viewer);
    expect(input.teamSlug).toBe("coral-offers");
    expect(input.file?.name).toBe("notes.txt");
    expect(new TextDecoder().decode(input.file?.bytes)).toBe("hello");

    const cookie = { path: "/", sameSite: "lax", maxAge: 60 };
    expect(jar.set).toHaveBeenCalledWith("ucomp_created", "UC-4F7K2Q", cookie);
    expect(jar.set).toHaveBeenCalledWith(JUST_IMPORTED_COOKIE, "UC-4F7K2Q", cookie);
    expect(revalidatePath).toHaveBeenCalledWith("/[team]/library", "page");
  });

  it.each([
    ["permission", 403],
    ["size", 413],
    ["type", 415],
    ["empty", 400],
    ["unreadable", 400],
    ["tooLong", 400],
    ["pdfNoText", 400],
    ["pdfLocked", 400],
    ["pdfPages", 400],
  ] as const)("%s becomes %i, with the body unchanged and no cookies", async (code, status) => {
    const body: ImportResponse = { ok: false, code, reason: code === "permission" ? "You don't have access to do this." : IMPORT_REFUSALS[code] };
    answerWith(body);
    const res = await post(formWith(new File(["x"], "x.txt")));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(jar.set).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a missing file or team is passed on as null / empty (the import answers with permission or unreadable)", async () => {
    answerWith({ ok: false, code: "permission", reason: "You don't have access to do this." });
    await post(formWith(null, null));
    expect(vi.mocked(importTemplate).mock.calls[0]![1]).toEqual({ teamSlug: "", file: null });
  });

  it("413 when Content-Length says the body is too large, before reading it", async () => {
    const res = await post("x", { "Content-Length": String(IMPORT_LIMITS.maxBytes + 128 * 1024), "Content-Type": "text/plain" });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, code: "size", reason: "This file is larger than 10 MB." });
    expect(importTemplate).not.toHaveBeenCalled();
  });

  it("400 unreadable for a body that isn't form data", async () => {
    const res = await post("not a form", { "Content-Type": "multipart/form-data; boundary=zzz" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: "unreadable", reason: "Couldn't read this file." });
    expect(importTemplate).not.toHaveBeenCalled();
  });
});
