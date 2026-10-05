import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppClient, serializeWrites } from "@/lib/serialized-writes";

// Against real SQLite files: the bug lives in how the local driver behaves after SQLITE_BUSY.

let dir: string;
let url: string;
const opened: Client[] = [];
const open = (client: Client) => (opened.push(client), client);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ucomp-serialized-writes-"));
  url = `file:${join(dir, "test.db")}`;
  const setup = createClient({ url });
  await setup.execute("CREATE TABLE t (x INTEGER)");
  setup.close();
});

afterEach(() => {
  for (const client of opened.splice(0)) client.close();
  rmSync(dir, { recursive: true, force: true });
});

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const count = async (client: Client) => Number((await client.execute("SELECT count(*) AS n FROM t")).rows[0]!.n);

/** A write transaction that holds the file across an await, as a server action's does. */
async function slowWrite(client: Client, x: number) {
  const tx = await client.transaction("write");
  try {
    await tx.execute({ sql: "INSERT INTO t VALUES (?)", args: [x] });
    await tick(30);
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

describe("the bare local client (why the wrapper exists)", () => {
  it("fails the second of two overlapping writes, and the failure poisons the next transaction on that connection", async () => {
    const bare = open(createClient({ url, concurrency: 1 }));
    const other = open(createClient({ url }));
    const held = await other.transaction("write");
    await expect(bare.execute("INSERT INTO t VALUES (1)")).rejects.toMatchObject({ code: "SQLITE_BUSY" });
    await held.rollback();
    // Nothing holds the file now, yet the connection that saw SQLITE_BUSY can't commit.
    await expect(slowWrite(bare, 2)).rejects.toMatchObject({ code: "SQLITE_BUSY" });
  });
});

describe("serializeWrites", () => {
  it("lets overlapping writes in one process take turns: all of them land", async () => {
    const client = open(createAppClient({ url }));
    await Promise.all([
      slowWrite(client, 1),
      slowWrite(client, 2),
      client.execute("INSERT INTO t VALUES (3)"),
      client.batch(["INSERT INTO t VALUES (4)", "INSERT INTO t VALUES (5)"], "write"),
      slowWrite(client, 6),
    ]);
    expect(await count(client)).toBe(6);
  });

  it("shares the turn between two clients of the same file (UCOMP's and the simulator's)", async () => {
    const ucomp = open(createAppClient({ url }));
    const sim = open(createAppClient({ url }));
    await Promise.all([slowWrite(ucomp, 1), slowWrite(sim, 2), slowWrite(ucomp, 3), sim.execute("INSERT INTO t VALUES (4)")]);
    expect(await count(ucomp)).toBe(4);
  });

  it("doesn't make reads wait for an open transaction", async () => {
    const client = open(createAppClient({ url }));
    const tx = await client.transaction("write");
    await tx.execute("INSERT INTO t VALUES (1)");
    await expect(count(client)).resolves.toBe(0);
    await tx.commit();
    expect(await count(client)).toBe(1);
  });

  it("waits out another process's lock instead of failing (the busy timeout)", async () => {
    const client = open(createAppClient({ url }));
    // A second process takes the write lock and lets go 300ms later.
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const { createClient } = require("@libsql/client");
         (async () => {
           const tx = await createClient({ url: process.argv[1] }).transaction("write");
           process.stdout.write("locked\\n");
           setTimeout(async () => { await tx.rollback(); process.exit(0); }, 300);
         })();`,
        url,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve) => holder.stdout!.once("data", () => resolve()));
    const exited = new Promise((resolve) => holder.once("exit", resolve));

    await slowWrite(client, 1);
    expect(await count(client)).toBe(1);
    await exited;
  });

  it("gives up after its wait with SQLITE_BUSY, which the callers' retries understand, and frees the queue", async () => {
    const client = open(serializeWrites(createClient({ url }), { waitMs: 20 }));
    const tx = await client.transaction("write");
    await expect(client.execute("INSERT INTO t VALUES (1)")).rejects.toMatchObject({ code: "SQLITE_BUSY" });
    await tx.rollback();
    await client.execute("INSERT INTO t VALUES (2)");
    expect(await count(client)).toBe(1);
  });

  it("releases the turn however the transaction ends: commit, rollback, close, or a BEGIN that failed", async () => {
    const client = open(serializeWrites(createClient({ url }), { waitMs: 200 }));
    await (await client.transaction("write")).rollback();
    (await client.transaction("write")).close();
    await (await client.transaction("write")).commit();
    await client.execute("INSERT INTO t VALUES (1)");
    expect(await count(client)).toBe(1);

    const failing = serializeWrites(
      { transaction: () => Promise.reject(Object.assign(new Error("locked"), { code: "SQLITE_BUSY" })) } as unknown as Client,
      { waitMs: 200 },
    );
    await expect(failing.transaction("write")).rejects.toThrow("locked");
    await client.execute("INSERT INTO t VALUES (2)");
    expect(await count(client)).toBe(2);
  });
});
