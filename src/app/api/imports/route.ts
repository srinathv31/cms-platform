import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { JUST_CREATED_COOKIE, JUST_CREATED_MAX_AGE } from "@/components/workspace/just-created";
import { IMPORT_LIMITS, IMPORT_REFUSALS, JUST_IMPORTED_COOKIE, type ImportResponse } from "@/domain/import-types";
import { importStatus, importTemplate } from "@/server/import/create";
import { getViewer } from "@/server/viewer";

// Import a file: multipart/form-data { file, team } → ImportResponse. A route handler rather than a
// server action because actions cap request bodies at 1 MB. On success it sets the two one-shot
// cookies (the name is selected and the rail opens on Original on arrival) and refreshes the
// Library; the client then navigates to `href`.

/** Room for the multipart envelope around a file at the size limit. */
const MULTIPART_SLACK = 64 * 1024;

function respond(body: ImportResponse): Response {
  return Response.json(body, { status: importStatus(body), headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer();

  // Refused before the body is read when the request says it is too large.
  const declared = Number(request.headers.get("content-length"));
  if (declared > IMPORT_LIMITS.maxBytes + MULTIPART_SLACK) {
    return respond({ ok: false, code: "size", reason: IMPORT_REFUSALS.size });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return respond({ ok: false, code: "unreadable", reason: IMPORT_REFUSALS.unreadable });
  }
  const team = form.get("team");
  const file = form.get("file");

  const result = await importTemplate(viewer, {
    teamSlug: typeof team === "string" ? team : "",
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
