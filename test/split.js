// Tests for `rvo split` (microfrontend analyzer, free tier) and
// `rvo split convert` (Module Federation scaffold generator, premium tier).
// Fixture: test/fixtures/split-demo — a React+Vite app with 3 route groups
// (/shop, /admin, /account), a shared components/ dir, cross-feature imports
// (admin → shop internals), and a Context provider used by two features.
// Run with: npm test
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'cli.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'split-demo');

function makeLicHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-split-home-'));
  fs.mkdirSync(path.join(dir, '.rvo'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.rvo', 'license.json'),
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
  return dir;
}
function makeEmptyHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-split-empty-'));
}
const LIC_HOME = makeLicHome();
const EMPTY_HOME = makeEmptyHome();

function run(args, home) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home || LIC_HOME },
  });
}
function runCode(args, home) {
  try {
    execFileSync('node', [BIN, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: home || LIC_HOME },
    });
    return 0;
  } catch (e) {
    return e.status;
  }
}
function snapshot(dir) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p) + ':' + fs.readFileSync(p, 'utf8').length);
    }
  };
  walk(dir);
  return out.sort().join('\n');
}
function ok(cond, msg) {
  assert(cond, msg);
  console.log('ok:', msg);
}

const beforeSnapshot = snapshot(FIXTURE);

// ---------------------------------------------------------------- analyzer
// The analyzer is free — run it with an empty home to prove no license needed.
const consoleOut = run(['split', FIXTURE], EMPTY_HOME);
ok(/Verdict: (RECOMMENDED|WORTH-CONSIDERING)/.test(consoleOut), 'verdict banner shows RECOMMENDED or WORTH-CONSIDERING');
ok(!/NOT-NEEDED/.test(consoleOut), 'verdict is not NOT-NEEDED');
ok(/shop/.test(consoleOut) && /admin/.test(consoleOut) && /account/.test(consoleOut), 'console names all three feature candidates');
ok(/admin → shop/.test(consoleOut), 'console flags the admin → shop coupling pair');
ok(/ShopContext/.test(consoleOut), 'console names the shared ShopContext');
ok(/rvo split convert/.test(consoleOut), 'console prints the convert next step');

// --json -------------------------------------------------------------------
const tmpJson = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-split-')), 'plan.json');
run(['split', FIXTURE, '--json', '--output', tmpJson], EMPTY_HOME);
const plan = JSON.parse(fs.readFileSync(tmpJson, 'utf8'));
ok(['worth-considering', 'recommended'].includes(plan.verdict), 'JSON verdict is worth-considering or recommended');
ok(plan.verdict !== 'not-needed', 'JSON verdict is not not-needed');

const feats = plan.clusters.filter(c => c.kind === 'feature');
ok(feats.length === 3, 'exactly 3 feature clusters detected');
const names = feats.map(c => c.name).sort();
ok(JSON.stringify(names) === JSON.stringify(['account', 'admin', 'shop']), 'clusters are account, admin, shop');

const byName = Object.fromEntries(feats.map(c => [c.name, c]));
ok(byName.shop.routes.some(r => r.startsWith('/shop')), 'shop cluster has /shop routes');
ok(byName.admin.routes.some(r => r.startsWith('/admin')), 'admin cluster has /admin routes');
ok(byName.account.routes.some(r => r.startsWith('/account')), 'account cluster has /account routes (incl. config-object routes)');

const pair = plan.coupling.pairs.find(p => p.from === 'admin' && p.to === 'shop');
ok(pair && pair.imports >= 2, 'coupling pair admin → shop flagged with its imports');
ok(pair && pair.risk === 'high', 'admin → shop coupling is high risk');

const ctx = plan.shared.contexts.find(c => c.names.includes('ShopContext'));
ok(ctx, 'shared Context ShopContext identified');
ok(ctx.usedBy.includes('shop') && ctx.usedBy.includes('account'), 'ShopContext used by shop and account');

ok(Array.isArray(plan.remotes) && plan.remotes.length === 3, 'plan has 3 remotes');
ok(plan.remotes.every(r => r.name && r.files.length && r.entry), 'every remote has name, files and entry');
ok(plan.sharedDeps.includes('react-router-dom'), 'sharedDeps includes react-router-dom');
ok(plan.sharedDeps.includes('react') && plan.sharedDeps.includes('react-dom'), 'sharedDeps includes react + react-dom');
ok(plan.risks.length > 0, 'plan carries risks');

// --html --------------------------------------------------------------------
const tmpHtml = path.join(path.dirname(tmpJson), 'report.html');
run(['split', FIXTURE, '--html', '--output', tmpHtml], EMPTY_HOME);
const html = fs.readFileSync(tmpHtml, 'utf8');
ok(html.includes('rvo split') && /RECOMMENDED|WORTH-CONSIDERING/.test(html), 'HTML report contains the verdict');
ok(html.includes('admin → shop') || html.includes('admin →'), 'HTML report shows the coupling pair');

// ------------------------------------------------- convert: license gate
// No key → blocked.
const blockedOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-split-')), 'blocked');
const code = runCode(['split', 'convert', FIXTURE, '--plan', tmpJson, '--out', blockedOut], EMPTY_HOME);
ok(code !== 0, 'convert without a license key is blocked (non-zero exit)');
ok(!fs.existsSync(blockedOut), 'blocked convert writes nothing');

// --out inside the project root is refused (even when licensed).
const insideCode = runCode(
  ['split', 'convert', FIXTURE, '--plan', tmpJson, '--out', path.join(FIXTURE, 'mf-out')],
  LIC_HOME
);
ok(insideCode !== 0, '--out inside the project root is refused');
ok(!fs.existsSync(path.join(FIXTURE, 'mf-out')), 'refused --out writes nothing into the fixture');

// ------------------------------------------------- convert: --dry-run
const dryOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-split-')), 'dry');
const dryStdout = run(
  ['split', 'convert', FIXTURE, '--plan', tmpJson, '--out', dryOut, '--dry-run'],
  LIC_HOME
);
ok(/dry run/i.test(dryStdout), 'dry-run announces itself');
ok(dryStdout.includes(path.join(dryOut, 'shop', 'vite.config.js')), 'dry-run lists the shop federation config');
ok(dryStdout.includes(path.join(dryOut, 'shell', 'src', 'federation.jsx')), 'dry-run lists the shell federation wrappers');
ok(!fs.existsSync(dryOut), 'dry-run writes no files');

// ------------------------------------------------- convert: real run
const realOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-split-')), 'mf');
const realStdout = run(
  ['split', 'convert', FIXTURE, '--plan', tmpJson, '--out', realOut],
  LIC_HOME
);
ok(/Microfrontend monorepo generated/.test(realStdout), 'convert prints the success summary');

for (const app of ['shop', 'account', 'admin', 'shell']) {
  ok(fs.existsSync(path.join(realOut, app)), `output has ${app}/ dir`);
}
const shopCfg = fs.readFileSync(path.join(realOut, 'shop', 'vite.config.js'), 'utf8');
ok(shopCfg.includes('@originjs/vite-plugin-federation'), 'remote vite config uses the federation plugin');
ok(shopCfg.includes("name: 'shop'"), 'remote vite config names the remote');
ok(shopCfg.includes("'./Routes': './src/remote-entry.jsx'"), 'remote vite config exposes ./Routes');
ok(shopCfg.includes('REVIEW'), 'generated config carries a REVIEW header');

const shellCfg = fs.readFileSync(path.join(realOut, 'shell', 'vite.config.js'), 'utf8');
ok(shellCfg.includes('shop:') && shellCfg.includes('remoteEntry.js'), 'shell vite config declares remote URLs');

const fedJsx = fs.readFileSync(path.join(realOut, 'shell', 'src', 'federation.jsx'), 'utf8');
ok(/React\.lazy\(\(\) => import\('shop\/Routes'\)/.test(fedJsx), 'shell federation.jsx lazy-loads the shop remote');

const appJsx = fs.readFileSync(path.join(realOut, 'shell', 'src', 'App.jsx'), 'utf8');
ok(/import\('shop\/Routes'\)/.test(appJsx), 'shell App.jsx router import rewritten to a federation lazy import');
ok(appJsx.includes('./shared/components/Button.jsx'), 'shell shared imports rewritten to ./shared/');

const shopHome = fs.readFileSync(path.join(realOut, 'shop', 'src', 'ShopHome.jsx'), 'utf8');
ok(shopHome.includes('./shared/context/ShopContext.jsx'), 'remote relative imports rewritten to the copied shared location');
ok(!shopHome.includes('../context/'), 'no stale ../context imports remain in the remote');

const adminPanel = fs.readFileSync(path.join(realOut, 'admin', 'src', 'AdminPanel.jsx'), 'utf8');
ok(adminPanel.includes('../shop/ProductCard.jsx'), 'cross-feature imports are left untouched (manual work, not silently fixed)');

const entryJsx = fs.readFileSync(path.join(realOut, 'shop', 'src', 'remote-entry.jsx'), 'utf8');
ok(entryJsx.includes('RemoteDefault'), 'remote-entry.jsx re-exports the entry for the shell');

const notes = fs.readFileSync(path.join(realOut, 'MIGRATION-NOTES.md'), 'utf8');
ok(notes.includes('@originjs/vite-plugin-federation'), 'MIGRATION-NOTES.md lists the manual plugin install');
ok(notes.includes('admin') && notes.includes('shop'), 'MIGRATION-NOTES.md lists cross-boundary imports to resolve');
ok(/did NOT do/i.test(notes), 'MIGRATION-NOTES.md is honest about what rvo did not do');

// Source tree untouched -------------------------------------------------------
ok(snapshot(FIXTURE) === beforeSnapshot, 'fixture source tree is untouched by convert');

console.log('\nAll rvo split tests passed.');
