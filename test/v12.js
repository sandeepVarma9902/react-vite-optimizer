// v1.2 tests: --json/--html report formats, CI mode (--ci/--max-issues/
// --fail-on), `rvo doctor`, and the new bundle-budget + image checks.
// Run with: node test/v12.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const FIXTURE = path.join(ROOT, 'test-fixture');

// Isolated HOME pre-seeded with a valid cached license (fresh cache hit —
// no network, no bypass), matching test/run.js.
const LIC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-v12-lic-'));
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

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  } else {
    console.log('ok:', msg);
  }
}

function w(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function runCapture(args, cwd) {
  try {
    const out = execFileSync('node', [BIN, ...args], {
      encoding: 'utf8',
      cwd: cwd || ROOT,
      timeout: 60000,
      env: { ...process.env, HOME: LIC_HOME, RVO_LICENSE_KEY: '' },
    });
    return { out, code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status == null ? 1 : e.status };
  }
}

function jsonOf(args, cwd) {
  const r = runCapture(args, cwd);
  assert(r.code === 0, `${args.join(' ')} exits 0 (got ${r.code})`);
  try {
    return JSON.parse(r.out);
  } catch {
    assert(false, `${args.join(' ')} prints valid JSON`);
    return null;
  }
}

// ------------------------------------------------------------ --json format
{
  const j = jsonOf(['analyze', '--json', FIXTURE]);
  if (j) {
    assert(j.root === FIXTURE, '--json root matches');
    assert(j.vite === true, '--json vite flag true for fixture');
    assert(j.summary.total === 6, '--json summary.total is 6');
    assert(j.summary.bySeverity.warning === 6, '--json all 6 findings are warnings');
    assert(j.lazy.length === 2 && j.memo.length === 3 && j.usememo.length === 1, '--json rule counts 2/3/1');
    const all = [...j.lazy, ...j.memo, ...j.usememo];
    assert(all.every(f => ['info', 'warning', 'error'].includes(f.severity)), 'every finding carries a severity');
    assert(Array.isArray(j.bundle) && Array.isArray(j.images), '--json includes bundle/images arrays');
  }
  const sub = jsonOf(['analyze', '--json', '--only', 'bundle,images', FIXTURE]);
  if (sub) {
    assert(sub.lazy.length === 0 && sub.memo.length === 0 && sub.usememo.length === 0, '--only bundle,images excludes code rules');
    assert(sub.summary.total === 0, '--only bundle,images totals 0 on fixture (no dist/images)');
  }
}

// ------------------------------------------------------------ --html format
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-v12-html-'));
  const r = runCapture(['analyze', '--html', FIXTURE], dir);
  assert(r.code === 0, 'analyze --html exits 0');
  const p = path.join(dir, 'rvo-report.html');
  assert(fs.existsSync(p), 'analyze --html writes rvo-report.html to cwd');
  if (fs.existsSync(p)) {
    const html = fs.readFileSync(p, 'utf8');
    assert(html.includes('<!DOCTYPE html>'), 'html report is a full document');
    assert(html.includes('Lazy-loading candidates'), 'html report has lazy section');
    assert(html.includes('Bundle budget'), 'html report has bundle section');
    assert(!/<script/.test(html), 'html report has no scripts (self-contained)');
  }
  const custom = path.join(dir, 'custom.html');
  const r2 = runCapture(['analyze', '--html', '--output', custom, FIXTURE], dir);
  assert(r2.code === 0 && fs.existsSync(custom), 'analyze --html --output writes to custom path');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------------------ CI mode
{
  const pass = runCapture(['analyze', '--ci', '--max-issues', '100', FIXTURE]);
  assert(pass.code === 0 && /CI check passed/.test(pass.out), '--ci --max-issues 100 passes on fixture');

  const fail = runCapture(['analyze', '--ci', '--max-issues', '2', FIXTURE]);
  assert(fail.code === 1, '--ci --max-issues 2 exits non-zero');
  assert(/CI check failed/.test(fail.out) && /exceed --max-issues 2/.test(fail.out), 'CI failure names the breached gate');

  const def = runCapture(['analyze', '--ci', FIXTURE]);
  assert(def.code === 1, '--ci alone defaults to max-issues 0 and fails on fixture');

  const sevOk = runCapture(['analyze', '--ci', '--max-issues', '100', '--fail-on', 'error', FIXTURE]);
  assert(sevOk.code === 0, '--fail-on error passes when only warnings exist');

  const sevFail = runCapture(['analyze', '--ci', '--max-issues', '100', '--fail-on', 'warning', FIXTURE]);
  assert(sevFail.code === 1 && /severity "warning" or above/.test(sevFail.out), '--fail-on warning fails on warning findings');

  const bad = runCapture(['analyze', '--ci', '--fail-on', 'bogus', FIXTURE]);
  assert(bad.code === 1 && /invalid --fail-on/.test(bad.out), 'invalid --fail-on severity errors clearly');

  // --ci --json keeps stdout parseable (verdict goes to stderr)
  const cj = runCapture(['analyze', '--ci', '--json', '--max-issues', '100', FIXTURE]);
  let parsed = null;
  try { parsed = JSON.parse(cj.out); } catch {}
  assert(cj.code === 0 && parsed && parsed.summary.total === 6, '--ci --json emits clean parseable JSON');
}

// ------------------------------------------- bundle + image checks (temp app)
function makeBundleProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-v12-b-'));
  w(d, 'package.json', JSON.stringify({
    name: 'b',
    private: true,
    dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0', vite: '^5.0.0' },
    scripts: { build: 'vite build' },
  }));
  w(d, 'src/index.js', 'export default 1;\n');
  fs.mkdirSync(path.join(d, 'dist', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(d, 'public'), { recursive: true });
  fs.writeFileSync(path.join(d, 'dist', 'assets', 'index-abc123.js'), Buffer.alloc(600 * 1024));
  fs.writeFileSync(path.join(d, 'dist', 'assets', 'vendor-def456.js'), Buffer.alloc(450 * 1024));
  fs.writeFileSync(path.join(d, 'public', 'hero.png'), Buffer.alloc(300 * 1024));
  fs.writeFileSync(path.join(d, 'public', 'tiny.jpg'), Buffer.alloc(10 * 1024));
  return d;
}
const BDIR = makeBundleProject();
try {
  const j = jsonOf(['analyze', '--json', BDIR]);
  if (j) {
    const big = j.bundle.find(b => b.chunk === 'index-abc123.js');
    assert(big && big.severity === 'error' && big.sizeKb === 600, '600 kB chunk flagged as error');
    assert(big && /budget/.test(big.hint), 'bundle finding hint mentions the budget');
    const near = j.bundle.find(b => b.chunk === 'vendor-def456.js');
    assert(near && near.severity === 'warning', '450 kB chunk (over 80% of 500 kB) flagged as warning');
    const hero = j.images.find(i => i.file.endsWith('hero.png'));
    assert(hero && hero.severity === 'info' && hero.sizeKb === 300, '300 kB PNG flagged as info');
    assert(hero && /WebP/.test(hero.hint), 'image hint suggests WebP/AVIF');
    assert(!j.images.some(i => i.file.endsWith('tiny.jpg')), '10 kB image not flagged');
    assert(j.summary.bySeverity.error === 1 && j.summary.bySeverity.info === 1, 'summary counts error/info correctly');
  }
  const gate = runCapture(['analyze', '--ci', '--max-issues', '100', '--fail-on', 'error', BDIR]);
  assert(gate.code === 1, '--fail-on error fails when a chunk is over budget');

  // no dist/ -> bundle check quietly skipped
  fs.rmSync(path.join(BDIR, 'dist'), { recursive: true, force: true });
  const nodist = jsonOf(['analyze', '--json', '--only', 'bundle', BDIR]);
  if (nodist) assert(nodist.bundle.length === 0, 'bundle check skipped when dist/ is missing');
} finally {
  fs.rmSync(BDIR, { recursive: true, force: true });
}

// ------------------------------------------------------------------- doctor
{
  const d = runCapture(['doctor', FIXTURE]);
  assert(d.code === 0, 'doctor exits 0 on healthy fixture');
  for (const s of ['Node.js', 'npm', 'package.json', 'React', 'Vite', 'src/']) {
    assert(d.out.includes(s), `doctor output mentions ${s}`);
  }

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-v12-empty-'));
  const e = runCapture(['doctor', empty]);
  assert(e.code === 1 && /package\.json/.test(e.out), 'doctor exits 1 with no package.json');
  fs.rmSync(empty, { recursive: true, force: true });

  const noreact = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-v12-noreact-'));
  w(noreact, 'package.json', JSON.stringify({ name: 'x', dependencies: { vite: '^5.0.0' } }));
  const nr = runCapture(['doctor', noreact]);
  assert(nr.code === 1 && /React dependency/.test(nr.out), 'doctor exits 1 when react is missing');
  fs.rmSync(noreact, { recursive: true, force: true });
}

// ------------------------------------------- fix ignores analyze-only rules
{
  const f = runCapture(['fix', '--only', 'bundle', FIXTURE, '-y']);
  assert(f.code === 0 && /analyze-only/.test(f.out), 'fix --only bundle exits gracefully (analyze-only)');
}

fs.rmSync(LIC_HOME, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll v1.2 tests passed.');
}
