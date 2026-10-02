// Self-test: exercises analyze + fix against test-fixture, then restores it.
// Run with: npm test
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const FIXTURE = path.join(ROOT, 'test-fixture');
const SRC = path.join(FIXTURE, 'src');

// Isolated HOME pre-seeded with a valid cached license, so commercial
// commands run against a fresh cache hit without touching the network.
// (There is no bypass env var — the gate is always live.)
const LIC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-test-lic-'));
fs.mkdirSync(path.join(LIC_HOME, '.rvo'), { recursive: true });
fs.writeFileSync(
  path.join(LIC_HOME, '.rvo', 'license.json'),
  JSON.stringify({
    key: 'test-key-do-not-use',
    valid: true,
    validatedAt: Date.now(),
    instanceId: 'test-instance-id',
    instanceName: 'test-instance',
    product: 'Solo',
    variant: 'Default',
    status: 'active',
  })
);

function snapshot(dir) {
  const out = new Map();
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(p, fs.readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

function restore(snap) {
  for (const [p, content] of snap) fs.writeFileSync(p, content);
}

function run(args) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: LIC_HOME, RVO_LICENSE_KEY: '' },
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const snap = snapshot(SRC);
try {
  const a = run(['analyze', FIXTURE]);
  assert(/6 optimization\(s\) found/.test(a), 'analyze finds 6 optimizations');
  assert(/Lazy-loading candidates \(2\)/.test(a), 'analyze finds 2 lazy candidates');
  assert(/React\.memo candidates \(3\)/.test(a), 'analyze finds 3 memo candidates');
  assert(/useMemo candidates \(1\)/.test(a), 'analyze finds 1 useMemo candidate');
  assert(/deps: \[items, query\]/.test(a), 'useMemo deps inferred as [items, query]');

  const f = run(['fix', FIXTURE, '-y']);
  assert(/lazy-loading: 2 applied/.test(f), 'fix applies 2 lazy transforms');
  assert(/React\.memo: 3 applied/.test(f), 'fix applies 3 memo transforms');
  assert(/useMemo: 1 applied/.test(f), 'fix applies 1 useMemo transform');

  const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
  assert(/lazy\(\(\) => import\("\.\/pages\/Dashboard"\)\)/.test(app), 'Dashboard lazy-loaded');
  assert(/<Suspense fallback={<div>Loading…<\/div>}>/.test(app), 'Suspense boundary added');
  assert(!/import Dashboard from/.test(app), 'static Dashboard import removed');

  const exp = fs.readFileSync(path.join(SRC, 'components', 'ExpensiveList.jsx'), 'utf8');
  assert(/useMemo\(\(\) => items\.filter/.test(exp), 'useMemo wraps filter chain');
  assert(/\[items, query\]/.test(exp), 'useMemo deps correct');
  assert(/export default memo\(function ExpensiveList/.test(exp), 'memo wraps component');

  const f2 = run(['fix', FIXTURE, '-y']);
  assert(/Already optimized/.test(f2), 'second fix run is a no-op (idempotent)');
  assert(
    /Verification — re-scanned after fix/.test(f),
    'fix prints a verification report'
  );
  assert(
    /All 6 detected issue\(s\) resolved/.test(f),
    'verification shows 6 → 0 resolved'
  );

  // ---- license gating (isolated HOME so no cached key leaks in)
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-test-home-'));
  function runRaw(args) {
    const env = { ...process.env, HOME: emptyHome, RVO_LICENSE_KEY: '' };
    try {
      return {
        out: execFileSync('node', [BIN, ...args], { encoding: 'utf8', env }),
        code: 0,
      };
    } catch (e) {
      return { out: (e.stdout || '') + (e.stderr || ''), code: e.status || 1 };
    }
  }
  const gated = runRaw(['fix', FIXTURE, '-y']);
  assert(gated.code !== 0, 'fix without a license exits non-zero');
  assert(
    /license key is required/i.test(gated.out),
    'fix without a license explains how to get one'
  );
  assert(
    /rvo analyze/.test(gated.out),
    'license gate mentions analyze is free'
  );
  const free = runRaw(['analyze', FIXTURE]);
  assert(
    free.code === 0 && /Already optimized|optimization\(s\) found/.test(free.out),
    'analyze stays free without a license'
  );
  const licCheck = runRaw(['license', '--check']);
  assert(/No license key/.test(licCheck.out), 'license --check reports missing key');
  fs.rmSync(emptyHome, { recursive: true, force: true });

  // every file must still parse
  const { parse } = require(path.join(ROOT, 'src', 'utils'));
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(p)) parse(fs.readFileSync(p, 'utf8'), p);
    }
  };
  walk(SRC);
  console.log('ok: all transformed files parse');
} finally {
  restore(snap);
  fs.rmSync(LIC_HOME, { recursive: true, force: true });
}

if (!process.exitCode) console.log('\nAll tests passed.');
