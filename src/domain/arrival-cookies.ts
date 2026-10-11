// The one-shot cookie a new template arrives with. `createTemplate` (src/server/actions/create-template.ts)
// and `POST /api/imports` set it as they answer; the workspace's name field takes it on arrival and
// selects the name (`takeJustCreated`, src/components/workspace/just-created.ts, which also says why it
// is a cookie and not a URL parameter). The server and the browser both need its name and lifetime, so
// they live here, free of both. The import's second cookie, `JUST_IMPORTED_COOKIE`, is in
// import-types.ts.

/** Holds the id of the template just created. Readable by the page; gone once taken, or after a minute. */
export const JUST_CREATED_COOKIE = "ucomp_created";

/** Long enough to outlast the redirect on a slow connection, short enough not to linger if never taken. */
export const JUST_CREATED_MAX_AGE = 60;
