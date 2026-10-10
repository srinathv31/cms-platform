import "server-only";
import { asc, desc } from "drizzle-orm";
import { connection } from "next/server";
import { simCustomers, simDeliveries, simOffers } from "@/server/db/schema/sim";
import { simDb } from "@/simulator/db";
import { customerRow } from "@/simulator/queries";
import type { SimCustomerRow } from "@/simulator/types";

// Read models for Coral's Customers and Deliveries lists. Coral's own tables only; nothing here calls UCOMP.

export async function getSimCustomers(): Promise<SimCustomerRow[]> {
  await connection();
  const rows = await simDb.select().from(simCustomers).orderBy(asc(simCustomers.id));
  return rows.map(customerRow);
}

export interface SimBatchSummary {
  id: string;
  at: string;
  offerId: string;
  offerName: string;
  templateId: string | null;
  versionNumber: number | null;
  customers: number;
  delivered: number;
  failed: number;
}

/** The newest sends, one row per batch (a batch is one Send: customers × channels). */
export async function getSimBatches(limit = 30): Promise<SimBatchSummary[]> {
  await connection();
  const [offers, deliveries] = await Promise.all([
    simDb.select({ id: simOffers.id, name: simOffers.name }).from(simOffers),
    simDb.select().from(simDeliveries).orderBy(desc(simDeliveries.at), desc(simDeliveries.id)).limit(2000),
  ]);
  const names = new Map(offers.map((o) => [o.id, o.name]));
  const batches = new Map<string, SimBatchSummary & { people: Set<string> }>();
  for (const d of deliveries) {
    let b = batches.get(d.batchId);
    if (!b) {
      b = {
        id: d.batchId,
        at: d.at.toISOString(),
        offerId: d.offerId,
        offerName: names.get(d.offerId) ?? d.offerId,
        templateId: d.templateId,
        versionNumber: d.versionNumber,
        customers: 0,
        delivered: 0,
        failed: 0,
        people: new Set(),
      };
      batches.set(d.batchId, b);
    }
    b.people.add(d.customerId);
    if (d.status === "delivered") b.delivered += 1;
    else b.failed += 1;
  }
  return [...batches.values()]
    .slice(0, limit)
    .map(({ people, ...b }) => ({ ...b, customers: people.size }));
}
