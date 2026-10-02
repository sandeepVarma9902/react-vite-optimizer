// Self-test for `rvo assess` (free tier): runs the migration-readiness
// analyzer against test/fixtures/assess-demo and checks verdict, blockers,
// library equivalence, JSON and HTML outputs.
// Run with: npm test
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'assess-demo');

function run(args) {
  return execFileSync('node', [BIN, ...args], { encoding: 'utf8' });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

// Console report -------------------------------------------------------
const out = run(['assess', FIXTURE, '--to', 'vue']);
assert(/HIGH RISK/.test(out), 'verdict banner shows HIGH RISK');
assert(/slate/.test(out), 'blocker library (slate) is named');
assert(/Editor\.jsx/.test(out), 'blocker flags the file that imports it');
assert(/react-router-dom/.test(out), 'library table lists react-router-dom');
assert(
  /3 route\(s\)/.test(out),
  'router inventory counts the 3 <Route> elements'
);
assert(/CSS modules/.test(out), 'styling inventory detects CSS modules');
assert(/class/.test(out), 'inventory mentions the class component');
assert(
  /Suggested migration order/.test(out),
  'migration order section is printed'
);

// --json ----------------------------------------------------------------
const parsed = JSON.parse(run(['assess', FIXTURE, '--to', 'vue', '--json']));
assert(parsed.verdict === 'high-risk', 'JSON verdict is high-risk');
assert(
  parsed.blockers.some(
    b => b.library === 'slate' && b.files.some(f => /Editor\.jsx/.test(f))
  ),
  'JSON blocker flags slate with the importing file'
);
const rrd = parsed.libraries.find(l => l.name === 'react-router-dom');
assert(
  rrd && rrd.status === 'replace' && rrd.with === 'vue-router',
  'JSON marks react-router-dom as replace → vue-router'
);
const tq = parsed.libraries.find(l => l.name === '@tanstack/react-query');
assert(
  tq && tq.status === 'binding' && tq.with === '@tanstack/vue-query',
  'JSON marks @tanstack/react-query as binding → @tanstack/vue-query'
);
assert(
  parsed.inventory.components.class === 1,
  'JSON inventory counts 1 class component'
);
assert(
  parsed.inventory.tests.unit >= 1,
  'JSON inventory detects the unit test file'
);
assert(
  Array.isArray(parsed.migrationOrder) && parsed.migrationOrder.length >= 2,
  'JSON includes a migration order'
);
assert(
  parsed.topReasons.length > 0 && parsed.topReasons.length <= 3,
  'JSON includes 1–3 top reasons'
);

// --to angular ------------------------------------------------------------
const ng = JSON.parse(
  run(['assess', FIXTURE, '--to', 'angular', '--json'])
);
const ngRrd = ng.libraries.find(l => l.name === 'react-router-dom');
assert(
  ngRrd && ngRrd.status === 'replace' && ngRrd.with === '@angular/router',
  'angular target maps react-router-dom → @angular/router'
);

// --html ------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-assess-'));
const htmlOut = path.join(tmp, 'report.html');
run(['assess', FIXTURE, '--to', 'vue', '--html', '--output', htmlOut]);
const html = fs.readFileSync(htmlOut, 'utf8');
assert(/HIGH RISK/.test(html), 'HTML report contains the verdict');
assert(/slate/.test(html), 'HTML report contains the blocker');
assert(/vue-router/.test(html), 'HTML report contains the library mapping');
fs.rmSync(tmp, { recursive: true, force: true });

// validation ---------------------------------------------------------------
let threw = false;
try {
  run(['assess', FIXTURE]);
} catch {
  threw = true;
}
assert(threw, 'missing --to fails');
threw = false;
try {
  run(['assess', FIXTURE, '--from', 'vue', '--to', 'angular']);
} catch {
  threw = true;
}
assert(threw, '--from vue is rejected');

if (!process.exitCode) console.log('\nassess: all assertions passed');
