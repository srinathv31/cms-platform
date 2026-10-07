# UCOMP

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

To present UCOMP to a new audience, follow the step-by-step [demo script](docs/demo-script.md).

## Checks

```bash
npm run typecheck
npm run lint
npm test         # vitest
npm run build && npm run e2e   # Playwright, against the production build (resets the demo DB)
```
