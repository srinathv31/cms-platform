import { selectOne, update, type InValue } from "./db";

// Faults for the error-screen specs: each breaks one stored value so that the query reading it throws, the way a
// corrupt row or a failing backend would, and returns the function that puts back exactly what was there. A
// backend that owns its data offers these as test-only fault switches.

/** Not JSON: parsing a stored JSON value that holds this throws. */
const BROKEN = "{";

async function breakValue(
  table: string,
  keyColumn: string,
  key: InValue,
  column: string,
): Promise<() => Promise<void>> {
  const before = await selectOne(
    `SELECT ${column} FROM ${table} WHERE ${keyColumn} = ?`,
    [key],
  );
  if (!before) throw new Error(`${table} row ${key} doesn't exist.`);
  let restored = false;
  await update(table, keyColumn, key, { [column]: BROKEN });
  return async () => {
    if (restored) return;
    restored = true;
    await update(table, keyColumn, key, { [column]: before[column] });
  };
}

/** A version's stored body, which every screen showing the version reads. */
export const breakVersionBody = (versionId: string) =>
  breakValue("versions", "id", versionId, "body");

/** The demo clock's setting, which every part of the app's frame reads. */
export const breakClockSetting = () =>
  breakValue("settings", "key", "clock_offset_days", "value");

/** The first simulator customer's stored account, which only Coral's Customers page reads. */
export async function breakCustomerAccount(): Promise<() => Promise<void>> {
  const customer = await selectOne(
    "SELECT id FROM sim_customers ORDER BY id LIMIT 1",
  );
  if (!customer)
    throw new Error(
      "This spec needs the fresh seed (npm run db:reset): Coral has no customers.",
    );
  return breakValue("sim_customers", "id", customer.id, "statement");
}
