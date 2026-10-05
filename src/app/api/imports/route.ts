import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { JUST_CREATED_COOKIE, JUST_CREATED_MAX_AGE } from "@/components/workspace/just-created";
import { IMPORT_LIMITS, IMPORT_REFUSALS, JUST_IMPORTED_COOKIE, type ImportResponse } from "@/domain/import-types";
import { importPermission, importStatus, importTemplate } from "@/server/import/create";
import { readBodyCapped } from "@/server/import/read-body";
import { getViewer } from "@/server/viewer";

// Import a file: POST /api/imports?team=<slug>, multipart/form-data { file } → ImportResponse. A
// route handler rather than a server action because actions cap request bodies at 1 MB. On success
// it sets the two one-shot cookies (the name is selected and the rail opens on Original on arrival)
// and refreshes the Library; the client then navigates to `href`.
//
// Nothing is read from the body until the viewer may create on the team (the team is in the query
// for that reason), and the body is then read with a byte counter that stops past the size limit:
// a declared Content-Length is only a hint, and a chunked upload has none.

/** Room for the multipart envelope around a file at the size limit. */
const MULTIPART_SLACK = 64 * 1024;

function respond(body: ImportResponse): Response {
  return Response.json(body, { status: importStatus(body), headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  const teamSlug = new URL(request.url).searchParams.get("team") ?? "";

  // Permission first, before a byte of the body is read.
  const permitted = await importPermission(viewer, teamSlug);
  if (!permitted.ok) return respond(permitted);

  // Too large: refused from the declared length when there is one, else as soon as the count passes it.
  const cap = IMPORT_LIMITS.maxBytes + MULTIPART_SLACK;
  if (Number(request.headers.get("content-length")) > cap) return respond({ ok: false, code: "size", reason: IMPORT_REFUSALS.size });
  const body = await readBodyCapped(request.body, cap);
  if (!body.ok) return respond({ ok: false, code: "size", reason: IMPORT_REFUSALS.size });

  let form: FormData;
  try {
    form = await new Response(body.bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return respond({ ok: false, code: "unreadable", reason: IMPORT_REFUSALS.unreadable });
  }
  const file = form.get("file");

  const result = await importTemplate(viewer, {
    teamSlug,
    file: file instanceof File ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null,
  });

  if (result.ok) {
    const jar = await cookies();
    const cookie = { path: "/", sameSite: "lax" as const, maxAge: JUST_CREATED_MAX_AGE };
    jar.set(JUST_CREATED_COOKIE, result.templateId, cookie);
    jar.set(JUST_IMPORTED_COOKIE, result.templateId, cookie);
    revalidatePath("/[team]/library", "page");
  }
  return respond(result);
}
