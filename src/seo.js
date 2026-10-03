// rvo seo — website SEO analyzer (free tier, lead magnet).
//
// Architecture: this module is PURE — analyzeSeo(html, meta) takes an HTML
// string plus fetch metadata and returns a report object. No network here,
// so it is fully unit-testable. The network layer lives in seo-fetch.js.
'use strict';

const path = require('path');
const chalk = require('chalk');

// ---------------------------------------------------------------- parsing
// Small regex-based HTML parsing. Good enough for SEO signals (meta tags,
// headings, images, links, scripts); we deliberately do NOT execute JS,
// so JS-rendered content is out of scope (documented as a limitation).

function getTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function getMetas(html) {
  const out = [];
  const re = /<meta\s+([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const name = /name\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const prop = /property\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const content = /content\s*=\s*["']([\s\S]*?)["']/i.exec(attrs);
    const httpEquiv = /http-equiv\s*=\s*["']([^"']+)["']/i.exec(attrs);
    out.push({
      name: name ? name[1].toLowerCase() : null,
      property: prop ? prop[1].toLowerCase() : null,
      httpEquiv: httpEquiv ? httpEquiv[1].toLowerCase() : null,
      content: content ? content[1].trim() : '',
    });
  }
  return out;
}

function metaContent(metas, key) {
  const hit = metas.find(
    m => m.name === key || m.property === key
  );
  return hit ? hit.content : null;
}

function getCharset(html) {
  let m = html.match(/<meta\s+charset\s*=\s*["']?([^"'\s>]+)/i);
  if (m) return m[1];
  m = html.match(/<meta\s+[^>]*http-equiv\s*=\s*["']content-type["'][^>]*content\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function getCanonical(html) {
  const m = html.match(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/i);
  if (!m) return null;
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0]);
  return href ? href[1] : '';
}

function getHead(html) {
  const m = html.match(/<head[^>]*>([\s\S]*?)<\/head\s*>/i);
  return m ? m[1] : '';
}

function getHeadings(html) {
  const out = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    out.push({
      level: parseInt(m[1], 10),
      text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120),
    });
  }
  return out;
}

function getImages(html) {
  const out = [];
  const re = /<img\s+([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const alt = /alt\s*=\s*["']([\s\S]*?)["']/i.exec(attrs);
    out.push({ src: src ? src[1] : '', alt: alt ? alt[1] : null });
  }
  return out;
}

function getLinks(html) {
  const out = [];
  const re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1].trim());
  return out;
}

function getHeadScripts(html) {
  const head = getHead(html);
  const blocking = [];
  const re = /<script\s+([^>]*?)>/gi;
  let m;
  while ((m = re.exec(head))) {
    const attrs = m[1];
    if (!/src\s*=/i.test(attrs)) continue; // inline — not render-blocking in the same way
    if (/\b(defer|async)\b/i.test(attrs)) continue;
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(attrs);
    blocking.push(src ? src[1] : '(inline attrs)');
  }
  return blocking;
}

function hostnameOf(href, baseHost) {
  try {
    if (/^(mailto|tel|javascript|data):/i.test(href)) return null;
    if (href.startsWith('#')) return null;
    const u = new URL(href, `https://${baseHost}/`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- analysis
function analyzeSeo(html, meta) {
  const issues = [];
  const err = (category, message, fix) => issues.push({ severity: 'error', category, message, fix });
  const warn = (category, message, fix) => issues.push({ severity: 'warning', category, message, fix });
  const info = (category, message, fix) => issues.push({ severity: 'info', category, message, fix });

  const metas = getMetas(html);
  const title = getTitle(html);
  const desc = metaContent(metas, 'description');
  const viewport = metaContent(metas, 'viewport');
  const charset = getCharset(html);
  const canonical = getCanonical(html);
  const robotsMeta = metaContent(metas, 'robots');

  // ---- category: meta ----
  let metaScore = 100;
  const metaChecks = [];
  const check = (name, ok, detail) => {
    metaChecks.push({ name, status: ok === true ? 'pass' : ok === 'warn' ? 'warn' : 'fail', detail });
  };
  if (!title) {
    err('meta', 'Missing <title> tag', 'Add a unique <title> of 30–60 characters describing the page.');
    metaScore -= 25; check('title', false, 'missing');
  } else if (title.length < 30 || title.length > 60) {
    warn('meta', `Title is ${title.length} characters (ideal: 30–60)`, 'Rewrite the title to 30–60 characters, keyword near the front.');
    metaScore -= 10; check('title', 'warn', `${title.length} chars`);
  } else {
    check('title', true, `${title.length} chars`);
  }
  if (!desc) {
    err('meta', 'Missing meta description', 'Add <meta name="description" content="…"> of 120–160 characters.');
    metaScore -= 20; check('description', false, 'missing');
  } else if (desc.length < 120 || desc.length > 160) {
    warn('meta', `Meta description is ${desc.length} characters (ideal: 120–160)`, 'Rewrite to 120–160 characters with a call to action.');
    metaScore -= 8; check('description', 'warn', `${desc.length} chars`);
  } else {
    check('description', true, `${desc.length} chars`);
  }
  if (!viewport) { warn('meta', 'Missing viewport meta tag', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'); metaScore -= 8; check('viewport', false, 'missing'); }
  else check('viewport', true, 'present');
  if (!charset) { warn('meta', 'No charset declared', 'Add <meta charset="utf-8"> as the first tag in <head>.'); metaScore -= 5; check('charset', false, 'missing'); }
  else check('charset', true, charset);
  if (canonical === null) { warn('meta', 'No canonical URL', 'Add <link rel="canonical" href="…"> to avoid duplicate-content issues.'); metaScore -= 7; check('canonical', false, 'missing'); }
  else if (!canonical) { warn('meta', 'Canonical link has an empty href', 'Point rel="canonical" at the preferred URL.'); metaScore -= 7; check('canonical', 'warn', 'empty href'); }
  else check('canonical', true, canonical);
  if (robotsMeta && /noindex/i.test(robotsMeta)) { err('meta', 'robots meta set to noindex — page will not appear in search', 'Remove noindex unless this page should genuinely be hidden from search.'); metaScore -= 25; check('robots meta', false, robotsMeta); }
  else check('robots meta', true, robotsMeta || 'not set (indexable)');
  metaScore = Math.max(0, metaScore);

  // ---- category: social ----
  let socialScore = 100;
  const socialChecks = [];
  const scheck = (name, ok, detail) => {
    socialChecks.push({ name, status: ok === true ? 'pass' : ok === 'warn' ? 'warn' : 'fail', detail });
  };
  const ogTags = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
  for (const tag of ogTags) {
    const v = metaContent(metas, tag);
    if (!v) {
      warn('social', `Missing ${tag}`, `Add <meta property="${tag}" content="…"> for rich link previews.`);
      socialScore -= 8; scheck(tag, false, 'missing');
    } else scheck(tag, true, tag === 'og:image' ? v.slice(0, 60) : 'present');
  }
  const twCard = metaContent(metas, 'twitter:card');
  if (!twCard) {
    warn('social', 'Missing twitter:card tag', 'Add <meta name="twitter:card" content="summary_large_image">.');
    socialScore -= 8; scheck('twitter:card', false, 'missing');
  } else scheck('twitter:card', true, twCard);
  if (!metaContent(metas, 'twitter:title') && !metaContent(metas, 'og:title')) {
    info('social', 'No twitter:title (falls back to og:title)', 'Add twitter:title for control over X/Twitter previews.');
    socialScore -= 2; scheck('twitter:title', 'warn', 'falls back to og:title');
  } else scheck('twitter:title', true, 'present or via og:title');
  const ogImage = metaContent(metas, 'og:image');
  if (ogImage && !/^https:\/\//i.test(ogImage)) {
    warn('social', 'og:image is not an absolute HTTPS URL', 'Use a full https:// URL — relative image URLs break link previews.');
    socialScore -= 5;
  }
  socialScore = Math.max(0, socialScore);

  // ---- category: structure ----
  let structScore = 100;
  const headings = getHeadings(html);
  const h1s = headings.filter(h => h.level === 1);
  const structChecks = [];
  const hcheck = (name, ok, detail) => {
    structChecks.push({ name, status: ok === true ? 'pass' : ok === 'warn' ? 'warn' : 'fail', detail });
  };
  if (h1s.length === 0) {
    err('structure', 'No <h1> on the page', 'Add exactly one <h1> with the page’s primary keyword.');
    structScore -= 20; hcheck('single h1', false, 'none found');
  } else if (h1s.length > 1) {
    warn('structure', `${h1s.length} <h1> tags found (should be 1)`, 'Keep one <h1>; demote the rest to <h2>.');
    structScore -= 10; hcheck('single h1', 'warn', `${h1s.length} found`);
  } else hcheck('single h1', true, h1s[0].text.slice(0, 60));
  let skipped = 0;
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) skipped++;
  }
  if (skipped > 0) {
    warn('structure', `Heading hierarchy skips ${skipped} level(s) (e.g. h2 → h4)`, 'Keep headings sequential — don’t skip levels for styling.');
    structScore -= 8; hcheck('heading order', 'warn', `${skipped} skip(s)`);
  } else hcheck('heading order', true, `${headings.length} headings`);
  const images = getImages(html);
  const withAlt = images.filter(im => im.alt !== null && im.alt.trim() !== '');
  const altPct = images.length ? Math.round((withAlt.length / images.length) * 100) : 100;
  if (images.length && altPct < 100) {
    const sev = altPct < 50 ? err : warn;
    sev('structure', `${images.length - withAlt.length} of ${images.length} images missing alt text (${altPct}% covered)`, 'Add descriptive alt attributes — it’s accessibility and image SEO.');
    structScore -= altPct < 50 ? 15 : 8;
    hcheck('image alt', altPct < 50 ? false : 'warn', `${altPct}%`);
  } else hcheck('image alt', true, images.length ? `${altPct}%` : 'no images');
  let pageHost = null;
  try { pageHost = new URL(meta.finalUrl || meta.url).hostname.toLowerCase(); } catch { /* ignore */ }
  let internal = 0, external = 0;
  for (const href of getLinks(html)) {
    const h = pageHost ? hostnameOf(href, pageHost) : null;
    if (h === null) continue;
    if (h === pageHost) internal++; else external++;
  }
  hcheck('links', true, `${internal} internal / ${external} external`);
  if (internal === 0 && getLinks(html).length > 0) {
    info('structure', 'No internal links detected', 'Link to related pages — internal linking helps crawling and ranking.');
    structScore -= 3;
  }
  structScore = Math.max(0, structScore);

  // ---- category: crawlability ----
  let crawlScore = 100;
  const crawlChecks = [];
  const ccheck = (name, ok, detail) => {
    crawlChecks.push({ name, status: ok === true ? 'pass' : ok === 'warn' ? 'warn' : 'fail', detail });
  };
  if (meta.status == null) {
    warn('crawlability', 'HTTP status unknown', 'Could not determine the response status.');
    crawlScore -= 10; ccheck('status', 'warn', 'unknown');
  } else if (meta.status >= 400) {
    err('crawlability', `Page returns HTTP ${meta.status}`, 'Fix the status — error pages don’t rank.');
    crawlScore -= 30; ccheck('status', false, `HTTP ${meta.status}`);
  } else if (meta.status >= 300) {
    warn('crawlability', `Page redirects (HTTP ${meta.status})`, 'Minimize redirect chains — link directly to the final URL.');
    crawlScore -= 5; ccheck('status', 'warn', `HTTP ${meta.status}`);
  } else ccheck('status', true, `HTTP ${meta.status}`);
  if ((meta.redirects || 0) > 1) {
    warn('crawlability', `${meta.redirects} redirects before the final URL`, 'Each redirect costs crawl budget and speed — link to the final URL.');
    crawlScore -= 8; ccheck('redirects', 'warn', `${meta.redirects}`);
  } else ccheck('redirects', true, `${meta.redirects || 0}`);
  if (!meta.robots || !meta.robots.present) {
    warn('crawlability', 'No robots.txt found', 'Add a robots.txt (even a permissive one) so crawlers know the rules.');
    crawlScore -= 8; ccheck('robots.txt', 'warn', 'missing');
  } else if (meta.robots.blocksAll) {
    err('crawlability', 'robots.txt disallows all crawling (Disallow: /)', 'Remove the blanket disallow unless the whole site should be hidden.');
    crawlScore -= 30; ccheck('robots.txt', false, 'blocks all');
  } else ccheck('robots.txt', true, 'present, allows crawling');
  if (!meta.sitemap || !meta.sitemap.present) {
    warn('crawlability', 'No sitemap.xml found', 'Add a sitemap.xml and reference it from robots.txt to help discovery.');
    crawlScore -= 8; ccheck('sitemap.xml', 'warn', 'missing');
  } else if (!meta.sitemap.valid) {
    warn('crawlability', 'sitemap.xml could not be parsed', 'Validate the sitemap XML and ensure it lists <url> entries.');
    crawlScore -= 8; ccheck('sitemap.xml', 'warn', 'invalid');
  } else ccheck('sitemap.xml', true, `${meta.sitemap.urls} URL(s)`);
  crawlScore = Math.max(0, crawlScore);

  // ---- category: performance ----
  let perfScore = 100;
  const perfChecks = [];
  const pcheck = (name, ok, detail) => {
    perfChecks.push({ name, status: ok === true ? 'pass' : ok === 'warn' ? 'warn' : 'fail', detail });
  };
  if (meta.ttfbMs != null) {
    if (meta.ttfbMs > 1000) { warn('performance', `Slow TTFB: ${meta.ttfbMs}ms`, 'Speed up server response — caching, CDN, or lighter server work.'); perfScore -= 15; pcheck('TTFB', 'warn', `${meta.ttfbMs}ms`); }
    else if (meta.ttfbMs > 600) { warn('performance', `TTFB ${meta.ttfbMs}ms is borderline`, 'Aim for <600ms server response.'); perfScore -= 8; pcheck('TTFB', 'warn', `${meta.ttfbMs}ms`); }
    else pcheck('TTFB', true, `${meta.ttfbMs}ms`);
  } else pcheck('TTFB', 'warn', 'unknown');
  const kb = meta.bytes != null ? meta.bytes / 1024 : null;
  if (kb != null) {
    if (kb > 2048) { warn('performance', `Heavy page: ${Math.round(kb)}KB transferred`, 'Compress images, code-split JS, drop unused libraries.'); perfScore -= 15; pcheck('page weight', 'warn', `${Math.round(kb)}KB`); }
    else if (kb > 512) { info('performance', `Page weight ${Math.round(kb)}KB — room to trim`, 'Audit large assets; lazy-load below-the-fold media.'); perfScore -= 5; pcheck('page weight', 'warn', `${Math.round(kb)}KB`); }
    else pcheck('page weight', true, `${Math.round(kb)}KB`);
  } else pcheck('page weight', 'warn', 'unknown');
  const enc = (meta.contentEncoding || '').toLowerCase();
  if (/gzip|br|deflate|zstd/.test(enc)) pcheck('compression', true, enc);
  else { info('performance', 'No text compression detected', 'Enable gzip or Brotli on the server — free speed.'); perfScore -= 5; pcheck('compression', 'warn', 'none'); }
  const blocking = getHeadScripts(html);
  if (blocking.length > 0) {
    warn('performance', `${blocking.length} render-blocking script(s) in <head>`, 'Add defer/async or move scripts before </body>.');
    perfScore -= Math.min(12, blocking.length * 4);
    pcheck('render-blocking JS', 'warn', `${blocking.length} script(s)`);
  } else pcheck('render-blocking JS', true, 'none');
  perfScore = Math.max(0, perfScore);

  // ---- overall ----
  const weights = { meta: 0.3, social: 0.1, structure: 0.25, crawlability: 0.2, performance: 0.15 };
  const score = Math.round(
    metaScore * weights.meta +
    socialScore * weights.social +
    structScore * weights.structure +
    crawlScore * weights.crawlability +
    perfScore * weights.performance
  );
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  const sevRank = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  return {
    tool: 'rvo seo',
    url: meta.url,
    finalUrl: meta.finalUrl || meta.url,
    status: meta.status,
    redirects: meta.redirects || 0,
    ttfbMs: meta.ttfbMs,
    pageKb: kb != null ? Math.round(kb) : null,
    contentEncoding: meta.contentEncoding || null,
    title: title,
    generatedAt: new Date().toISOString(),
    score,
    grade,
    categories: {
      meta: { score: metaScore, checks: metaChecks },
      social: { score: socialScore, checks: socialChecks },
      structure: { score: structScore, checks: structChecks, h1Count: h1s.length, headings: headings.length, images: images.length, altCoveragePct: altPct, internalLinks: internal, externalLinks: external },
      crawlability: { score: crawlScore, checks: crawlChecks },
      performance: { score: perfScore, checks: perfChecks, blockingScripts: blocking.length },
    },
    issues,
    issueCounts: {
      error: issues.filter(i => i.severity === 'error').length,
      warning: issues.filter(i => i.severity === 'warning').length,
      info: issues.filter(i => i.severity === 'info').length,
    },
  };
}

// ---------------------------------------------------------------- printing
function gradeColor(grade) {
  return grade === 'A' ? chalk.green : grade === 'B' ? chalk.cyan : grade === 'C' ? chalk.yellow : chalk.red;
}

function bar(score) {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function printSeo(r) {
  const gc = gradeColor(r.grade);
  console.log(chalk.bold.cyan('\nrvo seo — website SEO analysis'));
  console.log(chalk.dim('  ' + r.finalUrl));
  console.log(`\n  Grade: ${gc.bold(r.grade)}  ${gc(r.score + '/100')}`);
  console.log(`  ${r.issueCounts.error} error(s), ${r.issueCounts.warning} warning(s), ${r.issueCounts.info} note(s)\n`);
  const cats = [
    ['Meta tags', r.categories.meta.score],
    ['Social cards', r.categories.social.score],
    ['Structure', r.categories.structure.score],
    ['Crawlability', r.categories.crawlability.score],
    ['Performance', r.categories.performance.score],
  ];
  for (const [name, s] of cats) {
    const c = s >= 80 ? chalk.green : s >= 60 ? chalk.yellow : chalk.red;
    console.log(`  ${name.padEnd(13)} ${c(bar(s))} ${c(s)}`);
  }
  if (r.title) console.log(chalk.dim(`\n  Title: "${r.title.slice(0, 80)}${r.title.length > 80 ? '…' : ''}"`));
  if (r.issues.length) {
    console.log(chalk.bold('\n  Issues (fix in this order):'));
    for (const i of r.issues.slice(0, 15)) {
      const mark = i.severity === 'error' ? chalk.red('✗') : i.severity === 'warning' ? chalk.yellow('!') : chalk.dim('·');
      console.log(`  ${mark} ${i.message}`);
      console.log(chalk.dim(`      → ${i.fix}`));
    }
    if (r.issues.length > 15) console.log(chalk.dim(`  …and ${r.issues.length - 15} more (see --json/--html)`));
  } else {
    console.log(chalk.green('\n  ✓ No issues found — clean bill of health.'));
  }
  console.log(chalk.dim('  Want A–F grades, scan history & PDF reports? SEO Toolkit dashboard:'));
  console.log(chalk.cyan('  https://rvotools.gumroad.com/l/seo-toolkit'));
  console.log('');
}

// ---------------------------------------------------------------- HTML
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSeoHtmlReport(r) {
  const gc = r.grade === 'A' ? 'ok' : r.grade === 'B' ? 'info' : r.grade === 'C' ? 'warn' : 'err';
  const catCards = Object.entries(r.categories)
    .map(([k, c]) => {
      const cls = c.score >= 80 ? 'ok' : c.score >= 60 ? 'warn' : 'err';
      const rows = c.checks.map(ch =>
        `<tr><td>${esc(ch.name)}</td>` +
        `<td><span class="sev sev-${ch.status === 'pass' ? 'ok' : ch.status === 'warn' ? 'warning' : 'error'}">${esc(ch.status)}</span></td>` +
        `<td class="dim">${esc(ch.detail)}</td></tr>`
      ).join('');
      return `<h2>${esc(k[0].toUpperCase() + k.slice(1))} — <span class="${cls}">${c.score}</span></h2>` +
        `<table><tr><th>Check</th><th>Status</th><th>Detail</th></tr>${rows}</table>`;
    })
    .join('');
  const issueRows = r.issues.length
    ? r.issues.map(i =>
        `<div class="issue sev-${i.severity}"><b>${esc(i.severity.toUpperCase())}</b> [${esc(i.category)}] ${esc(i.message)}<br>` +
        `<span class="dim">→ ${esc(i.fix)}</span></div>`
      ).join('')
    : '<p class="none">No issues found.</p>';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>rvo seo — grade ${esc(r.grade)} — ${esc(r.finalUrl)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;background:#0b0e14;color:#e6e9f0}
h1{font-size:1.5rem} h2{font-size:1.15rem;margin-top:2.2rem;color:#e6e9f0}
.meta{color:#9aa3b2} .badge{display:inline-block;padding:.3rem .9rem;border-radius:999px;font-size:1rem;font-weight:800}
.ok{color:#3fb950}.warn{color:#d29922}.info{color:#61dafb}.err{color:#f85149}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #1d2536;vertical-align:top}
th{color:#9aa3b2;font-weight:600} .dim{color:#9aa3b2;font-size:.85rem} .none{color:#6b7688;font-style:italic}
.sev{border-radius:4px;padding:.1rem .45rem;font-size:.75rem;font-weight:600}
.sev-error{background:#3d1518;color:#f85149}.sev-warning{background:#3a2c10;color:#d29922}
.sev-ok{background:#12351f;color:#3fb950}
.issue{border:1px solid #1d2536;background:#11151f;border-radius:8px;padding:.6rem .9rem;margin:.4rem 0;font-size:.9rem}
.issue.sev-error{border-color:#3d1518}.issue.sev-warning{border-color:#3a2c10}
.cards{display:flex;gap:.75rem;margin:1rem 0;flex-wrap:wrap}
.card{border:1px solid #1d2536;background:#11151f;border-radius:8px;padding:.75rem 1rem;min-width:110px}
.card b{font-size:1.4rem;display:block}
footer{margin-top:2.5rem;color:#6b7688;font-size:.8rem}
</style></head><body>
<h1>rvo seo — website SEO analysis</h1>
<p class="meta">${esc(r.finalUrl)}<br>HTTP ${esc(r.status)}${r.redirects ? ` · ${r.redirects} redirect(s)` : ''}${r.pageKb != null ? ` · ${r.pageKb}KB` : ''}<br>Generated ${esc(r.generatedAt)}</p>
<p><span class="badge ${gc}">Grade ${esc(r.grade)} — ${r.score}/100</span></p>
<div class="cards">
<div class="card"><b class="${r.categories.meta.score >= 80 ? 'ok' : r.categories.meta.score >= 60 ? 'warn' : 'err'}">${r.categories.meta.score}</b>meta</div>
<div class="card"><b class="${r.categories.social.score >= 80 ? 'ok' : r.categories.social.score >= 60 ? 'warn' : 'err'}">${r.categories.social.score}</b>social</div>
<div class="card"><b class="${r.categories.structure.score >= 80 ? 'ok' : r.categories.structure.score >= 60 ? 'warn' : 'err'}">${r.categories.structure.score}</b>structure</div>
<div class="card"><b class="${r.categories.crawlability.score >= 80 ? 'ok' : r.categories.crawlability.score >= 60 ? 'warn' : 'err'}">${r.categories.crawlability.score}</b>crawlability</div>
<div class="card"><b class="${r.categories.performance.score >= 80 ? 'ok' : r.categories.performance.score >= 60 ? 'warn' : 'err'}">${r.categories.performance.score}</b>performance</div>
</div>
<h2>Issues (${r.issues.length})</h2>${issueRows}
${catCards}
<footer>Generated by react-vite-optimizer — rvo seo · Static HTML analysis only; JS-rendered content, Core Web Vitals lab data, and keyword rankings are out of scope.<br>Want A–F grades, scan history &amp; PDF reports? <a href="https://rvotools.gumroad.com/l/seo-toolkit" style="color:#61dafb">SEO Toolkit dashboard</a></footer>
</body></html>`;
}

module.exports = { analyzeSeo, printSeo, buildSeoHtmlReport };
