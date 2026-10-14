// What a read that names a template or a version by id takes as an id before it looks anything up: present, and 1
// to 64 characters. Anything else is a malformed request (400), not a missing record (404).

/** An id as a request names it: present, and 1 to 64 characters. */
export function isRequestId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64;
}
