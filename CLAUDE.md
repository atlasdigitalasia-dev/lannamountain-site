# Lanna Mountain Agency Dashboard

## What this is
A self-contained agency client dashboard MVP. Single-file React frontend + Node/Express backend. Built for Tom Willis (founder, Lanna Mountain Marketing) to manage SEO, GA4, GSC, GBP, and rank tracking for clients.

## Stack
- **Frontend**: `agency-dashboard-mvp.html` — single HTML file, React 18 via CDN, Babel standalone, no build step
- **Backend**: `agency-dashboard-backend/server.js` — Node.js + Express on port 3001
- **Data**: flat JSON files in `agency-dashboard-backend/data/`
- **Config**: `agency-dashboard-backend/clients-config.json` — client list + integration IDs

## Running the project
```bash
cd agency-dashboard-backend
node server.js
```
Then open: http://localhost:3001/agency-dashboard-mvp.html

## Key files
| File | Purpose |
|------|---------|
| `agency-dashboard-mvp.html` | Entire frontend (~2,438 lines) |
| `agency-dashboard-backend/server.js` | All API endpoints (~1,016 lines) |
| `agency-dashboard-backend/clients-config.json` | Client list, GA4 IDs, GSC URLs, domains |
| `agency-dashboard-backend/.env` | DataForSEO credentials (DO NOT COMMIT) |
| `agency-dashboard-backend/tokens.json` | Google OAuth tokens |
| `agency-dashboard-backend/data/ranks-{clientId}.json` | Stored rank history per client |

## Frontend architecture
- Single `window.api` object at top of file handles all HTTP calls to backend
- Each major section is a React component: `ClientListPage`, `ClientDashboardPage`, `RankDetailPage`, `GA4DetailPage`, `GSCDetailPage`, `GBPDetailPage`
- `useLiveData(fetcher, mockData)` hook — fetches live data, falls back to mock on error
- `integView` state in `ClientDashboardPage` controls which detail panel is visible: `null | 'ga4' | 'gsc' | 'gbp' | 'rank'`
- Report generation: `handleGenerateReport()` in `ClientDashboardPage` → calls `window.open('', '_blank')` → writes HTML report to new window

## Backend API endpoints
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/clients` | List all clients |
| GET | `/api/clients/:id` | Get single client |
| POST | `/api/clients` | Create client |
| PUT | `/api/clients/:id` | Update client config |
| GET | `/api/ga4/:clientId` | GA4 metrics |
| GET | `/api/gsc/:clientId` | Search Console data |
| GET | `/api/gbp/:clientId` | Google Business Profile data |
| GET | `/api/rank/:clientId/overview` | Rank KPIs + keyword table |
| GET | `/api/rank/:clientId/keywords` | Saved keywords + config |
| POST | `/api/rank/:clientId/keywords` | Save keywords + domain + location |
| POST | `/api/rank/:clientId/check` | Trigger live DataForSEO rank check |
| GET | `/api/report/:clientId/data` | Report data (GA4 + GSC combined) |

## Integrations
- **Google OAuth**: service account JSON in `agency-dashboard-backend/` — used for GA4 + GSC
- **DataForSEO**: Basic Auth, credentials in `.env` as `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`
- **GBP**: uses same Google OAuth service account

## Known issues / pending work
- **GA4 property ID for Lanna Mountain is wrong** — `clients-config.json` has `448494823` which belongs to "Be Li Tailor" (belitailor.com). Tom needs to update this to the correct Lanna Mountain GA4 property ID.
- **GSC permission issue** — `atlasdigital.asia@gmail.com` has `siteUnverifiedUser` access only. Needs `siteOwner` or `siteFullUser` in Google Search Console settings for `lannamountain.io`.
- **Rank check depth** — currently checks top 100 results (DataForSEO). Keywords not in top 100 return `position: null`.
- **Debug logging** — `console.log` for top 5 organic results left in rank check endpoint (remove when done debugging).

## Report design
The generated report (`handleGenerateReport`) includes:
1. Dark gradient header (client name, date, domain, agency branding)
2. Keyword Rankings section (KPI cards + full table with colour-coded position badges)
3. GA4 section (6 KPI cards with % change, traffic channel bars, top pages table)
4. GSC section (4 KPI cards, top queries, top pages) — gracefully shows "not configured" if unavailable
5. Sticky print bar with "Print / Save PDF" + "Close" buttons (hidden on print)

## Brand
- Agency: Lanna Mountain Marketing
- Services: AI Voice Agents, Agentic SEO, Local SEO
- Markets: AU, NZ, ASEAN, UK
- Brand green: `#1A7A3C`
- Website: lannamountain.io
- Founder: Tom Willis

## Social media content (separate from dashboard)
- 12 ready-to-post FB/Instagram graphics in `posts/` folder (1080×1080 PNG)
- Full content calendar in `content-calendar-apr2026.html`
- Monthly auto-generation scheduled for 25th of each month at 9am

## How to work with Tom
- **Be decisive.** Pick one approach, think it through fully, and commit. Do not suggest alternatives mid-task unless the current approach has definitively failed.
- **Never mention Netlify.** Tom uses Hostinger. Do not suggest Netlify workflows, tools, or deployments.
- **Verify tool access before claiming it.** Don't say you can do something via an MCP or tool without confirming it's actually connected and available.
- **Don't over-explain or over-complicate.** Tom is experienced — give clear, direct answers.
- **Always use API/native tools first.** Only fall back to browser automation (Claude in Chrome) as a last resort.
