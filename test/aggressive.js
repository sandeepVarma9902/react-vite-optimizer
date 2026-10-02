// Aggressive test: tricky components, edge cases, malformed input, upgrade
// edge cases, and a 250-file performance sweep. Run with: node test/aggressive.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-aggr-'));

// Isolated HOME pre-seeded with a valid cached license (fresh cache hit —
// no network, no bypass).
const LIC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-aggr-lic-'));
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

function w(rel, content) {
  const p = path.join(DIR, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function run(args) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, HOME: LIC_HOME, RVO_LICENSE_KEY: '' },
  });
}

// ---------------------------------------------------------------- fixtures
w('package.json', JSON.stringify({
  name: 'aggr',
  private: true,
  dependencies: {
    react: '^18.2.0',
    'react-dom': '^18.2.0',
    weird: 'github:user/repo',
    star: '*',
    'latest-tag': 'latest',
    complex: '>=1.0.0 <2.0.0',
  },
  devDependencies: { vite: '^5.0.0' },
}, null, 2));
w('vite.config.js', "import { defineConfig } from 'vite';\nexport default defineConfig({});\n");

w('src/pages/Heavy.tsx', `import React from 'react';
import { BarChart } from 'recharts';
type Props = { items: string[] };
export default function Heavy({ items }: Props) {
  return <div><BarChart data={items} /></div>;
}
`);

w('src/pages/Settings.jsx', `import React from 'react';
export default function Settings() {
  return <div>Settings page</div>;
}
`);

w('src/App.jsx', `import React from 'react';
import Heavy from './pages/Heavy';
import Settings from './pages/Settings';
export default function App() {
  return <main><Heavy items={[]} /><Settings /></main>;
}
`);

w('src/ok/unused.jsx', `import React from 'react';
import Settings from '../pages/Settings';
export default function Unused() { return <div>never renders Settings</div>; }
`);

w('src/ok/collide.jsx', `import React from 'react';
import Settings from '../pages/Settings';
const Settings = () => <div>local shadow</div>;
export default function Collide() { return <div><Settings /></div>; }
`);

w('src/ok/suspense.jsx', `import React, { Suspense } from 'react';
import Heavy from '../pages/Heavy';
export default function S() {
  return <Suspense fallback="x"><Heavy items={[]} /></Suspense>;
}
`);

w('src/ok/memo-cases.jsx', `import React, { memo, useState, useContext, forwardRef } from 'react';
export const Already = memo(({ a }) => <div>{a}</div>);
export const Fwd = forwardRef((props, ref) => <div ref={ref} />);
export function WithHooks({ a }) {
  const [x] = useState(a);
  const v = useContext(SomeCtx);
  return <div>{x}{v}</div>;
}
export function NoProps() { return <div>hi</div>; }
function NotExported({ z }) { return <span>{z}</span>; }
export function Outer({ a }) {
  function Inner({ b }) { return <i>{b}</i>; }
  return <div><Inner b={a} /></div>;
}
export default function DefaultNoProps() { return <em />; }
`);

w('src/ok/usememo-tricky.jsx', `import React, { useState, useMemo, useEffect } from 'react';
const MOD_CONST = 2;
export function Tricky({ items, config, data }) {
  const [count, setCount] = useState(0);
  let threshold = 5;
  const doubled = count * MOD_CONST;
  const ok1 = items.filter(i => i.v > doubled);
  const ok2 = JSON.parse(config);
  const ok3 = data.map(d => d.x * MOD_CONST);
  const ok4 = items.filter(i => i.v > count).sort();
  const bad1 = items.filter(i => i.v > threshold);
  const bad2 = items.map(helper);
  const already = useMemo(() => items.map(i => i), [items]);
  function helper(x) { return x * 2; }
  useEffect(() => { const e = items.filter(Boolean); }, [items]);
  return <div>{ok1.length}{ok2}{ok3.length}{ok4.length}{bad1.length}{bad2.length}{already.length}</div>;
}
`);

w('src/ok/broken.jsx', `const = = = {{{ not valid javascript at all`);
w('src/ok/empty.jsx', ``);
w('src/util.js', `export const x = 1;\nexport function add(a, b) { return a + b; }\n`);

w('src/ok/ClassComp.jsx', `import React from 'react';
export class ClassComp extends React.Component {
  render() { return <div>{this.props.a}</div>; }
}
`);

w('src/ts-types.tsx', `import React from 'react';
export interface P { a: string }
export const Typed: React.FC<P> = ({ a }) => <div>{a}</div>;
`);

// already-memoized component containing an expensive computation:
// useMemo should still be found inside it (unwrap fix).
w('src/ok/memoized-usememo.jsx', `import React, { memo } from 'react';
export const M = memo(function M({ items }) {
  const f = items.filter(i => i.ok);
  return <ul>{f.map(x => <li key={x.id} />)}</ul>;
});
`);

// performance sweep: 250 generated files
for (let i = 0; i < 250; i++) {
  w(`src/gen/File${i}.jsx`, `import React from 'react';
export function Gen${i}({ items, label }) {
  const names = items.filter(x => x.on).map(x => x.name);
  return <div title={label}>{names.join(',')}</div>;
}
export default Gen${i};
`);
}

// ---------------------------------------------------------------- analyze
console.log('--- analyze ---');
let res;
try {
  const out = run(['analyze', DIR, '--json']);
  res = JSON.parse(out);
} catch (e) {
  assert(false, 'analyze crashed: ' + e.message);
}

if (res) {
  const lazyNames = res.lazy.map(c => `${path.basename(c.file)}:${c.component}`).sort();
  console.log('lazy candidates:', JSON.stringify(lazyNames));
  // Heavy: App.jsx + suspense.jsx ; Settings: App.jsx + unused.jsx
  // (collide.jsx has duplicate declarations -> skipped at scan time)
  assert(res.lazy.length === 4, `expect 4 lazy candidates, got ${res.lazy.length}`);
  assert(lazyNames.includes('App.jsx:Heavy'), 'Heavy lazy via App.jsx');
  assert(lazyNames.includes('suspense.jsx:Heavy'), 'Heavy lazy via suspense.jsx');
  assert(lazyNames.filter(x => x.endsWith(':Settings')).length === 2, 'Settings x2 importers');

  const memoNames = res.memo.map(c => c.name).sort();
  console.log('memo candidates:', JSON.stringify(memoNames));
  for (const n of ['Heavy', 'WithHooks', 'NotExported', 'Outer', 'Fwd', 'Typed', 'Tricky'])
    assert(memoNames.includes(n), `memo candidate: ${n}`);
  for (const n of ['Already', 'NoProps', 'Inner', 'DefaultNoProps', 'ClassComp', 'M'])
    assert(!memoNames.includes(n), `NOT a memo candidate: ${n}`);
  // Gen0..Gen249 each have props -> memo candidates (250) ; total = 7 + 250
  assert(res.memo.length === 257, `expect 257 memo candidates, got ${res.memo.length}`);

  const um = res.usememo.map(c => `${c.component}:${c.name}`).sort();
  console.log('usememo candidates:', JSON.stringify(um));
  for (const k of ['Tricky:ok1', 'Tricky:ok2', 'Tricky:ok3', 'Tricky:ok4', 'M:f'])
    assert(um.includes(k), `useMemo candidate: ${k}`);
  for (const k of ['Tricky:bad1', 'Tricky:bad2', 'Tricky:already', 'Tricky:e'])
    assert(!um.includes(k), `NOT a useMemo candidate: ${k}`);
  const ok1 = res.usememo.find(c => c.name === 'ok1');
  assert(ok1 && ok1.deps.includes('items') && ok1.deps.includes('doubled'),
    'ok1 deps = [items, doubled], got ' + JSON.stringify(ok1 && ok1.deps));
  const ok2 = res.usememo.find(c => c.name === 'ok2');
  assert(ok2 && ok2.deps.length === 1 && ok2.deps[0] === 'config',
    'ok2 deps = [config]');
  const ok3 = res.usememo.find(c => c.name === 'ok3');
  assert(ok3 && ok3.deps.length === 1 && ok3.deps[0] === 'data',
    'ok3 deps = [data] (module const needs no dep)');
}

// ---------------------------------------------------------------- fix
console.log('--- fix ---');
let fixOut = '';
try {
  fixOut = run(['fix', DIR, '-y']);
} catch (e) {
  assert(false, 'fix crashed: ' + e.message);
}
if (fixOut) {
  assert(/lazy-loading: 3 applied/.test(fixOut), 'lazy: 3 applied (App x2, suspense x1)');
  assert(/1 skipped/.test(fixOut),
    'lazy: 1 skipped (unused import)');
  assert(/React\.memo: 257 applied/.test(fixOut), 'memo: 257 applied');
  // usememo: 4 in Tricky + 1 in M + 250 in gen files (names.filter().map() each)
  const m = fixOut.match(/useMemo: (\d+) applied/);
  const n = m ? parseInt(m[1], 10) : -1;
  assert(n === 255, `useMemo: 255 applied, got ${n}`);
}

// suspense.jsx: import converted, but no double Suspense
const susp = fs.readFileSync(path.join(DIR, 'src/ok/suspense.jsx'), 'utf8');
assert(/lazy\(\(\) => import\("\.\.\/pages\/Heavy"\)\)/.test(susp), 'suspense.jsx: import converted to lazy');
assert((susp.match(/<Suspense/g) || []).length === 1, 'suspense.jsx: exactly one Suspense (no double wrap)');

// unused.jsx untouched (import kept as-is)
const unused = fs.readFileSync(path.join(DIR, 'src/ok/unused.jsx'), 'utf8');
assert(/import Settings from '\.\.\/pages\/Settings'/.test(unused), 'unused.jsx: static import preserved');

// collide.jsx: must not have been broken further / tool survived
assert(fs.existsSync(path.join(DIR, 'src/ok/collide.jsx')), 'collide.jsx still exists (no crash)');

// broken.jsx: tool survived
assert(fs.existsSync(path.join(DIR, 'src/ok/broken.jsx')), 'broken.jsx survived');

// memoized-usememo.jsx: useMemo applied inside memo()
const mm = fs.readFileSync(path.join(DIR, 'src/ok/memoized-usememo.jsx'), 'utf8');
assert(/useMemo\(\(\) => items\.filter/.test(mm), 'useMemo applied inside already-memoized component');

// ---------------------------------------------------------------- idempotency + parse check
console.log('--- idempotency & parse ---');
const fix2 = run(['fix', DIR, '-y']);
if (!/lazy-loading: 0 applied/.test(fix2)) {
  console.error('--- unexpected second-fix output ---\n' + fix2);
  console.error('DIR kept at: ' + DIR);
}
// Second run must apply nothing (remaining lazy candidate in unused.jsx is
// always detected but always skipped — never rendered).
assert(/lazy-loading: 0 applied/.test(fix2), 'second fix: lazy 0 applied');
assert(/React\.memo: 0 applied/.test(fix2), 'second fix: memo 0 applied');
assert(/useMemo: 0 applied/.test(fix2), 'second fix: useMemo 0 applied');

const { parse } = require(path.join(ROOT, 'src', 'utils'));
let parseFails = 0;
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.(jsx?|tsx?)$/.test(p) && !p.endsWith('broken.jsx')) {
      try { parse(fs.readFileSync(p, 'utf8'), p); }
      catch { parseFails++; console.error('parse fail:', p); }
    }
  }
};
walk(path.join(DIR, 'src'));
assert(parseFails === 0, 'all transformed files still parse');

// ---------------------------------------------------------------- upgrade edge cases
console.log('--- upgrade edge cases ---');
let upg = '';
try {
  upg = run(['upgrade', DIR, '--dry-run']);
} catch (e) {
  assert(false, 'upgrade crashed: ' + e.message);
}
if (upg) {
  assert(/skipped \(non-semver range\)/.test(upg) || /weird/.test(upg),
    'non-semver ranges (github:, latest) do not crash upgrade');
  console.log(upg.split('\n').filter(l => /weird|latest-tag|complex|star/.test(l)).join('\n'));
}

// ---------------------------------------------------------------- --only flag
console.log('--- --only flag ---');
const onlyOut = run(['analyze', DIR, '--only', 'memo', '--json']);
const onlyRes = JSON.parse(onlyOut);
assert(onlyRes.lazy.length === 0 && onlyRes.usememo.length === 0 && onlyRes.memo.length === 0,
  '--only memo on fully-fixed tree finds nothing new (sanity)');

// ---------------------------------------------------------------- performance
console.log('--- performance ---');
const t0 = Date.now();
run(['analyze', DIR]);
const dt = Date.now() - t0;
console.log(`analyze over ${res ? res.scannedFiles : '?'} files took ${dt}ms`);
assert(dt < 30000, 'analyze completes in <30s on 260+ files');

console.log(failures ? `\n${failures} FAILURES` : '\nAll aggressive tests passed.');
fs.rmSync(LIC_HOME, { recursive: true, force: true });
process.exitCode = failures ? 1 : 0;
