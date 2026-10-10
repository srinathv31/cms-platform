// Coral's exhaustive check, for the `default` of a switch over a channel. Coral can't import Stencil's
// domain, so it has its own: while a channel has no case, TypeScript refuses the call, so a channel
// added to the API (`ApiChannel`) or to Coral's deliveries (`SimChannel`) is a compile error at every
// place that must handle it. At run time it throws: a value outside the union is a bug.

export function assertNever(value: never, what = "value"): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(value)}`);
}
