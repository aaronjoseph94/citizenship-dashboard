# Working in this repo

## Multi-agent work: use separate background agents
When a task benefits from several agents (reviews, bug hunts, research, verification), launch them as
separate background subagents with the Agent tool (`run_in_background: true`), all in one message so they
run concurrently. Do not use the Workflow tool for this: its runner caps concurrency at CPUs − 2, which is
only 2 agents at a time on the 4-CPU cloud containers used here.

- Fan out finders in one message, collect their results as they finish, dedupe, then fan out verifiers the
  same way (e.g. 3 independent skeptics per finding; keep a finding only if at least 2 confirm it).
- Give each agent its own scratch subdirectory and tell it not to edit the repo when it is only reviewing.
  Parallel builds must use separate output dirs (`npx vite build --outDir <scratch>/dist --emptyOutDir`),
  and browser checks must use distinct ports.
- Put shared instructions in one file in the scratchpad and have each agent read it, rather than repeating
  long prompts.

## Project notes
- React 19 + Vite 8 app in `src/`; data fetcher `scripts/fetch-data.mjs` writes `public/data/wait-times.json`.
- `.github/workflows/update-and-deploy.yml` refreshes data every 2 days and deploys to Cloudflare Workers
  (`wrangler.jsonc`). Deploys need the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
- `worker/index.js` gates the whole site behind a password (hash in `wrangler.jsonc` `SITE_PASSWORD_HASH`, or a
  `SITE_PASSWORD` secret) and syncs user data across devices via the Durable Object `TrackerState` (`/api/state`).
  Never commit the plaintext password. Test locally with `npm run build && npx wrangler dev`.
- The owner asked for no automated tests; verify changes with builds, offline script runs and browser checks.
