require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Gemini ────────────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const SYSTEM_PROMPT = `You are Lily, the expert virtual assistant for Be Li Tailor. You know everything about this business and answer questions confidently and accurately. You are warm, professional, and concise.

## About Be Li Tailor
Be Li Tailor is a premium bespoke tailoring studio in Hội An, Vietnam. Founded in 2005 by Le Thi Chan, who trained under master Hội An tailors. Co-owned since 2018 by Jerry Stevens (Australian), who brought international hospitality standards to the business. Two decades of experience. Rated 4.9 stars on TripAdvisor with hundreds of verified reviews from clients in 40+ countries.

## Location & Hours
- Address: 635 Hai Bà Trưng Street, Hội An Ancient Town, Vietnam
- Open every day, 8:00am – 9:00pm. No appointment needed to walk in.

## Contact
- WhatsApp / Phone: +84 905 820 116
- Email: belicustomtailor@gmail.com
- Facebook & Instagram: @belitailor

## Services
- **Suits**: Bespoke two-piece and three-piece suits, tuxedos
- **Shirts**: Custom-fitted bespoke shirts
- **Trousers**: Tailored trousers and dress pants
- **Outerwear**: Custom coats, jackets, and overcoats
- **Womenswear**: Custom dresses and evening wear
- **Weddings**: Bridal attire and full wedding party clothing
- **Corporate / Wholesale**: Bulk orders for hotels, businesses, and fashion buyers
- **Same-day alterations** available

## Pricing
Pricing is not listed — it depends on fabric choice and garment complexity. Customers are encouraged to visit or contact for a quote. Pricing is competitive for the quality offered.

## The Tailoring Process
1. Visit the studio (no appointment needed) — browse fabrics and discuss your garment
2. Measurements taken and pattern cut by the same person
3. The tailor who cuts your cloth sews your garment — same team throughout, nothing outsourced
4. First fitting to check the garment
5. Adjustments made if needed at no charge
6. Final fitting and collection
- Most garments ready within **24 hours of your first fitting** — maximum 2 days
- Two fittings included with every order
- Best to visit on your first day in Hội An to allow time for fittings

## What Makes Them Different
- Everything done in-house — cutting, sewing, pressing, hand-finishing
- Hand-stitched buttonholes and invisible linings
- The pattern-maker who measures you cuts your pattern; the tailor who cuts your cloth sews it
- No outsourcing, ever
- Transparent process — customers can watch garments being made

## International Shipping
Finished garments can be shipped to 40+ countries after the customer departs. Measurements are kept on file for future remote orders.

## FAQs
**How long will my suit take?** Most garments are ready within 24 hours of your fitting — 2 days at most. Visit on your first day in Hội An.
**Do I need an appointment?** No — walk in any day between 8am and 9pm.
**Can you ship my order?** Yes, to 40+ countries worldwide.
**What fabrics do you have?** A wide range is available in-studio — best to visit to see and feel the options.
**Do you do alterations?** Yes, same-day alterations are available.
**Can I order again from home?** Yes — your measurements are kept on file so you can reorder remotely.
**How much does a suit cost?** Pricing depends on fabric and style — contact or visit for a quote.
**Are you open on weekends?** Yes, every day 8am–9pm including weekends and public holidays.

## Your role
1. Answer any question confidently using the knowledge above
2. If something is genuinely not covered (e.g. a very specific fabric availability), say "I'd recommend contacting us directly on WhatsApp: +84 905 820 116 — the team will get back to you quickly"
3. Naturally collect these 4 details during the conversation — do NOT ask for all at once, weave them in:
   - Customer's name
   - Email address
   - WhatsApp number
   - What service or garment they're interested in
4. Once you have all 4, confirm them and say someone will be in touch within 24 hours
5. Keep responses to 2–4 sentences — conversational, not robotic`;

// In-memory sessions: { sessionId: { history: [], leadData: {}, leadSaved: false } }
const sessions = {};

// Clean up sessions older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const id in sessions) {
    if (sessions[id].createdAt < cutoff) delete sessions[id];
  }
}, 30 * 60 * 1000);

// ── Google auth (service account) ────────────────────────────────────────────

function getGoogleAuth() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyFile || !fs.existsSync(keyFile)) return null;
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/gmail.send',
    ],
  });
}

// ── Google Sheets ─────────────────────────────────────────────────────────────

async function ensureSheetHeaders(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Leads!A1:F1',
    });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Leads!A1:F1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Timestamp', 'Name', 'Email', 'WhatsApp', 'Service Interest', 'Session ID']],
        },
      });
    }
  } catch {
    // Sheet tab may not exist yet — create it
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: 'Leads' } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Leads!A1:F1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Timestamp', 'Name', 'Email', 'WhatsApp', 'Service Interest', 'Session ID']],
      },
    });
  }
}

async function saveLead(lead) {
  const auth = getGoogleAuth();
  if (!auth || !process.env.GOOGLE_SHEET_ID) {
    console.log('Lead captured (no sheet configured):', lead);
    return;
  }
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  await ensureSheetHeaders(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Leads!A:F',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        new Date().toISOString(),
        lead.name || '',
        lead.email || '',
        lead.whatsapp || '',
        lead.service || '',
        lead.sessionId || '',
      ]],
    },
  });
  console.log('Lead saved to sheet:', lead.name, lead.email);
}

// ── Gmail send ────────────────────────────────────────────────────────────────

async function sendEmail(to, subject, htmlBody) {
  const auth = getGoogleAuth();
  if (!auth) { console.log('No auth — skipping email'); return; }
  const client = await auth.getClient();
  const gmail = google.gmail({ version: 'v1', auth: client });

  const message = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    htmlBody,
  ].join('\n');

  const encoded = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
  console.log('Email sent:', subject);
}

// ── Lead extraction via Gemini ────────────────────────────────────────────────

async function extractLeadData(conversationText) {
  const extractModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const prompt = `Extract lead information from this chat conversation. Return ONLY valid JSON with these exact keys (use null if not found):
{"name": "...", "email": "...", "whatsapp": "...", "service": "..."}

Conversation:
${conversationText}`;

  try {
    const result = await extractModel.generateContent(prompt);
    const text = result.response.text().trim();
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });

  if (!sessions[sessionId]) {
    sessions[sessionId] = { history: [], leadData: {}, leadSaved: false, createdAt: Date.now() };
  }
  const session = sessions[sessionId];

  try {
    // Build chat with history
    const chat = chatModel.startChat({
      history: [
        { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
        { role: 'model', parts: [{ text: "Understood. I'm ready to assist as Lily from Be Li Tailor." }] },
        ...session.history,
      ],
    });

    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    // Update history
    session.history.push({ role: 'user', parts: [{ text: message }] });
    session.history.push({ role: 'model', parts: [{ text: reply }] });

    // Extract lead data from conversation so far (every 2 turns to save API calls)
    if (!session.leadSaved && session.history.length % 4 === 0) {
      const conversationText = session.history
        .map(m => `${m.role === 'user' ? 'Customer' : 'Lily'}: ${m.parts[0].text}`)
        .join('\n');
      const extracted = await extractLeadData(conversationText);
      Object.assign(session.leadData, Object.fromEntries(
        Object.entries(extracted).filter(([, v]) => v && v !== 'null')
      ));

      const { name, email, whatsapp, service } = session.leadData;
      if (name && email && whatsapp && service && !session.leadSaved) {
        session.leadSaved = true;
        await saveLead({ ...session.leadData, sessionId });
      }
    }

    res.json({ reply, leadData: session.leadData, leadSaved: session.leadSaved });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Chat unavailable. Please try again.' });
  }
});

// Manual daily report trigger (also used by cron)
app.get('/api/daily-report', async (req, res) => {
  await sendDailyReport();
  res.json({ ok: true });
});

// ── Daily report ──────────────────────────────────────────────────────────────

async function getTodaysLeads() {
  const auth = getGoogleAuth();
  if (!auth || !process.env.GOOGLE_SHEET_ID) return [];
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Leads!A:F',
    });
    const rows = res.data.values || [];
    if (rows.length < 2) return [];
    const today = new Date().toISOString().slice(0, 10);
    return rows.slice(1).filter(r => r[0] && r[0].startsWith(today));
  } catch (err) {
    console.error('Sheet read error:', err.message);
    return [];
  }
}

async function sendDailyReport() {
  const leads = await getTodaysLeads();
  const dateStr = new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const leadsHtml = leads.length === 0
    ? '<p style="color:#666;">No leads captured today.</p>'
    : leads.map(r => `
      <div style="background:#f9f9f9;border-left:4px solid #c9a96e;padding:12px 16px;margin:10px 0;border-radius:4px;">
        <strong>${r[1] || 'Unknown'}</strong><br>
        📧 ${r[2] || '—'} &nbsp; 📱 ${r[3] || '—'}<br>
        🧵 <em>${r[4] || '—'}</em>
      </div>`).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
      <div style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);padding:24px;border-radius:8px;margin-bottom:24px;">
        <h1 style="color:#c9a96e;margin:0;font-size:22px;">Be Li Tailor</h1>
        <p style="color:#999;margin:4px 0 0;">Daily Lead Report — ${dateStr}</p>
      </div>

      <h2 style="color:#1a1a1a;border-bottom:2px solid #c9a96e;padding-bottom:8px;">
        Today's Leads (${leads.length})
      </h2>
      ${leadsHtml}

      <p style="margin-top:32px;font-size:12px;color:#999;">
        Sent automatically by the Be Li Tailor chatbot · Powered by Lanna Mountain Marketing
      </p>
    </body>
    </html>`;

  await sendEmail(
    process.env.REPORT_EMAIL,
    `Be Li Tailor — ${leads.length} lead${leads.length !== 1 ? 's' : ''} today (${new Date().toLocaleDateString('en-AU')})`,
    html
  );
}

// Daily report at 9pm server time
cron.schedule('0 21 * * *', () => {
  console.log('Running daily lead report...');
  sendDailyReport().catch(console.error);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Be Li Tailor chatbot server running on port ${PORT}`);
});
