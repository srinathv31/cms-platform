import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { expect } from "vitest";
import type { Db } from "@/server/db/client";
import { versions } from "@/server/db/schema/ucomp";

// Test support for the reads a screen makes on demand, the GET routes under src/app/api/templates/[templateId]/:
// one test file per route, each against a temporary database filled by the real seed. Not a test file itself.

/** A route handler of `/api/templates/{templateId}/…`. */
export type ReadHandler = (
  request: NextRequest,
  ctx: { params: Promise<{ templateId: string }> },
) => Promise<Response>;

/** GET /api/templates/{templateId}/{read}{query} through the route's handler. */
export function getRead(
  handler: ReadHandler,
  read: string,
  templateId: string,
  query = "",
): Promise<Response> {
  const url = `http://localhost/api/templates/${encodeURIComponent(templateId)}/${read}${query}`;
  return handler(new NextRequest(url), {
    params: Promise.resolve({ templateId }),
  });
}

/** The status and body, checking the headers every answer has: JSON, never cached. */
export async function readAnswer(response: Promise<Response>) {
  const res = await response;
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

/** A seeded version of the template: by number, or its open draft. */
export function versionOf(
  db: Db,
  templateId: string,
  where: { number?: number; state?: "draft" },
) {
  return db.query.versions
    .findFirst({
      where: and(
        eq(versions.templateId, templateId),
        where.number !== undefined
          ? eq(versions.number, where.number)
          : undefined,
        where.state ? eq(versions.state, where.state) : undefined,
      ),
    })
    .then((v) => v!);
}

/** The route module exports a GET handler and nothing else (a read is never a write). */
export async function expectOnlyGet(route: Record<string, unknown>) {
  expect(Object.keys(route)).toEqual(["GET"]);
}
