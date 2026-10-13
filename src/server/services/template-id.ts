import type { IdSource } from "./options";

// A new template's id, and what happens when it is taken (decision 0060). `templates.id` is random, and nothing
// reads for a free one first: a command inserts with a fresh id and, when the insert finds the id taken, is
// retried whole with another. Both implementations run their create through `withNewTemplateId`, so the policy
// is written once.

/** The most attempts a create gets: the id is drawn again after a collision, twice at most. */
export const TEMPLATE_ID_ATTEMPTS = 3;

/** Raised inside a create when the insert finds the template id taken. Rolls the whole write back. */
export class TemplateIdTaken extends Error {
  constructor(readonly templateId: string) {
    super(`The template id ${templateId} is taken.`);
    this.name = "TemplateIdTaken";
  }
}

/**
 * Runs `attempt` with a fresh template id, and again with another when it throws `TemplateIdTaken`. A third
 * collision is a bug or an outage (about a billion ids, and the third draw failed too), so it throws.
 */
export async function withNewTemplateId<T>(
  ids: IdSource,
  attempt: (templateId: string) => Promise<T>,
): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await attempt(ids.templateId());
    } catch (error) {
      if (!(error instanceof TemplateIdTaken) || n >= TEMPLATE_ID_ATTEMPTS)
        throw error;
    }
  }
}
