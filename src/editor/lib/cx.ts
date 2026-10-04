// Minimal class joiner so the editor carries no utility dependency of its own.
// (shadcn components merge their own classes; editor markup never needs conflict resolution.)
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
