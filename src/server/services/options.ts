// What an implementation of the service interfaces is built with, besides its data: its clock, the source of the
// ids it draws, and the hooks only tests set. Production builds the local implementation with none of the last
// two (`services()`): the demo clock, random ids, no hooks.

/** The backend's clock: every write is dated by it, and every read that decides by time answers `asOf` from it. */
export type Clock = () => Promise<Date>;

/**
 * Where the backend draws the ids it generates and retries on a collision (decision 0060): a template's. Every
 * other id is long enough to be left to chance. A test hands in its own, to force a collision.
 */
export interface IdSource {
  /** A new template id: `UC-` and six characters of Crockford base32. */
  templateId(): string;
}

/**
 * Points where a test reaches into a command, so the contract suite can reach what a serializing database never
 * shows on its own. Never set outside tests.
 */
export interface TestHooks {
  /**
   * Runs between a command's re-read of a row and its compare-and-set write (or the unique index that guards its
   * insert). Answering `competing_write` changes the row first, as another writer committing in between would on
   * a database that doesn't serialize writes: the write then finds the row moved. On a version the command is
   * refused `version_changed` and writes nothing; on a notification the competing write marks it read first, so
   * `markRead` finds nothing to change; on a comment thread it sets the status the command was about to, so
   * `resolve` and `reopen` find nothing to change; for `drafts` (`id` is the template's) it opens the template's
   * draft first, as another Edit would, so the one-draft index lets only one in and `startDraft` opens that one.
   * On an access request another Team Admin decides it first (`request_decided`); on a recertification item
   * (`id` is `recertId:userId`) another decision lands first (`already_recertified`); on a membership every
   * other active Team Admin of its team loses the role first, so a change that ends this one's is `last_admin`.
   */
  beforeCompareAndSet?(target: {
    table:
      | "versions"
      | "notifications"
      | "comment_threads"
      | "drafts"
      | "memberships"
      | "access_requests"
      | "recert_items";
    id: string;
  }): "competing_write" | undefined;
}

/** How an implementation is built: `clock` defaults to the backend's own, `ids` to random ones, `hooks` to none. */
export interface ImplementationOptions {
  clock?: Clock;
  ids?: IdSource;
  hooks?: TestHooks;
}
