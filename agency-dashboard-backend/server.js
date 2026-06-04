// ══════════════════════════════════════════════════════════════════
//  Lanna Mountain — Agency Dashboard Backend
//  Node.js / Express — GA4, GSC, Google Business Profile APIs
// ══════════════════════════════════════════════════════════════════
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const session    = require('express-session');
const path       = require('path');
const fs         = require('fs');
const { google } = require('googleapis');
const fetch      = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:5500',   // Live Server extension
    'null',                    // file:// opened directly
  ],
  credentials: true,
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// Serve the dashboard HTML as the root
app.use(express.static(path.join(__dirname, '..')));

// ── Token Storage (file-based for local dev) ─────────────────────
// In production you'd use a database encrypted at rest
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveTokens(data) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
}

// Client config storage (GA4 property IDs, GSC site URLs per client)
const CLIENTS_FILE = path.join(__dirname, 'clients-config.json');

function loadClients() {
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return { clients: [] };
}

function saveClients(data) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(data, null, 2));
}

// ── Google OAuth Client ──────────────────────────────────────────
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback'
  );
}

// Required Google API scopes
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',      // GA4
  'https://www.googleapis.com/auth/webmasters.readonly',     // GSC
  'https://www.googleapis.com/auth/business.manage',         // GBP (sprint 2)
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function getAuthenticatedClient() {
  const tokens = loadTokens();
  if (!tokens.google) return null;
  const oAuth2Client = createOAuthClient();
  oAuth2Client.setCredentials(tokens.google);
  return oAuth2Client;
}

// ══════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════════

// Step 1: Start OAuth flow
app.get('/auth/google', (req, res) => {
  const oAuth2Client = createOAuthClient();
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
    prompt: 'consent', // force refresh token even if already granted
  });
  res.redirect(url);
});

// Step 2: OAuth callback — exchange code for tokens
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.redirect(`/agency-dashboard-mvp.html?auth_error=${encodeURIComponent(error)}`);
  }
  try {
    const oAuth2Client = createOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Store tokens + user info
    const stored = loadTokens();
    stored.google = { ...tokens, email: userInfo.email, name: userInfo.name };
    saveTokens(stored);

    res.redirect('/agency-dashboard-mvp.html?auth_success=google');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`/agency-dashboard-mvp.html?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// Revoke / disconnect
app.post('/auth/google/disconnect', async (req, res) => {
  const stored = loadTokens();
  if (stored.google?.access_token) {
    try {
      const oAuth2Client = createOAuthClient();
      await oAuth2Client.revokeToken(stored.google.access_token);
    } catch (e) { /* ignore revoke errors */ }
  }
  delete stored.google;
  saveTokens(stored);
  res.json({ success: true });
});

// Check auth status
app.get('/auth/status', (req, res) => {
  const tokens = loadTokens();
  res.json({
    google: tokens.google
      ? { connected: true, email: tokens.google.email, name: tokens.google.name }
      : { connected: false },
  });
});

// ══════════════════════════════════════════════════════════════════
//  CLIENT CONFIG ROUTES
// ══════════════════════════════════════════════════════════════════

// Get all clients with their API config
app.get('/api/clients', (req, res) => {
  res.json(loadClients());
});

// Save / update a client's API properties
app.post('/api/clients', (req, res) => {
  const { id, name, domain, ga4PropertyId, gscSiteUrl, gbpAccountId, gbpLocationId } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });

  const config = loadClients();
  const existing = config.clients.findIndex(c => c.id === id);
  const client = { id, name, domain, ga4PropertyId, gscSiteUrl, gbpAccountId, gbpLocationId, updatedAt: new Date().toISOString() };

  if (existing >= 0) {
    config.clients[existing] = { ...config.clients[existing], ...client };
  } else {
    config.clients.push(client);
  }
  saveClients(config);
  res.json({ success: true, client });
});

// ══════════════════════════════════════════════════════════════════
//  GA4 ROUTES
// ══════════════════════════════════════════════════════════════════

// Helper: run a GA4 report
async function runGA4Report({ propertyId, metrics, dimensions, dateRange, dimensionFilter, orderBys, limit }) {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated with Google');

  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
  const response = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: dateRange ? [dateRange] : [{ startDate: '30daysAgo', endDate: 'today' }],
      metrics: metrics.map(m => ({ name: m })),
      dimensions: dimensions ? dimensions.map(d => ({ name: d })) : undefined,
      dimensionFilter,
      orderBys,
      limit: limit || 1000,
    },
  });
  return response.data;
}

// GA4: Overview KPIs (sessions, users, pageviews, bounce rate)
app.get('/api/ga4/:propertyId/overview', async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { startDate, endDate, prevStart, prevEnd, compare } = getDateRange(req.query);

    const [currentData, previousData] = await Promise.all([
      runGA4Report({
        propertyId,
        metrics: ['sessions', 'totalUsers', 'screenPageViews', 'bounceRate', 'averageSessionDuration', 'newUsers'],
        dateRange: { startDate, endDate },
      }),
      prevStart ? runGA4Report({
        propertyId,
        metrics: ['sessions', 'totalUsers', 'screenPageViews', 'bounceRate', 'newUsers'],
        dateRange: { startDate: prevStart, endDate: prevEnd },
      }) : Promise.resolve(null),
    ]);

    const cur  = parseGA4Row(currentData.rows?.[0], currentData.metricHeaders);
    const prev = previousData ? parseGA4Row(previousData.rows?.[0], previousData.metricHeaders) : null;

    res.json({
      current: cur,
      previous: prev,
      compareLabel: compare === 'prev-year' ? 'vs prev year' : compare === 'none' ? null : 'vs prev period',
      changes: prev ? {
        sessions:        pctChange(cur.sessions,        prev.sessions),
        totalUsers:      pctChange(cur.totalUsers,      prev.totalUsers),
        screenPageViews: pctChange(cur.screenPageViews, prev.screenPageViews),
        bounceRate:      pctChange(cur.bounceRate,      prev.bounceRate),
        newUsers:        pctChange(cur.newUsers,        prev.newUsers),
        avgSessionDuration: pctChange(cur.averageSessionDuration, prev.averageSessionDuration),
      } : null,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GA4: Daily sessions + users trend (for line chart)
app.get('/api/ga4/:propertyId/trend', async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { startDate, endDate } = getDateRange(req.query);

    const data = await runGA4Report({
      propertyId,
      metrics: ['sessions', 'totalUsers'],
      dimensions: ['date'],
      dateRange: { startDate, endDate },
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    });

    const rows = (data.rows || []).map(row => ({
      date:    formatGA4Date(row.dimensionValues[0].value),
      sessions: parseInt(row.metricValues[0].value || 0),
      users:    parseInt(row.metricValues[1].value || 0),
    }));

    res.json({ rows });
  } catch (err) {
    handleError(res, err);
  }
});

// GA4: Channel / traffic source breakdown
app.get('/api/ga4/:propertyId/channels', async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { startDate, endDate } = getDateRange(req.query);

    const data = await runGA4Report({
      propertyId,
      metrics: ['sessions', 'totalUsers'],
      dimensions: ['sessionDefaultChannelGrouping'],
      dateRange: { startDate, endDate },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    });

    const total = (data.rows || []).reduce((sum, r) => sum + parseInt(r.metricValues[0].value || 0), 0);
    const rows = (data.rows || []).map(row => ({
      channel:  row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value || 0),
      users:    parseInt(row.metricValues[1].value || 0),
      pct:      total > 0 ? Math.round((parseInt(row.metricValues[0].value || 0) / total) * 100) : 0,
    }));

    res.json({ rows, total });
  } catch (err) {
    handleError(res, err);
  }
});

// GA4: Top pages
app.get('/api/ga4/:propertyId/pages', async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { startDate, endDate } = getDateRange(req.query);

    const data = await runGA4Report({
      propertyId,
      metrics: ['screenPageViews', 'sessions', 'averageSessionDuration', 'bounceRate'],
      dimensions: ['pagePath', 'pageTitle'],
      dateRange: { startDate, endDate },
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 20,
    });

    const rows = (data.rows || []).map(row => ({
      path:     row.dimensionValues[0].value,
      title:    row.dimensionValues[1].value,
      views:    parseInt(row.metricValues[0].value || 0),
      sessions: parseInt(row.metricValues[1].value || 0),
      avgDuration: parseFloat(row.metricValues[2].value || 0).toFixed(0),
      bounceRate:  (parseFloat(row.metricValues[3].value || 0) * 100).toFixed(1),
    }));

    res.json({ rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════
//  GSC ROUTES
// ══════════════════════════════════════════════════════════════════

function getWebmastersClient() {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated with Google');
  return google.searchconsole({ version: 'v1', auth });
}

// GSC: Overview KPIs + daily trend
app.get('/api/gsc/:siteUrl/overview', async (req, res) => {
  try {
    const siteUrl = decodeURIComponent(req.params.siteUrl);
    const { startDate, endDate, prevStart, prevEnd, compare } = getDateRange(req.query);

    const webmasters = getWebmastersClient();

    const [totalsRes, trendRes, prevRes] = await Promise.all([
      webmasters.searchanalytics.query({ siteUrl, requestBody: { startDate, endDate, dimensions: [], rowLimit: 1 } }),
      webmasters.searchanalytics.query({ siteUrl, requestBody: { startDate, endDate, dimensions: ['date'], rowLimit: 90 } }),
      prevStart ? webmasters.searchanalytics.query({ siteUrl, requestBody: { startDate: prevStart, endDate: prevEnd, dimensions: [], rowLimit: 1 } }) : Promise.resolve(null),
    ]);

    const cur  = totalsRes.data.rows?.[0] || { clicks:0, impressions:0, ctr:0, position:0 };
    const prev = prevRes?.data?.rows?.[0] || null;

    res.json({
      current: {
        clicks:      cur.clicks || 0,
        impressions: cur.impressions || 0,
        ctr:         ((cur.ctr || 0) * 100).toFixed(2),
        position:    (cur.position || 0).toFixed(1),
      },
      compareLabel: compare === 'prev-year' ? 'vs prev year' : compare === 'none' ? null : 'vs prev period',
      changes: prev ? {
        clicks:      pctChange(cur.clicks,      prev.clicks),
        impressions: pctChange(cur.impressions, prev.impressions),
        ctr:         pctChange(cur.ctr,         prev.ctr),
        position:    prev.position ? -(pctChange(cur.position, prev.position)) : null,
      } : null,
      trend: (trendRes.data.rows || []).map(row => ({
        date:        row.keys[0],
        clicks:      row.clicks || 0,
        impressions: row.impressions || 0,
        ctr:         ((row.ctr || 0) * 100).toFixed(2),
        position:    (row.position || 0).toFixed(1),
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GSC: Top queries (keyword-level data)
app.get('/api/gsc/:siteUrl/queries', async (req, res) => {
  try {
    const siteUrl = decodeURIComponent(req.params.siteUrl);
    const { startDate, endDate } = getDateRange(req.query);
    const { limit = 25 } = req.query;

    const webmasters = getWebmastersClient();
    const data = await webmasters.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: parseInt(limit),
        orderBy: 'clicks',
      },
    });

    res.json({
      rows: (data.data.rows || []).map(row => ({
        query:       row.keys[0],
        clicks:      row.clicks || 0,
        impressions: row.impressions || 0,
        ctr:         ((row.ctr || 0) * 100).toFixed(2),
        position:    (row.position || 0).toFixed(1),
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GSC: Top pages
app.get('/api/gsc/:siteUrl/pages', async (req, res) => {
  try {
    const siteUrl = decodeURIComponent(req.params.siteUrl);
    const { startDate, endDate } = getDateRange(req.query);

    const webmasters = getWebmastersClient();
    const data = await webmasters.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: 25,
        orderBy: 'clicks',
      },
    });

    res.json({
      rows: (data.data.rows || []).map(row => ({
        page:        row.keys[0],
        clicks:      row.clicks || 0,
        impressions: row.impressions || 0,
        ctr:         ((row.ctr || 0) * 100).toFixed(2),
        position:    (row.position || 0).toFixed(1),
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GSC: Available sites (so user can see what properties they have access to)
app.get('/api/gsc/sites', async (req, res) => {
  try {
    const webmasters = getWebmastersClient();
    const { data } = await webmasters.sites.list();
    res.json({
      sites: (data.siteEntry || []).map(s => ({
        url:             s.siteUrl,
        permissionLevel: s.permissionLevel,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GA4: Available accounts/properties (so user can see what they have access to)
app.get('/api/ga4/accounts', async (req, res) => {
  try {
    const auth = getAuthenticatedClient();
    if (!auth) throw new Error('Not authenticated');

    const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth });
    const { data } = await analyticsAdmin.accounts.list();

    // Fetch properties for each account
    const accounts = [];
    for (const account of (data.accounts || [])) {
      const propsResponse = await analyticsAdmin.properties.list({
        filter: `parent:${account.name}`,
      });
      accounts.push({
        name:        account.name,
        displayName: account.displayName,
        properties:  (propsResponse.data.properties || []).map(p => ({
          name:        p.name,
          id:          p.name.replace('properties/', ''),
          displayName: p.displayName,
          websiteUrl:  p.websiteUrl,
        })),
      });
    }
    res.json({ accounts });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════
//  GBP ROUTES
// ══════════════════════════════════════════════════════════════════

// Helper: authenticated fetch against a Google Business Profile API
async function gbpFetch(baseUrl, path, auth) {
  const { token } = await auth.getAccessToken();
  const url = `${baseUrl}/${path}`;
  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await r.text();
  if (!r.ok) {
    const err = new Error(`GBP API ${r.status}: ${body.slice(0, 200)}`);
    err.code = r.status;
    throw err;
  }
  return JSON.parse(body);
}

const GBP_ACCT_BASE  = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const GBP_INFO_BASE  = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const GBP_PERF_BASE  = 'https://businessprofileperformance.googleapis.com/v1';

// GBP: List accounts + their locations
app.get('/api/gbp/accounts', async (req, res) => {
  try {
    const auth = getAuthenticatedClient();
    if (!auth) throw new Error('Not authenticated');

    const acctData = await gbpFetch(GBP_ACCT_BASE, 'accounts', auth);
    const accounts  = acctData.accounts || [];

    const result = [];
    for (const account of accounts) {
      const accountId = account.name; // "accounts/12345678"
      let locations = [];
      try {
        const locData = await gbpFetch(
          GBP_INFO_BASE,
          `${accountId}/locations?readMask=name,title,storefrontAddress,websiteUri`,
          auth
        );
        locations = (locData.locations || []).map(loc => ({
          name:    loc.name,
          id:      loc.name.replace('locations/', ''),
          title:   loc.title || 'Unnamed location',
          address: loc.storefrontAddress?.addressLines?.[0] || '',
          website: loc.websiteUri || '',
        }));
      } catch (e) {
        console.warn(`Could not fetch locations for ${accountId}: ${e.message}`);
      }
      result.push({
        name:        account.name,
        accountName: account.accountName || account.name,
        type:        account.type,
        locations,
      });
    }
    res.json({ accounts: result });
  } catch (err) {
    handleError(res, err);
  }
});

// GBP: Performance overview (impressions, calls, directions, website clicks)
app.get('/api/gbp/:locationId/overview', async (req, res) => {
  try {
    const auth = getAuthenticatedClient();
    if (!auth) throw new Error('Not authenticated');

    const { locationId } = req.params;
    const { startDate }  = getDateRange(req.query);

    // Convert relative date strings to Y/M/D for GBP API
    const toYMD = d => {
      const ms = d === 'today'         ? Date.now()
               : d.endsWith('daysAgo') ? Date.now() - parseInt(d) * 86400000
               : new Date(d).getTime();
      const dt = new Date(ms);
      return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() };
    };

    const s = toYMD(startDate);
    const e = toYMD('today');

    const dp = [
      `dailyRange.startDate.year=${s.year}`, `dailyRange.startDate.month=${s.month}`, `dailyRange.startDate.day=${s.day}`,
      `dailyRange.endDate.year=${e.year}`,   `dailyRange.endDate.month=${e.month}`,   `dailyRange.endDate.day=${e.day}`,
    ].join('&');

    const locName = `locations/${locationId}`;
    const METRICS = [
      'CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'WEBSITE_CLICKS',
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    ];

    const settled = await Promise.allSettled(
      METRICS.map(m => gbpFetch(GBP_PERF_BASE, `${locName}:getDailyMetricsTimeSeries?dailyMetric=${m}&${dp}`, auth))
    );

    const md = {};
    METRICS.forEach((m, i) => {
      md[m] = settled[i].status === 'fulfilled'
        ? (settled[i].value.timeSeries?.datedValues || [])
        : [];
      if (settled[i].status === 'rejected') console.warn(`GBP metric ${m}: ${settled[i].reason?.message}`);
    });

    const sum = m => md[m].reduce((s, d) => s + (parseInt(d.value) || 0), 0);

    const calls           = sum('CALL_CLICKS');
    const directions      = sum('BUSINESS_DIRECTION_REQUESTS');
    const websiteClicks   = sum('WEBSITE_CLICKS');
    const impDesktopMaps  = sum('BUSINESS_IMPRESSIONS_DESKTOP_MAPS');
    const impDesktopSearch= sum('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH');
    const impMobileMaps   = sum('BUSINESS_IMPRESSIONS_MOBILE_MAPS');
    const impMobileSearch = sum('BUSINESS_IMPRESSIONS_MOBILE_SEARCH');
    const totalImpressions = impDesktopMaps + impDesktopSearch + impMobileMaps + impMobileSearch;

    const buildDailyMap = (...metrics) => {
      const map = {};
      metrics.forEach(m => (md[m] || []).forEach(d => {
        const key = `${d.date.year}-${String(d.date.month).padStart(2,'0')}-${String(d.date.day).padStart(2,'0')}`;
        map[key] = (map[key] || 0) + (parseInt(d.value) || 0);
      }));
      return Object.entries(map).sort().map(([date, value]) => ({ date, value }));
    };

    const fmtTrend = m => (md[m] || []).map(d => ({
      date:  `${d.date.year}-${String(d.date.month).padStart(2,'0')}-${String(d.date.day).padStart(2,'0')}`,
      value: parseInt(d.value) || 0,
    }));

    res.json({
      current: {
        impressions: totalImpressions, calls, directions, websiteClicks, messages: 0,
        impMobileMaps, impMobileSearch, impDesktopMaps, impDesktopSearch,
        impMobile:  impMobileMaps  + impMobileSearch,
        impDesktop: impDesktopMaps + impDesktopSearch,
        impSearch:  impMobileSearch + impDesktopSearch,
        impMaps:    impMobileMaps   + impDesktopMaps,
      },
      imprTrend:  buildDailyMap('BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH'),
      interTrend: buildDailyMap('CALL_CLICKS','BUSINESS_DIRECTION_REQUESTS','WEBSITE_CLICKS'),
      callsTrend:  fmtTrend('CALL_CLICKS'),
      dirsTrend:   fmtTrend('BUSINESS_DIRECTION_REQUESTS'),
      clicksTrend: fmtTrend('WEBSITE_CLICKS'),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════
//  PDF REPORT DATA ENDPOINT
//  Aggregates all live data for a client; frontend renders the HTML
// ══════════════════════════════════════════════════════════════════
app.get('/api/report/:clientId/data', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { range = '30d' } = req.query;

    const { clients } = loadClients();
    const cfg = clients.find(c => String(c.id) === String(clientId)) || {};

    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { startDate, endDate } = getDateRange({ range });
    const report = { range, clientId, cfg, generatedAt: new Date().toISOString() };

    // GA4
    if (cfg.ga4PropertyId) {
      try {
        const [overview, prev, channels, pages, trend] = await Promise.all([
          runGA4Report({ propertyId: cfg.ga4PropertyId, metrics: ['sessions','totalUsers','newUsers','screenPageViews','bounceRate','averageSessionDuration'], dateRange: { startDate, endDate } }),
          runGA4Report({ propertyId: cfg.ga4PropertyId, metrics: ['sessions','totalUsers','screenPageViews','bounceRate'], dateRange: { startDate: offsetDate(startDate, -getDaysDiff(startDate,endDate)), endDate: offsetDate(startDate, -1) } }),
          runGA4Report({ propertyId: cfg.ga4PropertyId, metrics: ['sessions'], dimensions: ['sessionDefaultChannelGrouping'], dateRange: { startDate, endDate }, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 6 }),
          runGA4Report({ propertyId: cfg.ga4PropertyId, metrics: ['screenPageViews','sessions'], dimensions: ['pagePath','pageTitle'], dateRange: { startDate, endDate }, orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 8 }),
          runGA4Report({ propertyId: cfg.ga4PropertyId, metrics: ['sessions','totalUsers'], dimensions: ['date'], dateRange: { startDate, endDate }, orderBys: [{ dimension: { dimensionName: 'date' } }] }),
        ]);
        const total = (channels.rows || []).reduce((s, r) => s + parseInt(r.metricValues[0].value || 0), 0);
        report.ga4 = {
          kpis:    parseGA4Row(overview.rows?.[0], overview.metricHeaders),
          prevKpis:parseGA4Row(prev.rows?.[0], prev.metricHeaders),
          channels:(channels.rows || []).map(r => ({ channel: r.dimensionValues[0].value, sessions: parseInt(r.metricValues[0].value||0), pct: total ? Math.round(parseInt(r.metricValues[0].value||0)/total*100) : 0 })),
          pages:   (pages.rows   || []).map(r => ({ path: r.dimensionValues[0].value, title: r.dimensionValues[1].value, views: parseInt(r.metricValues[0].value||0), sessions: parseInt(r.metricValues[1].value||0) })),
          trend:   (trend.rows   || []).map(r => ({ date: formatGA4Date(r.dimensionValues[0].value), sessions: parseInt(r.metricValues[0].value||0), users: parseInt(r.metricValues[1].value||0) })),
        };
      } catch (e) { report.ga4Error = e.message; }
    }

    // GSC
    if (cfg.gscSiteUrl) {
      try {
        const wm = getWebmastersClient();
        const [totals, queries, pages] = await Promise.all([
          wm.searchanalytics.query({ siteUrl: cfg.gscSiteUrl, requestBody: { startDate, endDate, dimensions: [], rowLimit: 1 } }),
          wm.searchanalytics.query({ siteUrl: cfg.gscSiteUrl, requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 10, orderBy: 'clicks' } }),
          wm.searchanalytics.query({ siteUrl: cfg.gscSiteUrl, requestBody: { startDate, endDate, dimensions: ['page'],  rowLimit: 8,  orderBy: 'clicks' } }),
        ]);
        const cur = totals.data.rows?.[0] || {};
        report.gsc = {
          kpis:    { clicks: cur.clicks||0, impressions: cur.impressions||0, ctr: ((cur.ctr||0)*100).toFixed(2), position: (cur.position||0).toFixed(1) },
          queries: (queries.data.rows||[]).map(r => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: ((r.ctr||0)*100).toFixed(2), position: (r.position||0).toFixed(1) })),
          pages:   (pages.data.rows  ||[]).map(r => ({ page:  r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: ((r.ctr||0)*100).toFixed(2), position: (r.position||0).toFixed(1) })),
        };
      } catch (e) { report.gscError = e.message; }
    }

    res.json(report);
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════
//  RANK TRACKING (DataForSEO)
// ══════════════════════════════════════════════════════════════════

const RANK_DATA_DIR = path.join(__dirname, 'data');
const RANK_FILE     = id => path.join(RANK_DATA_DIR, `ranks-${id}.json`);

function ensureDataDir() { if (!fs.existsSync(RANK_DATA_DIR)) fs.mkdirSync(RANK_DATA_DIR, { recursive: true }); }
function loadRankData(clientId) {
  ensureDataDir();
  const f = RANK_FILE(clientId);
  if (!fs.existsSync(f)) return { keywords: [], history: [] };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function saveRankData(clientId, data) {
  ensureDataDir();
  fs.writeFileSync(RANK_FILE(clientId), JSON.stringify(data, null, 2));
}

// Location code lookup: country → Google location_code
const LOCATION_CODES = {
  'AU':2036, 'NZ':2554, 'UK':2826, 'GB':2826, 'US':2840,
  'SG':2702, 'TH':2764, 'MY':2458, 'PH':2608, 'ID':2360,
  'VN':2704, 'IN':2356, 'HK':2344, 'JP':2392,
};

// DataForSEO helpers
function hasDataForSEO() {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

async function dataForSEOFetch(endpoint, body) {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  const r = await fetch(`https://api.dataforseo.com/v3${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (data.status_code !== 20000) throw new Error(data.status_message || 'DataForSEO error');
  return data;
}

// Get keywords for a client
app.get('/api/rank/:clientId/keywords', (req, res) => {
  const data = loadRankData(req.params.clientId);
  res.json({ keywords: data.keywords });
});

// Save keywords for a client
app.post('/api/rank/:clientId/keywords', (req, res) => {
  const { keywords, domain, location } = req.body;
  if (!Array.isArray(keywords)) return res.status(400).json({ error: 'keywords array required' });

  const data = loadRankData(req.params.clientId);
  data.keywords = keywords.map(k => typeof k === 'string' ? k.trim() : k).filter(Boolean);
  if (domain)   data.domain   = domain;
  if (location) data.location = location;
  saveRankData(req.params.clientId, data);
  res.json({ success: true, count: data.keywords.length });
});

// Check rankings now (live DataForSEO call or mock)
app.post('/api/rank/:clientId/check', async (req, res) => {
  try {
    const { clientId } = req.params;
    const data = loadRankData(clientId);
    if (!data.keywords.length) return res.status(400).json({ error: 'No keywords configured' });

    const domain   = data.domain   || '';
    const locCode  = LOCATION_CODES[data.location || 'AU'] || 2036;
    const now      = new Date().toISOString();

    let results = [];

    if (hasDataForSEO() && domain) {
      // Live DataForSEO check
      const tasks = data.keywords.map(kw => ({
        keyword: kw,
        language_code: 'en',
        location_code: locCode,
        depth: 100,
      }));

      const resp = await dataForSEOFetch('/serp/google/organic/live/advanced', tasks);

      for (const task of (resp.tasks || [])) {
        const keyword = task.data?.keyword || '';
        let position = null, url = null, title = null;

        const items = task.result?.[0]?.items || [];
        // Log top 5 organic results for debugging
        const organics = items.filter(i => i.type === 'organic').slice(0, 5);
        console.log(`[Rank] "${keyword}" → ${items.length} items, top organics:`, organics.map(o => `#${o.rank_group} ${o.domain}`).join(', '));

        for (const item of items) {
          if (item.type === 'organic' && item.url && (item.url.includes(domain) || item.domain?.includes(domain))) {
            position = item.rank_group;
            url = item.url;
            title = item.title;
            break;
          }
        }

        results.push({ keyword, position, url, title, checkedAt: now });
      }
    } else {
      // Mock data when no API key
      results = data.keywords.map((kw, i) => {
        const seed = kw.length * 7 + i * 13;
        const pos = (seed % 28) + 1;
        return { keyword: kw, position: pos, url: domain ? `https://${domain}/` : null, title: kw, checkedAt: now };
      });
    }

    // Save to history — keep latest per keyword + last 30 days of daily snapshots
    if (!data.history) data.history = [];
    const today = now.split('T')[0];

    for (const r of results) {
      // Find previous entry for change calculation
      const prev = data.history.filter(h => h.keyword === r.keyword).sort((a,b) => b.checkedAt.localeCompare(a.checkedAt))[0];
      r.previousPosition = prev?.position || null;
      r.change = (prev?.position && r.position) ? prev.position - r.position : null; // positive = improved

      // Remove today's existing entry for same keyword
      data.history = data.history.filter(h => !(h.keyword === r.keyword && h.checkedAt.startsWith(today)));
      data.history.push(r);
    }

    // Prune history older than 90 days
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    data.history = data.history.filter(h => h.checkedAt >= cutoff);

    saveRankData(clientId, data);
    res.json({ results, isLive: hasDataForSEO() && !!domain, count: results.length });
  } catch (err) {
    handleError(res, err);
  }
});

// Get rank overview — latest positions + history trend
app.get('/api/rank/:clientId/overview', (req, res) => {
  const { clientId } = req.params;
  const data = loadRankData(clientId);

  // Latest position per keyword
  const latestMap = {};
  for (const h of (data.history || [])) {
    if (!latestMap[h.keyword] || h.checkedAt > latestMap[h.keyword].checkedAt) {
      latestMap[h.keyword] = h;
    }
  }
  const latest = Object.values(latestMap).sort((a,b) => (a.position||999) - (b.position||999));

  // KPIs
  const positions = latest.map(l => l.position).filter(p => p != null);
  const avgPosition = positions.length ? (positions.reduce((s,p) => s+p, 0) / positions.length).toFixed(1) : null;
  const top3   = positions.filter(p => p <= 3).length;
  const top10  = positions.filter(p => p <= 10).length;
  const top20  = positions.filter(p => p <= 20).length;
  const improved = latest.filter(l => l.change > 0).length;
  const declined = latest.filter(l => l.change < 0).length;

  // Daily history for sparklines (group by date per keyword)
  const histByKeyword = {};
  for (const h of (data.history || [])) {
    if (!histByKeyword[h.keyword]) histByKeyword[h.keyword] = [];
    histByKeyword[h.keyword].push({ date: h.checkedAt.split('T')[0], position: h.position });
  }

  res.json({
    keywords: data.keywords,
    domain:   data.domain,
    location: data.location,
    latest,
    kpis: { avgPosition, top3, top10, top20, total: data.keywords.length, improved, declined },
    history: histByKeyword,
    isLive: hasDataForSEO() && !!data.domain,
  });
});

// ══════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  const tokens = loadTokens();
  res.json({
    status:       'ok',
    version:      '1.0.0',
    googleAuth:   !!tokens.google,
    googleEmail:  tokens.google?.email || null,
    timestamp:    new Date().toISOString(),
  });
});

// ══════════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════

function parseGA4Row(row, headers) {
  if (!row || !headers) return {};
  return headers.reduce((acc, h, i) => {
    acc[h.name] = parseFloat(row.metricValues[i]?.value) || 0;
    return acc;
  }, {});
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function formatGA4Date(dateStr) {
  // GA4 returns dates as YYYYMMDD
  const y = dateStr.slice(0,4), m = dateStr.slice(4,6), d = dateStr.slice(6,8);
  return new Date(`${y}-${m}-${d}`).toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function getDateRange(query) {
  const { range = '30d', compare = 'prev-period' } = query;
  let startDate, endDate;

  if (range.startsWith('custom|')) {
    // Format: custom|YYYY-MM-DD|YYYY-MM-DD
    const parts = range.split('|');
    startDate = parts[1] || '30daysAgo';
    endDate   = parts[2] || 'today';
  } else {
    endDate   = 'today';
    startDate = range === '7d'  ? '7daysAgo'
              : range === '90d' ? '90daysAgo'
              : range === 'mtd' ? firstOfMonth()
              : '30daysAgo';
  }

  let prevStart = null, prevEnd = null;
  if (compare !== 'none') {
    if (compare === 'prev-year') {
      prevStart = offsetDate(startDate, -365);
      prevEnd   = offsetDate('today',   -365);
    } else {
      // prev-period: equal-length window immediately before current
      const days = getDaysDiff(startDate, endDate);
      prevEnd   = offsetDate(startDate, -1);
      prevStart = offsetDate(prevEnd,   -days);
    }
  }
  return { startDate, endDate, prevStart, prevEnd, compare };
}

function firstOfMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
}

function getDaysDiff(startDate, endDate) {
  const map = { 'today':0, '7daysAgo':7, '30daysAgo':30, '90daysAgo':90 };
  if (map[startDate] !== undefined) return map[startDate];
  const ms = new Date(endDate === 'today' ? new Date() : endDate) - new Date(startDate);
  return Math.ceil(ms / 86400000);
}

function offsetDate(dateStr, days) {
  const map = { 'today':0, '7daysAgo':-7, '30daysAgo':-30, '90daysAgo':-90 };
  const offset = map[dateStr];
  const base = offset !== undefined
    ? new Date(Date.now() + offset * 86400000)
    : new Date(dateStr);
  base.setDate(base.getDate() + days);
  return base.toISOString().split('T')[0];
}

function handleError(res, err) {
  console.error(err.message);
  const status = err.code === 403 ? 403 : err.code === 401 ? 401 : 500;
  res.status(status).json({
    error:   err.message,
    code:    err.code,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}

// ── Start Server ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏔️  Lanna Mountain Agency Dashboard`);
  console.log(`   Backend running at: http://localhost:${PORT}`);
  console.log(`   Dashboard:          http://localhost:${PORT}/agency-dashboard-mvp.html`);
  console.log(`   Auth status:        http://localhost:${PORT}/auth/status`);
  console.log(`   Connect Google:     http://localhost:${PORT}/auth/google\n`);
});
