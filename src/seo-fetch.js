// rvo seo — network layer. Fetches the page, robots.txt, and sitemap.xml
// using only Node built-ins. Redirect following, timeout, body cap.
'use strict';

const http = require('http');
const https = require('https');
const zlib = require('zlib');

const UA = 'rvo-seo/2.0 (+https://github.com/sandeepVarma9902/react-vite-optimizer)';
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 3 * 1024 * 1024;

function rawGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const t0 = Date.now();
    let ttfb = null;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br' }, timeout: timeoutMs },
      res => {
        ttfb = Date.now() - t0;
        const chunks = [];
        let bytes = 0;
        let truncated = false;
        res.on('data', c => {
          if (bytes + c.length > MAX_BYTES) {
            truncated = true;
            chunks.push(c.subarray(0, MAX_BYTES - bytes));
            bytes = MAX_BYTES;
            res.destroy();
          } else {
            chunks.push(c);
            bytes += c.length;
          }
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            ttfbMs: ttfb,
            bytes,
            truncated,
          })
        );
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

// Follows redirects; returns the final response plus the chain length.
async function fetchUrl(url, { timeoutMs = TIMEOUT_MS, maxRedirects = MAX_REDIRECTS } = {}) {
  let current = url;
  let redirects = 0;
  for (;;) {
    const res = await rawGet(current, timeoutMs);
    if (isRedirect(res.status) && res.headers.location && redirects < maxRedirects) {
      try {
        current = new URL(res.headers.location, current).toString();
      } catch {
        break;
      }
      redirects++;
      continue;
    }
    return { ...res, finalUrl: current, redirects };
  }
}

// Node's http does not auto-decompress: decode per content-encoding.
function decodeBody(buffer, encoding) {
  const enc = (encoding || '').toLowerCase();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer);
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer);
    if (enc.includes('deflate')) return zlib.inflateSync(buffer);
    if (enc.includes('zstd')) return buffer; // no built-in zstd decode; analyze raw
  } catch {
    return buffer; // corrupt encoding header — fall back to raw bytes
  }
  return buffer;
}
function parseRobots(text) {
  const lines = text.split('\n').map(l => l.trim());
  let inStar = false;
  let blocksAll = false;
  let allows = true;
  for (const line of lines) {
    if (/^user-agent\s*:/i.test(line)) {
      inStar = /user-agent\s*:\s*\*/i.test(line);
    } else if (inStar && /^disallow\s*:/i.test(line)) {
      const val = line.split(':')[1].trim();
      if (val === '/') { blocksAll = true; allows = false; }
    }
  }
  return { present: true, allows, blocksAll, text: text.slice(0, 2000) };
}

async function fetchRobots(pageUrl) {
  try {
    const origin = new URL(pageUrl).origin;
    const res = await rawGet(origin + '/robots.txt', TIMEOUT_MS);
    if (res.status >= 400) return { present: false, allows: true, blocksAll: false };
    return parseRobots(decodeBody(res.body, res.headers['content-encoding']).toString('utf8'));
  } catch {
    return { present: false, allows: true, blocksAll: false, error: 'fetch failed' };
  }
}

// sitemap.xml: present? parses? how many URLs?
function parseSitemap(text) {
  const hasUrlset = /<\s*(urlset|sitemapindex)[\s>]/i.test(text);
  if (!hasUrlset) return { present: true, valid: false, urls: 0 };
  const urls = (text.match(/<\s*loc\s*>/gi) || []).length;
  return { present: true, valid: urls > 0, urls };
}

async function fetchSitemap(pageUrl, robotsText) {
  let candidates = [new URL(pageUrl).origin + '/sitemap.xml'];
  if (robotsText) {
    const m = robotsText.match(/^sitemap\s*:\s*(\S+)/im);
    if (m) candidates = [m[1], ...candidates];
  }
  for (const u of candidates) {
    try {
      const res = await rawGet(u, TIMEOUT_MS);
      if (res.status >= 400) continue;
      const parsed = parseSitemap(decodeBody(res.body, res.headers['content-encoding']).toString('utf8'));
      if (parsed.valid) return { ...parsed, url: u };
    } catch {
      continue;
    }
  }
  return { present: false, valid: false, urls: 0 };
}

// Full site fetch for `rvo seo`: page + robots + sitemap in one meta object.
async function fetchSite(inputUrl) {
  let url = inputUrl.trim();
  if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
  const page = await fetchUrl(url);
  const encoding = page.headers['content-encoding'] || null;
  const robots = await fetchRobots(page.finalUrl);
  const sitemap = await fetchSitemap(page.finalUrl, robots.text || null);
  const html = decodeBody(page.body, encoding).toString('utf8');
  return {
    meta: {
      url: inputUrl,
      finalUrl: page.finalUrl,
      status: page.status,
      redirects: page.redirects,
      ttfbMs: page.ttfbMs,
      bytes: page.bytes, // transferred bytes (pre-decode) — the honest page-weight metric
      contentEncoding: encoding,
      robots,
      sitemap,
    },
    html,
  };
}

module.exports = { fetchUrl, fetchRobots, fetchSitemap, parseRobots, parseSitemap, fetchSite, UA };
