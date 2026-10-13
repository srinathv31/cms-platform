// The reads the fake doesn't serve. The fake is slim (decision 0072): every command is implemented, and a read
// only where a contract case must observe a command through it. A read model's BFF tests hand its shaping
// function facts instead, and the read's own contract cases run against the local implementation (and the Java
// API later). Calling one of these is a bug in a test: it fails loudly rather than answer something made up.

/** A read the fake doesn't serve. Calling it rejects with the method's name. */
export function notInFake(
  method: string,
): (...args: unknown[]) => Promise<never> {
  return async () => {
    throw new Error(
      `The fake doesn't serve ${method}: test its read model on facts, and the read in the contract suite against the local implementation (src/server/services/README.md, "The fake").`,
    );
  };
}
