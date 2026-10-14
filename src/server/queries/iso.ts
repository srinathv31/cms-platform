// Instants as the read models hand them to components: ISO 8601 strings in UTC, which survive the trip to the
// browser as they are.

export function iso(date: Date): string {
  return date.toISOString();
}

export function isoOrUndefined(
  date: Date | null | undefined,
): string | undefined {
  return date ? date.toISOString() : undefined;
}
