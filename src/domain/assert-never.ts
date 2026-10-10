// The exhaustive check. Put it in the `default` of a switch that handles every member of a union
// (every channel, every field shape): while a member has no case, TypeScript refuses the call, so a
// new channel is a compile error at each place that must handle it. At run time it throws, because a
// value outside the union is a bug.

/** `default: return assertNever(channel)`: compiles only when every case above it is handled. */
export function assertNever(value: never, what = "value"): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(value)}`);
}
