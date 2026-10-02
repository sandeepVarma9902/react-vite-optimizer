// Self-test for rvo migrate: exercises cra-to-vite + react-19 against temp
// CRA/React-17 fixtures, plus license gating. Run with: npm test
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const VITE_FIXTURE = path.join(ROOT, 'test-fixture');

// Isolated HOME pre-seeded with a valid cached license, so the commercial
// migrate command runs against a fresh cache hit without touching the
// network. (There is no bypass env var — the gate is always live.)
const LIC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-test-mig-lic-'));
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

const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-test-mig-home-'));

function baseEnv(home) {
  return { ...process.env, HOME: home, RVO_LICENSE_KEY: '' };
}

function run(args) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: baseEnv(LIC_HOME),
  });
}

function runCode(args, home) {
  try {
    return {
      code: 0,
      out: execFileSync('node', [BIN, ...args], {
        encoding: 'utf8',
        env: baseEnv(home || LIC_HOME),
      }),
    };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

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

function sameSnapshot(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

// ---------------------------------------------------------------- fixtures
function makeCraFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-cra-'));
  write(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'cra-fixture',
        private: true,
        dependencies: {
          react: '^17.0.2',
          'react-dom': '^17.0.2',
          'react-scripts': '5.0.1',
          'web-vitals': '^2.1.4',
        },
        scripts: {
          start: 'react-scripts start',
          build: 'react-scripts build',
          test: 'react-scripts test',
          eject: 'react-scripts eject',
        },
        proxy: 'http://localhost:4000',
      },
      null,
      2
    ) + '\n'
  );
  write(
    path.join(dir, 'public', 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <link rel="manifest" href="%PUBLIC_URL%/manifest.json" />
    <title>CRA App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
  );
  write(
    path.join(dir, 'src', 'index.js'),
    `import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';

const apiUrl = process.env.REACT_APP_API_URL;

ReactDOM.render(
  <React.StrictMode>
    <App apiUrl={apiUrl} />
  </React.StrictMode>,
  document.getElementById('root')
);
`
  );
  write(
    path.join(dir, 'src', 'App.jsx'),
    `import React from 'react';
import { ReactComponent as Logo } from './logo.svg';

class App extends React.Component {
  handleClick = () => {
    this.refs.myInput.focus();
  };
  render() {
    return (
      <div>
        <Logo />
        <input ref="myInput" />
        <button onClick={this.handleClick}>focus</button>
      </div>
    );
  }
}

export default App;
`
  );
  write(path.join(dir, 'src', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
  write(path.join(dir, 'src', 'index.css'), 'body { margin: 0; }\n');
  write(
    path.join(dir, '.env'),
    'REACT_APP_API_URL=https://api.example.com\nREACT_APP_DEBUG=true\n'
  );
  write(
    path.join(dir, '.env.development'),
    'REACT_APP_API_URL=http://localhost:4000\n'
  );
  write(
    path.join(dir, 'jsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: 'src' } }, null, 2) + '\n'
  );
  write(path.join(dir, 'src', 'setupTests.js'), '// jest setup\n');
  write(path.join(dir, 'src', 'reportWebVitals.js'), '// web vitals\n');
  return dir;
}

function makeReact17Fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-r17-'));
  write(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'r17-fixture',
        private: true,
        dependencies: {
          react: '^17.0.2',
          'react-dom': '^17.0.2',
          'react-redux': '^8.1.0',
          'prop-types': '^15.8.1',
        },
        devDependencies: { vite: '^5.0.0', '@vitejs/plugin-react': '^4.0.0' },
        scripts: { build: 'vite build' },
      },
      null,
      2
    ) + '\n'
  );
  write(
    path.join(dir, 'src', 'index.js'),
    `import React from 'react';
import ReactDOM from 'react-dom';
import { Legacy } from './App';

ReactDOM.render(<Legacy />, document.getElementById('root'));
`
  );
  write(
    path.join(dir, 'src', 'App.jsx'),
    `import React from 'react';
import PropTypes from 'prop-types';

class Legacy extends React.Component {
  componentDidMount() {
    this.refs.box.focus();
  }
  render() {
    return <div ref="box" />;
  }
}
Legacy.contextTypes = { theme: PropTypes.object };
Legacy.propTypes = { name: PropTypes.string };

const FancyButton = React.forwardRef((props, ref) => (
  <button ref={ref}>{props.children}</button>
));

export { Legacy, FancyButton };
`
  );
  return dir;
}

const { parse } = require(path.join(ROOT, 'src', 'utils'));
function assertParses(dir, label) {
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (/\.(jsx?|tsx?)$/.test(p)) {
        try {
          parse(fs.readFileSync(p, 'utf8'), p);
        } catch (err) {
          assert(false, `${label}: ${p} still parses (${err.message})`);
          return;
        }
      }
    }
  };
  walk(dir);
  console.log(`ok: ${label}: all files parse`);
}

// ------------------------------------------------------------------- tests
try {
  const craDir = makeCraFixture();
  const r17Dir = makeReact17Fixture();

  // ---- suggest mode
  const sug = run(['migrate', craDir]);
  assert(/cra-to-vite/.test(sug), 'migrate <cra-dir> suggests cra-to-vite');

  // ---- unknown migration
  const unk = runCode(['migrate', 'nope', craDir]);
  assert(unk.code !== 0, 'unknown migration exits non-zero');
  assert(/Unknown migration/.test(unk.out), 'unknown migration names itself');

  // ---- not applicable
  const na = runCode(['migrate', 'cra-to-vite', VITE_FIXTURE]);
  assert(na.code !== 0, 'cra-to-vite on a Vite project exits non-zero');
  assert(/doesn't look like/.test(na.out), 'not-applicable message is clear');

  // ---- cra-to-vite --dry-run touches nothing
  const before = snapshot(craDir);
  const dry = run(['migrate', 'cra-to-vite', craDir, '--dry-run']);
  assert(/Migration plan/.test(dry), 'dry-run prints the migration plan');
  assert(/vite\.config\.js/.test(dry), 'dry-run plan mentions vite.config.js');
  assert(/REACT_APP/.test(dry), 'dry-run plan mentions the env codemod');
  assert(/Manual follow-ups/.test(dry), 'dry-run lists manual follow-ups');
  assert(/Dry run — no files were modified/.test(dry), 'dry-run says nothing was modified');
  assert(sameSnapshot(before, snapshot(craDir)), 'dry-run leaves every file untouched');
  assert(
    !fs.existsSync(path.join(craDir, 'MIGRATION-NOTES.md')),
    'dry-run writes no MIGRATION-NOTES.md'
  );

  // ---- cra-to-vite apply
  const applied = run(['migrate', 'cra-to-vite', craDir, '-y', '--no-install']);
  assert(/Migration complete/.test(applied), 'cra-to-vite reports completion');

  const viteCfg = path.join(craDir, 'vite.config.js');
  assert(fs.existsSync(viteCfg), 'vite.config.js generated');
  const cfg = fs.readFileSync(viteCfg, 'utf8');
  assert(/@vitejs\/plugin-react/.test(cfg), 'config uses @vitejs/plugin-react');
  assert(/vite-plugin-svgr/.test(cfg), 'config adds svgr plugin (ReactComponent import detected)');
  assert(/http:\/\/localhost:4000/.test(cfg), 'config carries the CRA proxy target');
  assert(/path\.resolve\(__dirname, '\.\/src'\)/.test(cfg), 'config has @ alias for jsconfig baseUrl');

  const rootHtml = path.join(craDir, 'index.html');
  assert(fs.existsSync(rootHtml), 'index.html moved to project root');
  const html = fs.readFileSync(rootHtml, 'utf8');
  assert(!/%PUBLIC_URL%/.test(html), '%PUBLIC_URL% rewritten out of index.html');
  assert(/<script type="module" src="\/src\/index\.js"><\/script>/.test(html), 'entry module script injected');
  assert(/href="\/favicon\.ico"/.test(html), 'favicon rewritten to /favicon.ico');
  assert(!fs.existsSync(path.join(craDir, 'public', 'index.html')), 'public/index.html removed');

  const env = fs.readFileSync(path.join(craDir, '.env'), 'utf8');
  assert(/VITE_API_URL=https:\/\/api\.example\.com/.test(env), '.env key renamed to VITE_API_URL');
  assert(!/REACT_APP_/.test(env), 'no REACT_APP_ left in .env');
  const envDev = fs.readFileSync(path.join(craDir, '.env.development'), 'utf8');
  assert(/VITE_API_URL=http:\/\/localhost:4000/.test(envDev), '.env.development renamed too');

  const indexJs = fs.readFileSync(path.join(craDir, 'src', 'index.js'), 'utf8');
  assert(/import\.meta\.env\.VITE_API_URL/.test(indexJs), 'process.env.REACT_APP_* → import.meta.env.VITE_*');
  assert(!/REACT_APP_/.test(indexJs), 'no REACT_APP_ left in source');

  const pkg = JSON.parse(fs.readFileSync(path.join(craDir, 'package.json'), 'utf8'));
  assert(pkg.scripts.start === 'vite', 'script start → vite');
  assert(pkg.scripts.build === 'vite build', 'script build → vite build');
  assert(pkg.scripts.test === 'vitest run', 'script test → vitest run');
  assert(!('eject' in pkg.scripts), 'eject script removed');
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  assert(!deps['react-scripts'], 'react-scripts removed from dependencies');
  assert(/^\^?\d/.test(pkg.devDependencies['vite'] || ''), 'vite added to devDependencies');
  assert(pkg.devDependencies['@vitejs/plugin-react'], '@vitejs/plugin-react added');
  assert(pkg.devDependencies['vite-plugin-svgr'], 'vite-plugin-svgr added');

  const jsconfig = JSON.parse(fs.readFileSync(path.join(craDir, 'jsconfig.json'), 'utf8'));
  assert(
    jsconfig.compilerOptions.paths['@/*'][0] === 'src/*',
    'jsconfig gets @/* paths for the editor'
  );

  const notes = fs.readFileSync(path.join(craDir, 'MIGRATION-NOTES.md'), 'utf8');
  assert(/Jest/i.test(notes), 'MIGRATION-NOTES.md mentions the Jest follow-up');
  assert(/web-vitals|vitest/.test(notes), 'MIGRATION-NOTES.md lists other follow-ups');

  assertParses(craDir, 'cra-to-vite output');

  // idempotent-ish: a migrated project is no longer detected as CRA
  const again = runCode(['migrate', 'cra-to-vite', craDir, '-y', '--no-install']);
  assert(again.code !== 0, 'second cra-to-vite run exits non-zero (no longer a CRA app)');

  // ---- react-19 suggest + dry-run
  const sug19 = run(['migrate', r17Dir]);
  assert(/react-19/.test(sug19), 'migrate <react17-dir> suggests react-19');
  const before19 = snapshot(r17Dir);
  const dry19 = run(['migrate', 'react-19', r17Dir, '--dry-run']);
  assert(/Migration plan/.test(dry19), 'react-19 dry-run prints the plan');
  assert(/createRoot/.test(dry19), 'react-19 dry-run mentions the createRoot codemod');
  assert(/react-redux/.test(dry19), 'react-19 dry-run flags the react-redux peer risk');
  assert(sameSnapshot(before19, snapshot(r17Dir)), 'react-19 dry-run touches nothing');

  // ---- react-19 apply
  const applied19 = run(['migrate', 'react-19', r17Dir, '-y', '--no-install']);
  assert(/Migration complete/.test(applied19), 'react-19 reports completion');
  assert(/contextTypes/.test(applied19), 'react-19 reports the contextTypes follow-up');

  const pkg19 = JSON.parse(fs.readFileSync(path.join(r17Dir, 'package.json'), 'utf8'));
  const r19deps = { ...(pkg19.dependencies || {}), ...(pkg19.devDependencies || {}) };
  assert(/^\^19/.test(r19deps['react']), 'react upgraded to ^19');
  assert(/^\^19/.test(r19deps['react-dom']), 'react-dom upgraded to ^19');

  const idx19 = fs.readFileSync(path.join(r17Dir, 'src', 'index.js'), 'utf8');
  assert(/createRoot\(document\.getElementById\('root'\)\)\.render/.test(idx19), 'ReactDOM.render → createRoot().render()');
  assert(/from ["']react-dom\/client["']/.test(idx19), "import comes from 'react-dom/client'");
  assert(!/ReactDOM\.render/.test(idx19), 'no ReactDOM.render left');

  const app19 = fs.readFileSync(path.join(r17Dir, 'src', 'App.jsx'), 'utf8');
  assert(/ref=\{this\.box\}/.test(app19), 'string ref → ref={this.box}');
  assert(/this\.box = React\.createRef\(\)/.test(app19), 'createRef assigned in constructor');
  assert(/this\.box\.current\.focus\(\)/.test(app19), 'this.refs.box → this.box.current');
  assert(!/ref="box"/.test(app19), 'no string ref left');

  assert(
    fs.existsSync(path.join(r17Dir, 'MIGRATION-NOTES.md')),
    'react-19 writes MIGRATION-NOTES.md'
  );
  assertParses(r17Dir, 'react-19 output');

  // ---- license gating
  const gated = runCode(['migrate', 'react-19', r17Dir, '--dry-run'], emptyHome);
  assert(gated.code !== 0, 'migrate without a license exits non-zero');
  assert(/license key is required/i.test(gated.out), 'migrate without a license explains the key');

  fs.rmSync(craDir, { recursive: true, force: true });
  fs.rmSync(r17Dir, { recursive: true, force: true });
} finally {
  fs.rmSync(LIC_HOME, { recursive: true, force: true });
  fs.rmSync(emptyHome, { recursive: true, force: true });
}

if (!process.exitCode) console.log('\nAll migrate tests passed.');
