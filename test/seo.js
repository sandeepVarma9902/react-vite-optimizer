// Tests for `rvo seo` (website SEO analyzer, free tier).
// Pure analysis is tested without network; the fetch layer is tested against
// a local node:http server (hermetic); the CLI is exercised end-to-end
// against the same local server with --json.
// Run with: npm test
'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const zlib = require('node:zlib');
const execFileAsync = promisify(execFile);

const { analyzeSeo, buildSeoHtmlReport } = require('../src/seo');
const { fetchSite, parseRobots, parseSitemap } = require('../src/seo-fetch');

const BIN = path.join(__dirname, '..', 'bin', 'cli.js');
const FIX = path.join(__dirname, 'fixtures', 'seo-demo');
const goodHtml = fs.readFileSync(path.join(FIX, 'good.html'), 'utf8');
const badHtml = fs.readFileSync(path.join(FIX, 'bad.html'), 'utf8');

function goodMeta() {
  return {
    url: 'https://example.com/widgets',
    finalUrl: 'https://example.com/widgets',
    status: 200,
    redirects: 0,
    ttfbMs: 180,
    bytes: 45000,
    contentEncoding: 'gzip',
    robots: { present: true, allows: true, blocksAll: false },
    sitemap: { present: true, valid: true, urls: 12 },
  };
}

function badMeta() {
  return {
    url: 'http://example.com/',
    finalUrl: 'http://example.com/',
    status: 200,
    redirects: 2,
    ttfbMs: 1500,
    bytes: 3 * 1024 * 1024,
    contentEncoding: null,
    robots: { present: true, allows: false, blocksAll: true },
    sitemap: { present: false, valid: false, urls: 0 },
  };
}

let n = 0;
function ok(cond, msg) {
  n++;
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

// ---- pure analysis: good page ----
const good = analyzeSeo(goodHtml, goodMeta());
ok(good.score >= 80, `good.html scores high (got ${good.score}, grade ${good.grade})`);
ok(good.grade === 'A' || good.grade === 'B', `good.html grade is A/B (got ${good.grade})`);
ok(good.issueCounts.error === 0, 'good.html has zero errors');
ok(good.categories.structure.h1Count === 1, 'good.html has exactly one h1');
ok(good.categories.structure.altCoveragePct === 100, 'good.html image alt coverage is 100%');

// ---- pure analysis: bad page ----
const bad = analyzeSeo(badHtml, badMeta());
ok(bad.score < 50, `bad.html scores low (got ${bad.score}, grade ${bad.grade})`);
ok(bad.grade === 'F', `bad.html grade is F (got ${bad.grade})`);
ok(bad.issueCounts.error > 0, 'bad.html has errors');
const msgs = bad.issues.map(i => i.message);
ok(msgs.some(m => /meta description/i.test(m)), 'bad.html flags missing meta description');
ok(msgs.some(m => /<title>/i.test(m)), 'bad.html flags missing title');
ok(msgs.some(m => /no <h1>/i.test(m)), 'bad.html flags missing h1');
ok(msgs.some(m => /alt text/i.test(m)), 'bad.html flags missing image alt text');
ok(msgs.some(m => /skips/i.test(m)), 'bad.html flags skipped heading levels');
ok(msgs.some(m => /noindex/i.test(m)), 'bad.html flags robots noindex');
ok(msgs.some(m => /robots\.txt disallows/i.test(m)), 'bad.html flags robots.txt blocking all');
ok(msgs.some(m => /render-blocking/i.test(m)), 'bad.html flags render-blocking scripts');
ok(bad.categories.structure.altCoveragePct === 0, 'bad.html alt coverage is 0%');
ok(bad.categories.social.score < 70, 'bad.html social score is low (no OG tags)');
// issues sorted error-first
const rank = { error: 0, warning: 1, info: 2 };
ok(
  bad.issues.every((iss, i, arr) => i === 0 || rank[arr[i - 1].severity] <= rank[iss.severity]),
  'issues are sorted error → warning → info'
);

// ---- report serialization ----
const roundTrip = JSON.parse(JSON.stringify(bad));
ok(roundTrip.score === bad.score && roundTrip.grade === 'F', 'JSON report round-trips');
const htmlReport = buildSeoHtmlReport(good);
ok(htmlReport.includes('Grade A') || htmlReport.includes('Grade B'), 'HTML report contains the grade');
ok(htmlReport.includes('example.com/widgets'), 'HTML report contains the URL');

// ---- robots/sitemap parsers ----
const blocking = parseRobots('User-agent: *\nDisallow: /');
ok(blocking.blocksAll === true && blocking.allows === false, 'parseRobots detects blanket disallow');
const permissive = parseRobots('User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml');
ok(permissive.blocksAll === false && permissive.allows === true, 'parseRobots handles permissive file');
const sm = parseSitemap('<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>');
ok(sm.valid === true && sm.urls === 2, 'parseSitemap counts URLs');
ok(parseSitemap('<html>not a sitemap</html>').valid === false, 'parseSitemap rejects non-sitemap');

// ---- fetch layer against a local hermetic server ----
const ROBOTS = 'User-agent: *\nDisallow:\nSitemap: http://127.0.0.1:{PORT}/sitemap.xml\n';
const SITEMAP = '<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:{PORT}/</loc></url></urlset>';
const server = http.createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(ROBOTS.replaceAll('{PORT}', server.address().port));
  } else if (req.url === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(SITEMAP.replaceAll('{PORT}', server.address().port));
  } else if (req.url === '/old') {
    res.writeHead(301, { Location: '/' });
    res.end();
  } else if (req.url === '/gzipped') {
    // regression: responses served with content-encoding must be decoded
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
    res.end(zlib.gzipSync(goodHtml));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(goodHtml);
  }
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const site = await fetchSite(base + '/');
  ok(site.meta.status === 200, 'fetchSite returns HTTP 200');
  ok(site.meta.robots.present === true && site.meta.robots.allows === true, 'fetchSite reads robots.txt');
  ok(site.meta.sitemap.present === true && site.meta.sitemap.valid === true, 'fetchSite reads sitemap.xml');
  ok(site.html.includes('<title>'), 'fetchSite returns page HTML');
  ok(typeof site.meta.ttfbMs === 'number' && site.meta.ttfbMs >= 0, 'fetchSite measures TTFB');

  const redir = await fetchSite(base + '/old');
  ok(redir.meta.redirects === 1 && redir.meta.finalUrl === base + '/', 'fetchSite follows redirects');

  const gz = await fetchSite(base + '/gzipped');
  ok(gz.html.includes('<title>') && gz.meta.contentEncoding === 'gzip', 'fetchSite decodes gzip bodies');

  // CLI end-to-end against the local server (hermetic, no external network).
  // Async exec (not execFileSync) so this process's event loop stays alive
  // to serve the child process's HTTP requests.
  const { stdout } = await execFileAsync('node', [BIN, 'seo', base + '/', '--json']);
  const payload = JSON.parse(stdout);
  ok(payload.tool === 'rvo seo', 'CLI --json emits an rvo seo report');
  ok(payload.score >= 80, `CLI report scores high on the good fixture (got ${payload.score})`);
  ok(payload.categories.crawlability.score === 100, 'CLI report: crawlability perfect with robots+sitemap');

  server.close();
  console.log(`\nAll rvo seo tests passed (${n} assertions).`);
}

main().catch(e => {
  server.close();
  console.error('SEO test failure:', e);
  process.exit(1);
});
