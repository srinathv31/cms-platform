# Stencil

Author, approve and publish customer content. Next.js 16 (App Router, Cache Components) on a local SQLite file.

## Getting started

```bash
npm install
npm run db:reset   # creates data/ucomp.db and seeds the demo
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm run db:reset` also puts the demo back to its starting state at any time.

## Dev server vs. production build

`next dev` compiles each route the first time it's opened, so the first page after a fresh clone can take several seconds on a slower machine. Turbopack caches that work in `.next/`, so later `npm run dev` sessions start much faster. In dev, Next.js also never prefetches links, so a click waits for the destination route to compile and render. The production build prefetches each link's shell, so the destination's skeleton appears immediately and its content streams in.

To see the app the way users get it, with routes prerendered and links prefetched, run the production build:

```bash
npm run demo   # next build && next start
```

To present Stencil to a new audience, follow the step-by-step [demo script](docs/guides/demo-script.md).

## Documentation

Start with [docs/architecture.md](docs/architecture.md), then the README in the `src/` folder you're working in.
[docs/README.md](docs/README.md) maps everything else. [AGENTS.md](AGENTS.md) holds the rules every change follows;
AI agents load it automatically, and it's worth reading before your first change too.

## Checks

```bash
npm run typecheck
npm run lint
npm test         # vitest
npm run docs:check   # links, paths and READMEs in the docs
npm run format:check   # Prettier, default configuration; `npm run format` fixes what it reports
npm run build && npm run e2e   # Playwright, against the production build (4 workers, each with its own server and data/e2e-<n>.db)
```

The formatting commit is listed in [.git-blame-ignore-revs](.git-blame-ignore-revs), so `git blame` can skip it. GitHub
does this by itself; for a local clone run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

If `npm run build` fails on files under `.next/dev/types` (left by an older `next dev`), run `npm run typecheck` once: its
first step deletes that folder.

## Windows

The commands above run on Windows, in PowerShell or cmd.exe, with Node.js 22.12 or newer (Vitest 5's minimum). npm
scripts that set a variable use `cross-env`, so they work in either shell. What differs is the one-off settings the docs
write the Unix way, in front of a command.

| Documented                                                                       | PowerShell                                                                                           |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `E2E_WORKERS=1 npm run e2e`                                                      | `$env:E2E_WORKERS = 1; npm run e2e`                                                                  |
| `E2E_PORT=3000 npx playwright test e2e/principles-*.spec.ts`                     | `$env:E2E_PORT = 3000; npx playwright test principles-` (no glob; see below)                         |
| `DATABASE_URL=file:./data/e2e-0.db UPLOADS_DIR=./data/e2e-uploads-0 npm run dev` | `$env:DATABASE_URL = "file:./data/e2e-0.db"; $env:UPLOADS_DIR = "./data/e2e-uploads-0"; npm run dev` |

- **Variables stay set.** A `$env:` value lasts for the rest of the PowerShell session, so the next `npm run e2e` still
  runs one worker until you clear it with `Remove-Item Env:E2E_WORKERS`.
- **No globs.** PowerShell and cmd.exe don't expand `e2e/principles-*.spec.ts`, and Playwright reads each argument as a
  regular expression on the file path. Give it a fragment of the name instead: `npx playwright test principles-`.
- **Line endings.** [.gitattributes](.gitattributes) keeps text files LF whatever `core.autocrlf` says. The render golden
  files are compared byte for byte and Prettier expects LF. If your editor saves CRLF, `npm run format` puts it back.
- **Database URLs.** `file:./data/app.db` and `file:C:/work/stencil/data/app.db` work; write `/` between folders, and
  escape `#`, `?` and `%` in a folder name as `%23`, `%3F` and `%25`.
- **Sync folders.** Keep the checkout out of OneDrive and Dropbox. They hold files open while they sync, which SQLite
  and `npm run db:reset` don't tolerate.
- **Symlinks.** The 14 links under `.claude/skills/` point into `.agents/` (agent tooling, which nothing in the app
  reads). Without symlink support, git writes each as a one-line text file. Ignore them, or turn on Developer Mode and set
  `git config core.symlinks true` before cloning.
- **Recording tools.** `npm run gate:media` and `e2e/qa/contact-sheet.mjs` were built on macOS: they call `ffmpeg` at a
  Homebrew path (set `FFMPEG` to override it) and `sips`. The rest of e2e doesn't need either.
