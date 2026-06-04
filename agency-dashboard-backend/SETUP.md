# Agency Dashboard — Backend Setup Guide

## What this does
This Express server connects your agency dashboard to real Google APIs.
Once running, the dashboard at `agency-dashboard-mvp.html` switches from demo data
to **live GA4 sessions, users, traffic and GSC clicks, impressions, CTR, positions**.

---

## Step 1 — Google Cloud Console setup (10 min)

### 1a. Enable APIs
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select your existing project (or create a new one)
3. **APIs & Services → Library**, search for and **Enable** each of these:
   - **Google Analytics Data API**
   - **Google Search Console API**
   - *(Sprint 2)* Business Profile Performance API

### 1b. Create OAuth 2.0 Credentials
1. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Name: `Agency Dashboard (local dev)`
4. **Authorised redirect URIs** — add exactly:
   ```
   http://localhost:3001/auth/google/callback
   ```
5. Click **Create**
6. Copy your **Client ID** and **Client Secret**

### 1c. OAuth Consent Screen
1. **APIs & Services → OAuth consent screen**
2. User type: **External** (or Internal if you have Google Workspace)
3. Fill in App name, support email
4. Under **Scopes**, add:
   - `.../auth/analytics.readonly`
   - `.../auth/webmasters.readonly`
5. Under **Test users** (while in testing mode), add your own Gmail address

---

## Step 2 — Configure your .env file

```bash
# In the agency-dashboard-backend folder:
cp .env.example .env
```

Edit `.env` and paste in your credentials:
```
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
SESSION_SECRET=any-long-random-string-here
```

---

## Step 3 — Start the server

```bash
# Open a terminal in the agency-dashboard-backend folder
cd "C:\Users\[YourName]\LannaMountain\agency-dashboard-backend"

# Install dependencies (first time only)
npm install

# Start the server
node server.js
```

You should see:
```
🏔️  Lanna Mountain Agency Dashboard
   Backend running at: http://localhost:3001
   Dashboard:          http://localhost:3001/agency-dashboard-mvp.html
```

---

## Step 4 — Open the dashboard & connect Google

1. Open your browser to: **http://localhost:3001/agency-dashboard-mvp.html**
2. You'll see a blue banner: **"Connect your Google account"**
3. Click the button — this opens the Google OAuth screen
4. Sign in with the Google account that has access to your clients' GA4 and GSC properties
5. Grant the requested permissions
6. You'll be redirected back to the dashboard with a green **"Live data active"** bar

---

## Step 5 — Add GA4 Property IDs and GSC URLs per client

For each client whose data you want to see:
1. Click on the client → **Data Sources** tab
2. Click **"Edit Configuration"** on GA4 or GSC
3. A dropdown will appear showing all properties you have access to — select the right one
4. Click **"Save & Load Live Data"**

The dashboard will immediately start showing real metrics.

---

## Folder structure

```
agency-dashboard-backend/
├── server.js           ← Main Express app + all API routes
├── package.json
├── .env                ← Your secrets (never commit this)
├── .env.example        ← Template
├── tokens.json         ← Auto-created: stores your OAuth tokens
├── clients-config.json ← Auto-created: stores GA4/GSC config per client
├── node_modules/
└── SETUP.md            ← This file
```

---

## API endpoints reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/google` | Start OAuth flow |
| GET | `/auth/status` | Check if connected |
| POST | `/auth/google/disconnect` | Revoke tokens |
| GET | `/api/ga4/accounts` | List all accessible GA4 properties |
| GET | `/api/ga4/:propertyId/overview?range=30d` | Sessions, users, pageviews, bounce rate + % change |
| GET | `/api/ga4/:propertyId/trend?range=30d` | Daily sessions + users for line chart |
| GET | `/api/ga4/:propertyId/channels?range=30d` | Traffic source breakdown |
| GET | `/api/ga4/:propertyId/pages?range=30d` | Top pages |
| GET | `/api/gsc/sites` | List all GSC sites you have access to |
| GET | `/api/gsc/:siteUrl/overview?range=30d` | Clicks, impressions, CTR, position + trend |
| GET | `/api/gsc/:siteUrl/queries?range=30d` | Top search queries |
| GET | `/api/gsc/:siteUrl/pages?range=30d` | Top pages in GSC |
| GET | `/api/health` | Server status + auth check |

---

## Troubleshooting

**"redirect_uri_mismatch" error**
→ Make sure your redirect URI in Google Cloud Console is exactly `http://localhost:3001/auth/google/callback`

**"Access Not Configured" error**
→ The API isn't enabled in your Google Cloud project — go to APIs & Library and enable it

**No properties showing in the dropdown**
→ Your Google account needs to be added as a Viewer (or higher) in the client's GA4 property and GSC site

**Tokens expired (401 error)**
→ Disconnect and reconnect Google — the server will get a fresh refresh token

---

## Sprint 2 — Coming next
- Google Business Profile (views, calls, directions, reviews)
- Meta (Facebook Pages + Instagram Business API)
- DataForSEO rank tracking (daily keyword positions)
- Automated PDF report generation
- Per-client login portal with restricted data access
