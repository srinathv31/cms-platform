// What an implementation of the service interfaces is built with, besides its data: its clock, and the hooks only
// tests set. Production builds the local implementation with neither (`services()`): the demo clock, no hooks.

/** The backend's clock: every write is dated by it, and every read that decides by time answers `asOf` from it. */
export type Clock = () => Promise<Date>;

/**
 * Points where a test reaches into a command, so the contract suite can reach what a serializing database never
 * shows on its own. Never set outside tests.
 */
export interface TestHooks {
  /**
   * Runs between a command's re-read of a row and its compare-and-set write. Answering `competing_write` changes
   * the row first, as another writer committing in between would on a database that doesn't serialize writes:
   * the write then finds the row moved. On a version the command is refused `version_changed` and writes
   * nothing; on a notification the competing write marks it read first, so `markRead` finds nothing to change.
   * On an access request another Team Admin decides it first (`request_decided`); on a recertification item
   * (`id` is `recertId:userId`) another decision lands first (`already_recertified`); on a membership every
   * other active Team Admin of its team loses the role first, so a change that ends this one's is `last_admin`.
   */
  beforeCompareAndSet?(target: {
    table:
      | "versions"
      | "notifications"
      | "memberships"
      | "access_requests"
      | "recert_items";
    id: string;
  }): "competing_write" | undefined;
}

/** How an implementation is built: `clock` defaults to the backend's own, `hooks` to none. */
export interface ImplementationOptions {
  clock?: Clock;
  hooks?: TestHooks;
}
