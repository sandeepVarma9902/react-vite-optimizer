// Tests for `rvo plan` and `rvo migrate` (cross-framework migration, premium tier).
// Fixture: test/fixtures/migrate-demo — a small React app (function components,
// class component, router, blocked slate dependency).
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'cli.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'migrate-demo');

function makeLicHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-plan-home-'));
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-plan-empty-'));
}
const LIC_HOME = makeLicHome();

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
      else out.push(path.relative(dir, p) + ':' + fs.statSync(p).size);
    }
  };
  walk(dir);
  return out.sort().join('\n');
}

// --- license gate -----------------------------------------------------------
assert.notEqual(runCode(['plan', '--to', 'vue', FIXTURE], makeEmptyHome()), 0);
assert.notEqual(
  runCode(['migrate', '--to', 'vue', '--out', '/tmp/nope', FIXTURE], makeEmptyHome()),
  0
);
try {
  run(['plan', '--to', 'vue', FIXTURE], makeEmptyHome());
  assert.fail('plan should have thrown without a license');
} catch (e) {
  assert.match(e.stderr || e.message, /license/i);
}
console.log('ok - license gate blocks plan and migrate without a key');

// --- plan: JSON blueprint ----------------------------------------------------
const planJson = run(['plan', '--to', 'vue', '--json', FIXTURE]);
const plan = JSON.parse(planJson);
assert.ok(Array.isArray(plan.decisions) && plan.decisions.length >= 4, 'decisions');
const areas = plan.decisions.map(d => d.area);
for (const want of ['State management', 'Routing', 'Styling', 'Testing'])
  assert.ok(areas.includes(want), 'decision area: ' + want);
assert.ok(Array.isArray(plan.modules) && plan.modules.length >= 2, 'modules');
for (const m of plan.modules) {
  assert.ok(['S', 'M', 'L'].includes(m.effort), 'module effort S/M/L: ' + m.name);
  assert.ok(Array.isArray(m.filePlans) && m.filePlans.length, 'filePlans: ' + m.name);
}
const editorPlan = plan.modules
  .flatMap(m => m.filePlans)
  .find(f => f.file.endsWith('Editor.jsx'));
assert.ok(editorPlan, 'Editor.jsx has a file plan');
assert.equal(editorPlan.effort, 'L', 'Editor.jsx is L (blocked slate)');
assert.ok(
  editorPlan.notes.some(n => /slate/i.test(n)),
  'Editor.jsx notes mention slate'
);
assert.ok(Array.isArray(plan.risks) && plan.risks.length, 'risk register');
assert.ok(plan.risks.some(r => /slate/i.test(r.item)), 'risk register carries slate');
assert.ok(Array.isArray(plan.scaffold) && plan.scaffold.length, 'scaffold checklist');
console.log('ok - plan --json has decisions, per-module/file effort, risk register');

// --- plan: console summary ---------------------------------------------------
const planOut = run(['plan', '--to', 'angular', FIXTURE]);
assert.match(planOut, /Architecture decisions/);
assert.match(planOut, /Module plan/);
assert.match(planOut, /Scaffold checklist/);
assert.match(planOut, /Risk register/);
assert.match(planOut, /slate/i);
console.log('ok - plan console summary renders decisions, modules, risks');

// --- migrate --dry-run: lists, writes nothing --------------------------------
const before = snapshot(FIXTURE);
const dryOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-dry-')), 'out');
const dry = run(['migrate', '--to', 'vue', '--dry-run', '--out', dryOut, FIXTURE]);
assert.match(dry, /Counter\.vue/);
assert.match(dry, /dry run/i);
assert.ok(!fs.existsSync(dryOut), 'dry run writes nothing');
assert.equal(snapshot(FIXTURE), before, 'fixture untouched by dry run');
console.log('ok - migrate --dry-run lists files without writing');

// --- migrate --to vue: real run ----------------------------------------------
const vueOut = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-vue-'));
run(['migrate', '--to', 'vue', '--out', vueOut, FIXTURE]);
const counterVue = fs.readFileSync(path.join(vueOut, 'components', 'Counter.vue'), 'utf8');
assert.match(counterVue, /ref\(/, 'Counter.vue uses ref(');
assert.match(counterVue, /<script setup>/);
assert.match(counterVue, /<template>/);
assert.match(counterVue, /confidence: (high|medium|low)/);
const editorVue = fs.readFileSync(path.join(vueOut, 'components', 'Editor.vue'), 'utf8');
assert.match(editorVue, /TODO\(human\).*slate/i, 'Editor.vue flags blocked slate');
assert.match(editorVue, /confidence: low/);
const legacyVue = fs.readFileSync(path.join(vueOut, 'components', 'LegacyCard.vue'), 'utf8');
assert.match(legacyVue, /TODO\(human\).*class component/i);
assert.equal(snapshot(FIXTURE), before, 'fixture untouched by vue run');
console.log('ok - migrate --to vue writes SFCs with ref() and TODO markers');

// --- migrate --to angular: real run ------------------------------------------
const ngOut = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-ng-'));
run(['migrate', '--to', 'angular', '--out', ngOut, FIXTURE]);
const counterTs = fs.readFileSync(
  path.join(ngOut, 'components', 'counter.component.ts'),
  'utf8'
);
assert.match(counterTs, /signal\(/, 'counter.component.ts uses signal(');
assert.match(counterTs, /@Component/);
assert.ok(
  fs.existsSync(path.join(ngOut, 'components', 'counter.component.html')),
  'counter.component.html written'
);
assert.match(counterTs, /confidence: (high|medium|low)/);
assert.equal(snapshot(FIXTURE), before, 'fixture untouched by angular run');
console.log('ok - migrate --to angular writes .component.ts with signal()');

// --- migrate --only limits scope ----------------------------------------------
const onlyOut = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-only-'));
const onlyLog = run([
  'migrate', '--to', 'vue', '--out', onlyOut,
  '--only', 'components/Counter.jsx', FIXTURE,
]);
assert.match(onlyLog, /1 converted/);
assert.ok(fs.existsSync(path.join(onlyOut, 'components', 'Counter.vue')));
assert.ok(!fs.existsSync(path.join(onlyOut, 'components', 'UserList.vue')));
console.log('ok - migrate --only limits to the given paths');

// --- migrate rejects unknown target -------------------------------------------
assert.notEqual(runCode(['migrate', '--to', 'svelte', '--out', onlyOut, FIXTURE]), 0);
console.log('ok - migrate rejects unknown --to target');

console.log('\nplan-migrate: all assertions passed');
