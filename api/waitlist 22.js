/**
 * /api/waitlist.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────
 * DELAX GEO-RISK — Pro Waitlist Email Notification
 *
 * Receives Pro waitlist signups from the paywall modal and
 * emails a notification to contact@delaxcom.com via Resend.
 *
 * SETUP (one-time in Vercel Dashboard):
 *   1. Sign up at resend.com (free tier: 3,000 emails/month)
 *   2. Resend Dashboard → API Keys → Create API Key
 *   3. Vercel Dashboard → Project → Settings → Environment Variables
 *      Add: RESEND_API_KEY  =  re_xxxxxxxxxxxxx
 *      Scope: Production ✓ Preview ✓ Development ✓
 *   4. Save → Deployments → Redeploy (or just push to trigger a redeploy)
 *
 * SENDER ADDRESS:
 *   Sending from 'waitlist@delaxcom.com' — domain verified in Resend ✓
 *   If you ever need to re-verify: Resend Dashboard → Domains → delaxcom.com
 *
 * ENDPOINT:
 *   POST /api/waitlist
 *   Body: { email, scenario, feature, userAgent, referrer }
 *   Returns: { ok: true, id: <resend_message_id> }
 */
'use strict';

const NOTIFY_EMAIL = 'contact@delaxcom.com';
// Domain verified ✓ — sending from delaxcom.com via Resend
const FROM_EMAIL   = 'DELAX GEO-RISK <waitlist@delaxcom.com>';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed — use POST' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:  'RESEND_API_KEY environment variable is not set.',
      fix:    'Vercel Dashboard → Settings → Environment Variables → Add RESEND_API_KEY',
      docs:   'https://resend.com → free tier: 3,000 emails/month',
    });
  }

  /* ── Parse and validate request ── */
  const {
    email     = '',
    scenario  = 'unknown',
    feature   = 'unknown',
    userAgent = '',
    referrer  = '',
  } = req.body || {};

  // RFC 5322 simplified email regex
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !EMAIL_RE.test(email) || email.length > 200) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Basic field length guardrails against payload abuse
  const safeScenario  = String(scenario  || '').slice(0, 40);
  const safeFeature   = String(feature   || '').slice(0, 40);
  const safeUserAgent = String(userAgent || '').slice(0, 400);
  const safeReferrer  = String(referrer  || '').slice(0, 400);
  const safeEmail     = String(email).slice(0, 200).toLowerCase().trim();

  /* ── Build notification email content ── */
  const now = new Date();
  const timestamp = now.toUTCString();

  const htmlBody = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e8edf5">
  <div style="max-width:560px;margin:0 auto;padding:2rem 1.5rem">
    <div style="border-top:3px solid #f5a623;background:#111829;border-radius:4px;padding:1.5rem 1.75rem;border:1px solid #1e2e4a">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:#f5a623;margin-bottom:.5rem">
        DELAX GEO-RISK · PRO WAITLIST
      </div>
      <h1 style="font-size:1.25rem;color:#e8edf5;margin:0 0 1.25rem;letter-spacing:.04em">
        New Pro signup
      </h1>

      <div style="background:#0a1020;border:1px solid #1e2e4a;border-left:3px solid #b388ff;padding:1rem 1.25rem;border-radius:3px;margin-bottom:1rem">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:#7a91b3;margin-bottom:.25rem">Email</div>
        <div style="font-size:1.05rem;color:#00d4ff;font-weight:600;word-break:break-all">
          <a href="mailto:${safeEmail}" style="color:#00d4ff;text-decoration:none">${safeEmail}</a>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:.82rem;line-height:1.6">
        <tr>
          <td style="padding:.5rem 0;border-bottom:1px solid #1e2e4a;color:#7a91b3;font-family:'IBM Plex Mono',monospace;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;width:40%">Triggered by</td>
          <td style="padding:.5rem 0;border-bottom:1px solid #1e2e4a;color:#c8d4e8">${safeFeature}</td>
        </tr>
        <tr>
          <td style="padding:.5rem 0;border-bottom:1px solid #1e2e4a;color:#7a91b3;font-family:'IBM Plex Mono',monospace;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase">Active scenario</td>
          <td style="padding:.5rem 0;border-bottom:1px solid #1e2e4a;color:#c8d4e8">${safeScenario}</td>
        </tr>
        <tr>
          <td style="padding:.5rem 0;border-bottom:1px solid #1e2e4a;color:#7a91b3;font-family:'IBM Plex Mono',monospace;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase">Timestamp</td>
          <td style="padding:.5rem 0;border-bottom:1px solid #1e2e4a;color:#c8d4e8">${timestamp}</td>
        </tr>
        <tr>
          <td style="padding:.5rem 0;border-bottom:1px solid #1e2e4a;color:#7a91b3;font-family:'IBM Plex Mono',monospace;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase">Referrer</td>
          <td style="padding:.5rem 0;border-bottom:1px solid #1e2e4a;color:#c8d4e8;word-break:break-all;font-size:.72rem">${safeReferrer || '(direct)'}</td>
        </tr>
        <tr>
          <td style="padding:.5rem 0;color:#7a91b3;font-family:'IBM Plex Mono',monospace;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;vertical-align:top">User agent</td>
          <td style="padding:.5rem 0;color:#5a7299;word-break:break-all;font-size:.68rem;font-family:'IBM Plex Mono',monospace">${safeUserAgent}</td>
        </tr>
      </table>

      <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #1e2e4a;text-align:center">
        <a href="mailto:${safeEmail}?subject=Welcome%20to%20DELAX%20GEO-RISK%20Pro"
           style="display:inline-block;background:linear-gradient(135deg,#b388ff,#8b5cf6);color:#fff;text-decoration:none;padding:.7rem 1.5rem;border-radius:3px;font-size:.85rem;font-weight:600;letter-spacing:.04em">
          Reply to signup →
        </a>
      </div>
    </div>
    <div style="text-align:center;font-size:.62rem;color:#5a7299;margin-top:1rem;font-family:'IBM Plex Mono',monospace;letter-spacing:.08em">
      delaxcom.org · Automated waitlist notification
    </div>
  </div>
</body>
</html>`.trim();

  const textBody = [
    'DELAX GEO-RISK — New Pro Waitlist Signup',
    '─────────────────────────────────────────',
    '',
    `Email:            ${safeEmail}`,
    `Triggered by:     ${safeFeature}`,
    `Active scenario:  ${safeScenario}`,
    `Timestamp:        ${timestamp}`,
    `Referrer:         ${safeReferrer || '(direct)'}`,
    `User agent:       ${safeUserAgent}`,
    '',
    `Reply to: ${safeEmail}`,
  ].join('\n');

  /* ── Send via Resend REST API ── */
  try {
    const resendResp = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     FROM_EMAIL,
        to:       [NOTIFY_EMAIL],
        reply_to: safeEmail,  // one-click reply goes straight to the signup
        subject:  `New Pro signup: ${safeEmail}`,
        html:     htmlBody,
        text:     textBody,
        tags: [
          { name: 'category', value: 'waitlist' },
          { name: 'feature',  value: safeFeature.replace(/[^a-z0-9_-]/gi, '_') },
        ],
      }),
    });

    let body;
    try { body = await resendResp.json(); }
    catch (_) {
      return res.status(502).json({ error: 'Resend returned non-JSON response' });
    }

    if (!resendResp.ok) {
      console.error('[api/waitlist] Resend rejected send:', {
        status:  resendResp.status,
        name:    body?.name,
        message: body?.message,
        email:   safeEmail,
        from:    FROM_EMAIL,
      });
      // Map Resend error codes to actionable messages
      const code = resendResp.status;
      const name = body?.name || '';
      let hint = body?.message || `Resend HTTP ${code}`;
      if (code === 403)                         hint = 'Sender domain not verified in Resend — check Resend dashboard → Domains';
      if (code === 422 && name === 'validation_error') hint = 'Invalid from/to address — check domain DNS verification';
      if (code === 429)                         hint = 'Resend rate limit hit — try again in 1 minute';
      if (code === 401)                         hint = 'Invalid RESEND_API_KEY — regenerate key in Resend dashboard';
      return res.status(502).json({ error: hint, resendStatus: code, resendName: name });
    }

    // Success — return the Resend message ID for traceability
    return res.status(200).json({
      ok: true,
      id: body?.id || null,
      receivedAt: now.toISOString(),
    });

  } catch (err) {
    console.error('[api/waitlist] Network error:', err.message);
    return res.status(500).json({ error: 'Waitlist submission failed', detail: err.message });
  }
};
