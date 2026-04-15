/**
 * /api/news.js — Vercel Serverless Function (Node.js / CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * Live geopolitical news feed for DELAX GEO-RISK dashboard.
 *
 * FIX NOTES (v2):
 *  • Replaced news.py (broken AWS-style handler) with a proper Node.js
 *    Vercel serverless function using (req, res) signature.
 *  • Fetches RSS feeds directly with built-in fetch() — zero Python dependency.
 *  • Parses RSS/Atom XML with a lightweight regex-based parser (no npm needed).
 *  • Falls back gracefully if individual feeds fail.
 *  • CORS headers set for cross-origin dashboard access.
 *  • Response cached 60 s at the edge (s-maxage) to avoid hammering RSS hosts.
 *
 * Endpoint:  GET /api/news
 * Response:  { news: [...], fetchedAt, sources }
 */
'use strict';

const RSS_FEEDS = [
  { url: 'https://feeds.reuters.com/reuters/worldNews',           name: 'Reuters World'    },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',          name: 'BBC World'        },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',        name: 'Sky News World'   },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',            name: 'Al Jazeera'       },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories', name: 'MarketWatch'      },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'NYT World'      },
];

// Geopolitical keywords that make an article relevant to the dashboard
const GEO_KEYWORDS = [
  'war','conflict','military','sanction','diplomat','tension','crisis',
  'invasion','nuclear','terror','missile','drone','navy','army','airforce',
  'ceasefire','peace','blockade','embargo','coup','assassination','protest',
  'election','summit','treaty','alliance','refugee','humanitarian',
  'oil','gas','energy','brent','opec','crude',
  'inflation','recession','gdp','fed rate','interest rate','central bank',
  'china','russia','iran','ukraine','israel','nato','middle east','taiwan',
  'sanctions','cybersecurity','hack','espionage','intelligence',
  'trade war','tariff','export','supply chain',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(req.query.limit || '12', 10), 30);

  try {
    const results = await Promise.allSettled(
      RSS_FEEDS.map(feed => fetchRSSFeed(feed.url, feed.name))
    );

    const allItems = [];
    const sources  = [];

    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.length) {
        allItems.push(...r.value);
        sources.push(r.value[0]?.source || 'RSS');
      }
    });

    if (!allItems.length) {
      return res.status(200).json({
        news: [],
        fetchedAt: new Date().toISOString(),
        sources: [],
        warning: 'All RSS feeds returned empty — check feed URLs',
      });
    }

    // Score each item by geopolitical relevance
    const scored = allItems.map(item => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      const score = GEO_KEYWORDS.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
      return { ...item, _score: score };
    });

    // Sort: geo-relevant first, then by date
    scored.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return new Date(b.pubDate) - new Date(a.pubDate);
    });

    // De-duplicate by title similarity
    const seen  = new Set();
    const deduped = [];
    for (const item of scored) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
      if (deduped.length >= limit) break;
    }

    // Strip internal score field before sending
    const news = deduped.map(({ _score, ...item }) => item);

    return res.status(200).json({
      news,
      fetchedAt: new Date().toISOString(),
      sources,
      count: news.length,
    });

  } catch (err) {
    console.error('[api/news] Unhandled error:', err.message);
    return res.status(500).json({
      error: 'News feed fetch failed',
      detail: err.message,
    });
  }
};

/* ─── RSS/Atom parser (no npm dependencies) ─────────────────────── */

async function fetchRSSFeed(url, sourceName) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'DELAX-GeoRisk/2.0 RSS Reader' },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    return parseRSS(xml, sourceName);
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[api/news] Feed failed (${sourceName}): ${err.message}`);
    return [];
  }
}

function parseRSS(xml, defaultSource) {
  const items = [];

  // Detect feed title for source label
  const feedTitleMatch = xml.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is);
  const feedTitle = feedTitleMatch
    ? stripCDATA(feedTitleMatch[1]).trim().slice(0, 40) || defaultSource
    : defaultSource;

  // Match <item> blocks (RSS) or <entry> blocks (Atom)
  const itemPattern = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;

  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];

    const title       = extractTag(block, 'title');
    const description = extractTag(block, 'description') ||
                        extractTag(block, 'summary')     ||
                        extractTag(block, 'content');
    const link        = extractLink(block);
    const pubDate     = extractTag(block, 'pubDate')     ||
                        extractTag(block, 'published')   ||
                        extractTag(block, 'updated')     ||
                        new Date().toISOString();

    if (!title) continue;

    items.push({
      title:       clean(title).slice(0, 200),
      description: clean(description).slice(0, 300),
      link:        link || '',
      pubDate:     normaliseDate(pubDate),
      source:      feedTitle,
    });

    if (items.length >= 20) break; // cap per feed
  }

  return items;
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const m  = xml.match(re);
  return m ? m[1].trim() : '';
}

function extractLink(block) {
  // RSS <link>
  const rss = block.match(/<link[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^<\]]+?)(?:\]\]>)?<\/link>/i);
  if (rss) return rss[1].trim();
  // Atom <link href="...">
  const atom = block.match(/<link[^>]+href=["'](https?:\/\/[^"']+)["']/i);
  if (atom) return atom[1].trim();
  return '';
}

function stripCDATA(str) {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
}

function clean(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1') // unwrap CDATA
    .replace(/<[^>]+>/g, '')                         // strip HTML tags
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g,    ' ')
    .trim();
}

function normaliseDate(raw) {
  if (!raw) return new Date().toISOString();
  try {
    const d = new Date(raw.trim());
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}
