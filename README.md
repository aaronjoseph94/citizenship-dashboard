# Canadian Citizenship Tracker

A personal dashboard for tracking a Canadian citizenship grant application from submission to oath, then the passport.
Built from the design handoff (Overview / Process / Passport). Your own data (dates, stages, notes, checklists) stays in
the browser's localStorage (`citizenship-tracker-v1`).

## Auto-updated wait times

`scripts/fetch-data.mjs` writes `public/data/wait-times.json`, which fills the **Average wait times** table
(blue numbers) and the estimate bands. Type in a cell to override a value; clear it to go back to the fetched one.

| Column | Source | How |
| --- | --- | --- |
| IRCC | canada.ca processing-times data | IRCC's processing-time JSON, falling back to the processing-times page. Last published figure (12 months) is kept if both fail. |
| Reddit 2026 / 2025 | r/ImmigrationCanada citizenship megathreads | Comments are pulled from Reddit (OAuth if secrets are set, else the public `.json` endpoint), falling back to the Arctic Shift and PullPush archives when Reddit blocks the runner. Free-form timelines ("Applied Feb 2026, AOR May, Test Jul, Oath Oct") are parsed and the **median** of each span is used (needs ≥2 timelines). |
| ImmiTracker | public Power BI report | Queries the report's public `querydata` API and picks single-value visuals whose names describe a span (e.g. "AOR to Oath days"). Everything it read is dumped to `public/data/immitracker-raw.json` for checking. |

"Total" means AOR → oath, matching IRCC's published figure.

### Schedule and deploy

The site is hosted on **Cloudflare Workers** (static assets only, see `wrangler.jsonc`).
`.github/workflows/update-and-deploy.yml` runs every 2 days (and on manual dispatch): fetch → commit the JSON →
build → `wrangler deploy`. Pushes to `main` just rebuild and deploy.

One-time setup:
1. Make `main` the repository's default branch (Settings → General → Default branch). GitHub only runs scheduled
   workflows on the default branch.
2. In Cloudflare, create an API token with the **Edit Cloudflare Workers** template (My Profile → API Tokens), and copy
   your Account ID (Workers & Pages overview, right-hand column).
3. Add them as GitHub repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   (Settings → Secrets and variables → Actions). Without them the deploy step is skipped with a warning.
4. Run the workflow once from the Actions tab. The site appears at
   `https://citizenship-dashboard.<your-subdomain>.workers.dev`; add a custom domain in the Cloudflare dashboard if you like.
5. Optional but recommended for reliability: create a Reddit "script" app at <https://www.reddit.com/prefs/apps> and add
   `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` as repository secrets. Reddit blocks most unauthenticated requests from
   cloud IPs; the archive fallbacks cover that but can lag by a few days.

Manual deploy from your machine: `npx wrangler login`, then `npm run deploy`.

## Develop

```sh
npm install
npm run dev          # local app
npm run fetch-data   # refresh public/data/wait-times.json
npm run build        # static build in dist/
npm run deploy       # build + wrangler deploy (needs `npx wrangler login` first)
```
