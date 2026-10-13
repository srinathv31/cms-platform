import {
  execute,
  insert,
  marks,
  select,
  selectOne,
  type InValue,
  type Row,
} from "./db";
import {
  fromRow,
  newId,
  toColumns,
  type SimDeliveryRecord,
  type SimLinkRecord,
} from "./records";

// Coral, the simulated consumer, as it keeps its own data: which template each offer is linked to, what each
// send delivered, and which of Stencil's notices it has read. Stencil's code never reads these tables.

export async function simLink(
  offerId: string,
): Promise<SimLinkRecord | undefined> {
  const row = await selectOne("SELECT * FROM sim_links WHERE offer_id = ?", [
    offerId,
  ]);
  return row ? fromRow<SimLinkRecord>("sim_links", row) : undefined;
}

/**
 * Links an offer to a template, as a person would have left it after linking in the simulator (replacing any link
 * the offer had).
 */
export async function linkOffer(link: {
  offerId: string;
  templateId: string;
  templateName: string;
  pinnedVersion: number;
  channels: readonly string[];
  mapping: Record<string, string>;
}): Promise<void> {
  await execute("DELETE FROM sim_links WHERE offer_id = ?", [link.offerId]);
  await insert(
    "sim_links",
    toColumns("sim_links", {
      id: newId("lnk"),
      ...link,
      linkedAt: Date.now() - 86_400_000,
    }),
  );
}

export interface DeliveryFilter {
  offerId?: string;
  templateId?: string;
  versionNumber?: number;
  status?: "delivered" | "failed";
}

/** Deliveries that fit, ordered by id. */
export async function simDeliveries(
  filter: DeliveryFilter = {},
): Promise<SimDeliveryRecord[]> {
  const where: string[] = [];
  const args: InValue[] = [];
  const add = (condition: string, value: InValue | undefined) => {
    if (value === undefined) return;
    where.push(condition);
    args.push(value);
  };
  add("offer_id = ?", filter.offerId);
  add("template_id = ?", filter.templateId);
  add("version_number = ?", filter.versionNumber);
  add("status = ?", filter.status);
  return (
    await select(
      `SELECT * FROM sim_deliveries ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`,
      args,
    )
  ).map((row) => fromRow<SimDeliveryRecord>("sim_deliveries", row));
}

export interface SimulatorScope {
  /** Offers whose deliveries (and the render log rows those made) and link the run may change. */
  offers?: readonly string[];
  /** Templates whose notices Coral may read during the run: the read marks go back to what they were. */
  noticeTemplates?: readonly string[];
}

/**
 * Remembers Coral's data for the offers and templates named, as it is now. The returned function puts it back: the
 * deliveries made since are removed with the render log rows they caused, each offer's link goes back to what it
 * was (none, if it had none), and the notices read since are unread.
 */
export async function rememberSimulator(
  scope: SimulatorScope,
): Promise<() => Promise<void>> {
  const offers = scope.offers ?? [];
  const noticeTemplates = scope.noticeTemplates ?? [];

  const deliveriesBefore = new Set(
    offers.length === 0
      ? []
      : (
          await select(
            `SELECT id FROM sim_deliveries WHERE offer_id IN (${marks(offers.length)})`,
            [...offers],
          )
        ).map((row) => String(row.id)),
  );
  const linksBefore: Row[] =
    offers.length === 0
      ? []
      : await select(
          `SELECT * FROM sim_links WHERE offer_id IN (${marks(offers.length)})`,
          [...offers],
        );
  const readsBefore = new Set(await readNoticeIds(noticeTemplates));

  return async () => {
    const problems: unknown[] = [];
    const attempt = async (step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        problems.push(error);
      }
    };

    await attempt(async () => {
      if (offers.length === 0) return;
      const all = await select(
        `SELECT id, correlation_id FROM sim_deliveries WHERE offer_id IN (${marks(offers.length)})`,
        [...offers],
      );
      const fresh = all.filter((row) => !deliveriesBefore.has(String(row.id)));
      for (let i = 0; i < fresh.length; i += 200) {
        const chunk = fresh.slice(i, i + 200);
        await execute(
          `DELETE FROM render_log WHERE correlation_id IN (${marks(chunk.length)})`,
          chunk.map((row) => row.correlation_id),
        );
        await execute(
          `DELETE FROM sim_deliveries WHERE id IN (${marks(chunk.length)})`,
          chunk.map((row) => row.id),
        );
      }
    });

    await attempt(async () => {
      for (const offer of offers) {
        const was = linksBefore.find((row) => String(row.offer_id) === offer);
        const now = await selectOne(
          "SELECT * FROM sim_links WHERE offer_id = ?",
          [offer],
        );
        if (now && was && JSON.stringify(now) === JSON.stringify(was)) continue;
        await execute("DELETE FROM sim_links WHERE offer_id = ?", [offer]);
        if (was) await insert("sim_links", was);
      }
    });

    await attempt(async () => {
      for (const noticeId of await readNoticeIds(noticeTemplates))
        if (!readsBefore.has(noticeId))
          await execute("DELETE FROM sim_notice_reads WHERE notice_id = ?", [
            noticeId,
          ]);
    });

    if (problems.length > 0) throw problems[0];
  };
}

/** The ids of the notices of these templates that Coral has marked read. */
async function readNoticeIds(templates: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const template of templates)
    for (const row of await select(
      `SELECT r.notice_id FROM sim_notice_reads r JOIN consumer_notices n ON n.id = r.notice_id
       WHERE n.template_id = ?`,
      [template],
    ))
      ids.push(String(row.notice_id));
  return ids;
}
