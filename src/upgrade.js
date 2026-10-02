// Dependency upgrades: compare each dependency against the npm registry's
// `latest` dist-tag (stable by definition) and rewrite package.json.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const semver = require('semver');
const { readJson } = require('./utils');

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'react-vite-optimizer/1.0' } },
      res => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          getJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          res.resume();
          return;
        }
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timed out')));
  });
}

function classify(r, includeMajor) {
  const { range, latest } = r;
  if (!latest) return { ...r, status: 'error' };
  let min;
  try {
    if (!semver.validRange(range))
      return { ...r, status: 'skip', note: 'non-semver range' };
    min = semver.minVersion(range);
  } catch {
    return { ...r, status: 'skip', note: 'unparseable range' };
  }
  if (!min) return { ...r, status: 'skip', note: 'unparseable range' };
  if (semver.gte(min.version, latest)) return { ...r, status: 'up-to-date' };
  const bump = semver.diff(min.version, latest);
  if ((bump === 'major' || bump === 'premajor') && !includeMajor)
    return { ...r, status: 'major-available', bump, current: min.version };
  return { ...r, status: 'update', bump, current: min.version };
}

async function checkUpdates(root, { includeMajor = false } = {}) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = readJson(pkgPath);
  const entries = [];
  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[group] || {}))
      entries.push({ group, name, range });
  }
  const results = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async e => {
        try {
          const meta = await getJson(
            `https://registry.npmjs.org/${encodeURIComponent(e.name)}/latest`
          );
          return { ...e, latest: meta.version };
        } catch (err) {
          return { ...e, latest: null, error: String((err && err.message) || err) };
        }
      })
    );
    for (const r of settled) results.push(classify(r, includeMajor));
  }
  return { pkgPath, pkg, results };
}

// Keep the user's range style (^, ~, pinned); bail on exotic ranges.
function newRange(range, latest) {
  const m = String(range).match(/^([\^~])(\d+\.\d+\.\d+.*)$/);
  if (m) return m[1] + latest;
  if (/^\d+\.\d+\.\d+/.test(String(range))) return latest;
  return null;
}

function applyUpdates(root, check, { install = true, verify = false } = {}) {
  const { pkgPath, pkg, results } = check;
  const updates = results.filter(r => r.status === 'update');
  for (const u of updates) {
    const nr = newRange(u.range, u.latest);
    if (!nr) {
      u.status = 'skip';
      u.note = 'complex range, left unchanged';
      continue;
    }
    pkg[u.group][u.name] = nr;
  }
  const applied = updates.filter(u => u.status === 'update');
  if (!applied.length) return { applied: [] };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  if (install) execSync('npm install', { cwd: root, stdio: 'inherit' });
  if (verify && pkg.scripts && pkg.scripts.build)
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  return { applied };
}

module.exports = { checkUpdates, applyUpdates };
