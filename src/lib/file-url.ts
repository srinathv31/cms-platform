import path from "node:path";

// Local SQLite files are named by a libSQL `file:` URL (`DATABASE_URL`). libSQL reads the part after
// `file:` as a path: relative to the working directory, or absolute, with an optional `//` and an empty or
// `localhost` host in front, and percent-decoded (so `#`, `?` and `%` in a folder name must be escaped).
// These two functions turn such a URL into the path it names and back, for either operating system's
// path rules, which a test can pick with `path.posix` or `path.win32`.
//
// What Windows adds: a path starts with a drive letter, not a slash, and `\` separates its folders.
// libSQL opens `file:C:/dir/app.db` and `file:C:\dir\app.db` alike; `file:///C:/dir/app.db` leaves a slash
// before the drive letter, which Windows can't open. So the URL built here has the drive letter right
// after `file:` and uses `/`, a spelling a shell passes on unchanged too (Git Bash eats backslashes).
// A UNC path (`\\server\share\app.db`, `\\wsl$\Ubuntu\home\app.db`) needs two more slashes: `file://server/share`
// would read `server` as a host, which libSQL refuses. `file:////server/share/app.db` has an empty host and the
// path `//server/share/app.db`, which Windows opens as the UNC path. (Read off @libsql/core's `parseUri` and
// checked against the local driver with the same shape on a POSIX path; not run against a share.)

type PathApi = Pick<typeof path, "resolve" | "sep">;

/** `file:`, an optional `//host`, then the path, with no query or fragment. */
const FILE_URL = /^file:(?:\/\/([^/?#]*))?([^?#]*)$/u;

/**
 * The absolute path a `file:` URL names, resolved against `cwd`; null when `url` isn't a plain `file:`
 * URL (another scheme such as `libsql://`, a query or fragment, or a host libSQL refuses), so the
 * caller can pass it on unchanged.
 */
export function filePathOfUrl(
  url: string,
  cwd: string = process.cwd(),
  pathApi: PathApi = path,
): string | null {
  const match = FILE_URL.exec(url);
  if (match === null) return null;
  const host = match[1] ?? "";
  if (host !== "" && host.toLowerCase() !== "localhost") return null;
  let file: string;
  try {
    file = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  // "/C:/dir/app.db": the slash in front of a drive letter is URL syntax, not part of the path.
  if (pathApi.sep === "\\") file = file.replace(/^\/(?=[A-Za-z]:)/, "");
  return pathApi.resolve(cwd, file);
}

/**
 * The `file:` URL for an absolute path, spelled so libSQL reads back the same path on either operating
 * system: `/` between folders, and `%`, `#` and `?` escaped.
 */
export function fileUrlOfPath(
  file: string,
  pathApi: Pick<typeof path, "sep"> = path,
): string {
  const slashes = pathApi.sep === "\\" ? file.replaceAll("\\", "/") : file;
  const escaped = slashes.replace(/[%#?]/g, encodeURIComponent);
  // A path that begins with two slashes (a UNC path on Windows) must not run into the URL's own `//`.
  return escaped.startsWith("//") ? `file://${escaped}` : `file:${escaped}`;
}
