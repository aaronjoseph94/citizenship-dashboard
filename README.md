# Canadian Citizenship Tracker

A personal dashboard for tracking a Canadian citizenship grant application from submission to oath, then the passport.
Built from the design handoff (Overview / Process / Passport). Your own data (dates, stages, notes, checklists) stays in
the browser's localStorage (`citizenship-tracker-v1`).

## Auto-updated wait times

`scripts/fetch-data.mjs` writes `public/data/wait-times.json`, which fills the **Median wait times** table
(blue numbers) and the estimate bands. Type in a cell to override a value; clear it to go back to the fetched one.

| Column | Source | How |
| --- | --- | --- |
| IRCC | canada.ca processing-times data | `flpt-en.json`, the file IRCC's processing-times tool reads: `current-flpt.citizen-grants` (e.g. "About 12 months"). If it can't be read, the previous figure (12 months) is kept and IRCC is marked unavailable. |
| Reddit 2026 / 2025 | r/ImmigrationCanada citizenship megathreads | Comments are pulled from Reddit (OAuth if secrets are set, else the public `.json` endpoint). When Reddit blocks the runner, Arctic Shift is paged in small batches (`limit=25`, retries/backoff), then PullPush. Free-form timelines ("Applied Feb 2026, AOR May, Test Jul, Oath Oct") are parsed and the **median** of each span is used (needs ≥2 timelines). |
| ImmiTracker | public Power BI report | Queries the report's public `querydata` API (with the report's own filters and slicer selections applied). The Citizenship page is a per-applicant date table; the **median** of each span is used. Named median cards beat average cards; count/min/max cards are ignored. Everything it read is dumped to `public/data/immitracker-raw.json` for checking. |

"Total" means AOR → oath, matching IRCC's published figure.

## Password and your data across devices

The whole site sits behind a password page served by the Worker (`worker/index.js`): the app, its data files and the
API answer only after you log in (a signed, HttpOnly session cookie that lasts 30 days; "Sign out" is in the Process
footer). The repo holds only a salted PBKDF2 hash of the password (`SITE_PASSWORD_HASH` in `wrangler.jsonc`), never the
password itself.

To change the password, either set a `SITE_PASSWORD` secret on the Worker (Cloudflare dashboard → Worker → Settings →
Variables and Secrets, or `npx wrangler secret put SITE_PASSWORD`; it takes precedence over the hash), or generate a new
hash and replace `SITE_PASSWORD_HASH`:

```sh
node -e 'const c=require("crypto"),s=c.randomBytes(16),i=100000;console.log(`pbkdf2-sha256$${i}$${s.toString("base64")}$${c.pbkdf2Sync(process.argv[1],s,i,32,"sha256").toString("base64")}`)' 'new password'
```

Once you're logged in, dates, stages, notes and checklists are saved to a Cloudflare Durable Object as well as the
browser, so they load on any device you log in from; other devices pick up changes when you come back to them, and the
newest edit wins. (`SYNC_TOKEN` is optional and only needed for API access without logging in.)

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
   (Optional: `SYNC_TOKEN`, uploaded to the Worker on each deploy, for API access without logging in.)
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
npx wrangler dev     # after a build: app, password page and sync API locally
```
