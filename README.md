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

### Schedule

`.github/workflows/update-and-deploy.yml` runs every 2 days (and on manual dispatch): fetch → commit the JSON → build →
deploy to GitHub Pages. Pushes to `main` just rebuild and deploy.

One-time setup:
1. **Settings → Pages → Source: GitHub Actions.**
2. Optional but recommended for reliability: create a Reddit "script" app at <https://www.reddit.com/prefs/apps> and add
   `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` as repository secrets. Reddit blocks most unauthenticated requests from
   cloud IPs; the archive fallbacks cover that but can lag by a few days.

## Develop

```sh
npm install
npm run dev          # local app
npm run fetch-data   # refresh public/data/wait-times.json
npm run build        # static build in dist/
```
