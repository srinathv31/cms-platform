// Placeholders for the methods whose area hasn't moved behind the service interfaces yet. Each is still
// answered by its old code in src/server/actions/ or src/server/queries/, which the BFF calls directly, so
// nothing calls these. A call is a bug, and fails loudly rather than answer something made up.

/** A method that still runs outside the seam. Calling it rejects with the method's name. */
export function notMoved(
  method: string,
): (...args: unknown[]) => Promise<never> {
  return async () => {
    throw new Error(
      `${method} hasn't moved behind the service interfaces yet: call its old code (src/server/services/README.md).`,
    );
  };
}

/** An area none of whose methods has moved: every method is `notMoved`. */
export function notMovedArea<T extends object>(area: string): T {
  return new Proxy({} as T, {
    get: (_, method) =>
      typeof method === "string" ? notMoved(`${area}.${method}`) : undefined,
  });
}

/**
 * An area some of whose methods have moved: the ones in `moved`, and `notMoved` for the rest. Several packages
 * move the methods of one area (templates: commands, workspace reads, Library reads), each in a file of its own.
 */
export function movedArea<T extends object>(
  area: string,
  moved: Partial<T>,
): T {
  return new Proxy(moved as T, {
    get: (target, method) =>
      typeof method !== "string"
        ? undefined
        : method in target
          ? target[method as keyof T]
          : notMoved(`${area}.${method}`),
  });
}
