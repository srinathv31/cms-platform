import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMPORT_LIMITS,
  IMPORT_REFUSALS,
  JUST_IMPORTED_COOKIE,
  type ImportResponse,
} from "@/domain/import-types";
import { REASONS } from "@/domain/permissions";
import { refuse } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { importPermission, importTemplate } from "@/server/import/create";
import { getViewer } from "@/server/viewer";
import { POST } from "./route";

// The route is thin: the viewer, the permission check, the import and Next's cookie and cache calls
// are mocked; these tests check the order (permission before the body), the capped body read, the
// form parsing, the HTTP mapping and the one-shot cookies. The import itself is tested against the fake
// backend in src/server/import/create.test.ts, and against the local one in services/local/templates.test.ts.
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/import/create", async (original) => ({
  ...(await original<typeof import("@/server/import/create")>()),
  importTemplate: vi.fn(),
  importPermission: vi.fn(),
}));
const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const viewer = { userId: "maya" } as Viewer;

function requestOf(
  body: BodyInit,
  headers: Record<string, string> = {},
  team: string | null = "coral-offers",
) {
  const url =
    team === null
      ? "http://localhost/api/imports"
      : `http://localhost/api/imports?team=${team}`;
  return new Request(url, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit) as NextRequest;
}

function post(
  form: FormData | string,
  headers: Record<string, string> = {},
  team: string | null = "coral-offers",
) {
  return POST(requestOf(form, headers, team));
}

function formWith(file: File | null) {
  const form = new FormData();
  if (file) form.set("file", file);
  return form;
}

/** A body with no Content-Length (as a chunked upload): `megabytes` of 1 MB chunks, counting what was pulled. */
function chunkedBody(megabytes: number) {
  const pulled = { mb: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.mb >= megabytes) return controller.close();
      pulled.mb += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  return { stream, pulled };
}

const answerWith = (response: ImportResponse) =>
  vi.mocked(importTemplate).mockResolvedValue(response);

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
  vi.mocked(importTemplate).mockReset();
  vi.mocked(importPermission).mockReset().mockResolvedValue({
    ok: true,
    teamId: "t_coral",
    teamSlug: "coral-offers",
  });
  jar.set.mockReset();
  vi.mocked(cookies).mockClear();
  vi.mocked(revalidatePath).mockReset();
});

describe("POST /api/imports", () => {
  it("200: passes the viewer, the team and the file's name and bytes; sets both one-shot cookies; refreshes the Library", async () => {
    answerWith({
      ok: true,
      templateId: "UC-4F7K2Q",
      href: "/coral-offers/templates/UC-4F7K2Q",
    });
    const res = await post(
      formWith(new File(["hello"], "notes.txt", { type: "text/plain" })),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      templateId: "UC-4F7K2Q",
      href: "/coral-offers/templates/UC-4F7K2Q",
    });

    const [ctx, input] = vi.mocked(importTemplate).mock.calls[0]!;
    expect(ctx.viewer).toBe(viewer);
    expect(input.teamSlug).toBe("coral-offers");
    expect(input.file?.name).toBe("notes.txt");
    expect(new TextDecoder().decode(input.file?.bytes)).toBe("hello");

    const cookie = { path: "/", sameSite: "lax", maxAge: 60 };
    expect(jar.set).toHaveBeenCalledWith("ucomp_created", "UC-4F7K2Q", cookie);
    expect(jar.set).toHaveBeenCalledWith(
      JUST_IMPORTED_COOKIE,
      "UC-4F7K2Q",
      cookie,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/[team]/library", "page");
  });

  it.each([
    ["size", 413],
    ["type", 415],
    ["legacyDoc", 415],
    ["notPdf", 415],
    ["notWord", 415],
    ["empty", 400],
    ["unreadable", 400],
    ["tooLong", 400],
    ["pdfNoText", 400],
    ["pdfLocked", 400],
    ["pdfPages", 400],
  ] as const)(
    "%s becomes %i, with the body unchanged and no cookies",
    async (name, status) => {
      const body: ImportResponse = refuse(IMPORT_REFUSALS[name]);
      answerWith(body);
      const res = await post(formWith(new File(["x"], "x.txt")));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(body);
      expect(jar.set).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("content becomes 400 with the document check's sentence after the file's own", async () => {
    const body = refuse(
      IMPORT_REFUSALS.content(
        "This table's cells don't line up into rows and columns.",
      ),
    );
    answerWith(body);
    const res = await post(formWith(new File(["x"], "x.txt")));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      code: "import_content",
      reason:
        "This file can't be imported as it is. This table's cells don't line up into rows and columns.",
    });
  });

  it("a refusal that isn't about the file (the permission's) becomes 403", async () => {
    answerWith(refuse(REASONS.generic));
    const res = await post(formWith(new File(["x"], "x.txt")));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      code: "generic",
      reason: "You don't have access to do this.",
    });
  });

  it("the team comes from the query; a missing one is passed on as empty (the permission check refuses it)", async () => {
    vi.mocked(importPermission).mockResolvedValue(refuse(REASONS.generic));
    const res = await post(formWith(null), {}, null);
    expect(res.status).toBe(403);
    expect(vi.mocked(importPermission).mock.calls[0]).toEqual([
      expect.objectContaining({ viewer }),
      "",
    ]);
  });

  it("a missing file is passed on as null (the import answers unreadable)", async () => {
    answerWith(refuse(IMPORT_REFUSALS.unreadable));
    await post(formWith(null));
    expect(vi.mocked(importTemplate).mock.calls[0]![1]).toEqual({
      teamSlug: "coral-offers",
      file: null,
    });
  });

  it("403 before a byte of the body is read, when the viewer can't create on the team", async () => {
    vi.mocked(importPermission).mockResolvedValue(refuse(REASONS.generic));
    const { stream, pulled } = chunkedBody(64);
    const request = requestOf(stream, {
      "Content-Type": "multipart/form-data; boundary=zzz",
    });
    const res = await POST(request);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      code: "generic",
      reason: "You don't have access to do this.",
    });
    expect(request.bodyUsed).toBe(false);
    expect(pulled.mb).toBeLessThanOrEqual(1); // at most what the stream queued up front
    expect(importTemplate).not.toHaveBeenCalled();
  });

  it("401 when nobody is signed in, before anything else", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    const res = await post(formWith(new File(["x"], "x.txt")));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      code: "signed_out",
      reason: "Sign in to continue.",
    });
    expect(importPermission).not.toHaveBeenCalled();
    expect(importTemplate).not.toHaveBeenCalled();
  });

  it("413 when Content-Length says the body is too large, before reading it", async () => {
    const res = await post("x", {
      "Content-Length": String(IMPORT_LIMITS.maxBytes + 128 * 1024),
      "Content-Type": "text/plain",
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      ok: false,
      code: "import_too_large",
      reason: "This file is larger than 10 MB.",
    });
    expect(importTemplate).not.toHaveBeenCalled();
  });

  it("413 for a chunked body with no Content-Length, as soon as it passes the limit: the rest is never read", async () => {
    const { stream, pulled } = chunkedBody(64);
    const res = await POST(
      requestOf(stream, {
        "Content-Type": "multipart/form-data; boundary=zzz",
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      ok: false,
      code: "import_too_large",
      reason: "This file is larger than 10 MB.",
    });
    expect(pulled.mb).toBeLessThan(13);
    expect(importTemplate).not.toHaveBeenCalled();
  });

  it("400 unreadable for a body that isn't form data", async () => {
    const res = await post("not a form", {
      "Content-Type": "multipart/form-data; boundary=zzz",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      code: "import_unreadable",
      reason: "Couldn't read this file.",
    });
    expect(importTemplate).not.toHaveBeenCalled();
  });
});
