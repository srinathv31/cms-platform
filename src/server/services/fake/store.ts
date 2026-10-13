import type { FakeState } from "./state";

// The fake's transactions. A command runs synchronously inside `command()`: JavaScript runs it to the end
// before any other command starts, so two calls at once take turns, as two transactions do in the database.
// Every write goes through the `FakeTx` it is handed and leaves an undo; a throw (a refusal or a bug) undoes
// them all, newest first, so a refused command writes nothing, as a rolled-back transaction doesn't.

type Table = keyof FakeState;
type RowOf<T extends Table> = FakeState[T][number];

/** The writes of one command, each with its undo. Read through `state`. */
export class FakeTx {
  constructor(
    readonly state: FakeState,
    private readonly undo: (() => void)[],
  ) {}

  /** Adds a row. */
  insert<T extends Table>(table: T, row: RowOf<T>): void {
    const rows = this.state[table] as RowOf<T>[];
    rows.push(row);
    this.undo.push(() => {
      const at = rows.lastIndexOf(row);
      if (at >= 0) rows.splice(at, 1);
    });
  }

  /** Changes the fields `patch` names on a row that is in the table. */
  update<T extends Table>(
    table: T,
    row: RowOf<T>,
    patch: Partial<RowOf<T>>,
  ): void {
    if (!(this.state[table] as RowOf<T>[]).includes(row))
      throw new Error(`The row to update isn't in ${table}.`);
    const target = row as Record<string, unknown>;
    const before = Object.fromEntries(
      Object.keys(patch).map((key) => [key, target[key]]),
    );
    Object.assign(target, patch);
    this.undo.push(() => Object.assign(target, before));
  }
}

/** The fake's data, and the one way to change it. */
export class FakeStore {
  constructor(readonly state: FakeState) {}

  /**
   * Runs one command against the state, synchronously (no `await` inside: that would let another command
   * in halfway). What it wrote is undone if it throws, and the throw goes on.
   */
  command<R>(run: (tx: FakeTx) => R): R {
    const undo: (() => void)[] = [];
    try {
      const result = run(new FakeTx(this.state, undo));
      if (result instanceof Promise)
        throw new Error(
          "A fake command runs synchronously: don't await in it.",
        );
      return result;
    } catch (error) {
      for (const step of undo.reverse()) step();
      throw error;
    }
  }
}
