import grid from "./audit-grid.module.css";

/** The grid classes shared by the audit table and its skeleton (see audit-grid.module.css). */
export const AUDIT_TABLE = grid.table;

export function auditGrid(showTeam: boolean) {
  return `${grid.grid} ${showTeam ? grid.withTeam : grid.noTeam}`;
}

/** Each column's header and its cell's place in the grid, in reading order. */
export const AUDIT_CELL = {
  when: grid.when,
  who: grid.who,
  team: grid.team,
  tpl: grid.tpl,
  act: grid.act,
  det: grid.det,
} as const;

export function auditHeads(showTeam: boolean): { label: string; area: string }[] {
  return [
    { label: "When", area: grid.when },
    { label: "Who", area: grid.who },
    ...(showTeam ? [{ label: "Team", area: grid.team }] : []),
    { label: "Template", area: grid.tpl },
    { label: "Action", area: grid.act },
    { label: "Details", area: grid.det },
  ];
}

/** The filter chips' row: its height is kept with no chips, so the first chip doesn't push the table down. */
export const CHIP_ROW = "mt-3 min-h-7";

/** Every row is this tall at least (two lines in When and in Details). */
export const AUDIT_ROW = "min-h-14";
