import { sql, type SQL } from "drizzle-orm";
import { alias, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { versions } from "@/server/db/schema/ucomp";

// A template has no name of its own: each version carries the name it was written and approved with
// (docs/decisions/0016-the-name-is-versioned.md). Customer output uses the name of the version it
// renders or returns. The CMS's lists and pickers show the template by the name below.

const NAMED = "named_version";
// Its own alias, so the subquery reads the right `versions` when the outer query joins that table too.
const named = alias(versions, NAMED);

/**
 * The name the CMS shows for a template, as a column: its open draft's, otherwise its newest
 * version's (by number, then round). The same version `pickLatest` (library.ts) picks, so a list
 * agrees with the workspace header. A template with no version at all (never the case through the app)
 * shows its id, as the Library and the header do. Screens about one version (review, notifications)
 * use that version's name instead.
 */
export function currentName(templateId: AnySQLiteColumn): SQL<string> {
  return sql<string>`coalesce((select ${named.name} from ${versions} ${sql.identifier(NAMED)} where ${named.templateId} = ${templateId} order by ${named.state} = 'draft' desc, ${named.number} desc, ${named.round} desc limit 1), ${templateId})`;
}
