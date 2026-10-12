import path from "node:path";

/**
 * `absolute` relative to `root`, spelled with `/` on every operating system: the spelling git, the docs and
 * the lint scripts use. `path.relative` gives `docs\README.md` on Windows. `pathApi` is `path.posix` or
 * `path.win32`, so a test can check the Windows result on any machine.
 */
export function repoPath(
  root: string,
  absolute: string,
  pathApi: Pick<typeof path, "relative" | "sep"> = path,
): string {
  const relative = pathApi.relative(root, absolute);
  return pathApi.sep === "\\" ? relative.replaceAll("\\", "/") : relative;
}
