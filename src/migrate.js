// rvo migrate — codebase modernization.
//
// Every migration follows the same pipeline: detect → plan → transform →
// verify. `rvo migrate <id> --dry-run` prints the plan without touching
// files; `-y/--yes` skips confirmations.
//
// Commercial command: `rvo migrate` requires a license key (gated in
// bin/cli.js via requireLicense, same as fix/upgrade/all). analyze/doctor
// stay free.
//
// No new runtime dependencies: everything here builds on fs/path,
// @babel/* (already used by the codemod engine), semver, chalk and ora.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const chalk = require('chalk');
const ora = require('ora');
const semver = require('semver');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const generate = require('@babel/generator').default;
const { parse, readJson, confirm, JS_EXTS } = require('./utils');

// ------------------------------------------------------------------ helpers
function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function writePkg(root, pkg) {
  writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

// All JS/TS source files under <root>/<subdir> (default src/).
function listJsFiles(root, subdir = 'src') {
  const out = [];
  const base = path.join(root, subdir);
  if (!exists(base)) return out;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (JS_EXTS.includes(path.extname(e.name))) {
        out.push(p);
      }
    }
  };
  walk(base);
  return out;
}

function loadPkg(root) {
  try {
    return readJson(path.join(root, 'package.json'));
  } catch {
    return null;
  }
}

function allDeps(pkg) {
  return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
}

function majorOf(range) {
  try {
    const v = semver.minVersion(String(range));
    return v ? v.major : null;
  } catch {
    return null;
  }
}

// Latest stable version from the npm registry, with an offline fallback.
// Never throws — migrations must stay usable without network.
function latestStable(name, fallback) {
  return new Promise(resolve => {
    let settled = false;
    const done = v => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const req = https.get(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
      { headers: { 'User-Agent': 'react-vite-optimizer/2.0' } },
      res => {
        let data = '';
        res.on('data', c => {
          data += c;
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            done(typeof j.version === 'string' ? j.version : fallback);
          } catch {
            done(fallback);
          }
        });
      }
    );
    req.on('error', () => done(fallback));
    req.setTimeout(8000, () => {
      req.destroy();
      done(fallback);
    });
  });
}

function rel(root, f) {
  return path.relative(root, f) || f;
}

// ------------------------------------------------------------------- output
function printDetection(m, det) {
  console.log(chalk.bold.cyan(`\nrvo migrate — ${m.id}`));
  console.log(chalk.dim(`  ${m.description}`));
  console.log(chalk.bold('\nDetection'));
  for (const r of det.reasons) console.log(r);
}

function printPlan(plan, dryRun) {
  console.log(
    chalk.bold(
      `\nMigration plan${dryRun ? ' (dry run)' : ''} (${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'})`
    )
  );
  plan.steps.forEach((s, i) => {
    const n = String(i + 1).padEnd(2);
    console.log(`  ${chalk.cyan(n)} ${chalk.bold(s.label)}${s.skip ? chalk.dim(' — skipped') : ''}`);
    if (s.detail) console.log(chalk.dim(`      ${s.detail}`));
  });
  if (plan.followUps && plan.followUps.length) {
    console.log(chalk.bold.yellow('\nManual follow-ups (not automated):'));
    for (const f of plan.followUps) console.log(chalk.yellow('  • ' + f));
  }
}

function printTransformSummary(res) {
  console.log(chalk.bold.cyan('\nMigration applied'));
  const files = [...new Set(res.changed || [])];
  if (files.length) {
    console.log(chalk.bold('Changed files:'));
    files.forEach(f => console.log('  • ' + f));
  }
  for (const s of res.skipped || [])
    console.log(chalk.yellow(`  ! skipped: ${s.step} — ${s.reason}`));
  for (const n of res.notes || []) console.log(chalk.dim('  ' + n));
}

function printVerify(rep) {
  console.log(chalk.bold.cyan('\nVerification'));
  for (const c of rep.checks) {
    const mark =
      c.status === 'pass'
        ? chalk.green('✓')
        : c.status === 'fail'
          ? chalk.red('✗')
          : chalk.dim('-');
    console.log(`  ${mark} ${c.label}${c.detail ? chalk.dim(' — ' + c.detail) : ''}`);
    if (c.status === 'fail' && c.output)
      console.log(chalk.dim('    ' + c.output.split('\n').join('\n    ')));
  }
}

function writeMigrationNotes(root, title, done, followUps) {
  const lines = [
    `# Migration notes — ${title}`,
    '',
    `Generated by \`rvo migrate\` on ${new Date().toISOString()}.`,
    'Review each item, then delete this file.',
    '',
    '## Done automatically',
    ...done.map(d => `- ${d}`),
    '',
    '## Manual follow-ups',
    ...(followUps.length ? followUps.map(f => `- ${f}`) : ['- none']),
    '',
  ];
  writeFile(path.join(root, 'MIGRATION-NOTES.md'), lines.join('\n'));
}

// ---------------------------------------------------------------- framework
const MIGRATIONS = {};
function registerMigration(m) {
  MIGRATIONS[m.id] = m;
}
function listMigrations() {
  return Object.values(MIGRATIONS);
}

async function runMigration(id, root, opts = {}) {
  const m = MIGRATIONS[id];
  if (!m) {
    console.log(chalk.red(`\nUnknown migration "${id}".`));
    printAvailable();
    process.exitCode = 1;
    return;
  }
  const det = m.detect(root);
  printDetection(m, det);
  if (!det.detected) {
    console.log(
      chalk.yellow("\nNot applicable: this project doesn't look like a migration candidate.")
    );
    if (det.hint) console.log(chalk.dim('  ' + det.hint));
    process.exitCode = 1;
    return;
  }
  const plan = await m.plan(root, det, opts);
  printPlan(plan, !!opts.dryRun);
  if (opts.dryRun) {
    console.log(chalk.yellow('\nDry run — no files were modified.'));
    return;
  }
  const ok =
    opts.yes || (await confirm(`Apply ${plan.steps.length} migration step(s)?`));
  if (!ok) {
    console.log(chalk.dim('Aborted — nothing changed.'));
    return;
  }
  const spinner = ora('Applying migration…').start();
  let res;
  try {
    res = m.transform(root, plan, det, opts);
  } catch (e) {
    spinner.fail('Migration failed: ' + (e && e.message ? e.message : e));
    throw e;
  }
  spinner.stop();
  printTransformSummary(res);
  const rep = await m.verify(root, res, opts);
  printVerify(rep);
  if (rep.checks.some(c => c.status === 'fail')) {
    console.log(chalk.red('\n✗ Migration applied, but verification found problems (see above).'));
    process.exitCode = 1;
  } else {
    console.log(chalk.green('\n✓ Migration complete.'));
  }
}

function printAvailable() {
  console.log(chalk.bold('\nAvailable migrations:'));
  for (const m of listMigrations())
    console.log(`  ${chalk.cyan(m.id.padEnd(14))} ${m.description}`);
}

async function suggestMigrations(root) {
  console.log(chalk.bold.cyan('\nrvo migrate'));
  console.log(chalk.dim('  ' + root));
  let any = false;
  for (const m of listMigrations()) {
    let det;
    try {
      det = m.detect(root);
    } catch {
      continue;
    }
    if (det.detected) {
      any = true;
      console.log(`  ${chalk.green('✓')} ${chalk.cyan(m.id)} — ${m.description}`);
    }
  }
  if (!any) console.log(chalk.dim('  No migrations apply to this project.'));
  else
    console.log(chalk.dim('\nRun `rvo migrate <id> --dry-run` to preview a migration.'));
}

// ============================================================ cra-to-vite
const CRA_ENTRY_CANDIDATES = ['src/index.js', 'src/index.jsx', 'src/index.ts', 'src/index.tsx'];

function findCraEntry(root) {
  for (const c of CRA_ENTRY_CANDIDATES) {
    const p = path.join(root, c);
    if (exists(p)) return p;
  }
  return null;
}

function detectCra(root) {
  const reasons = [];
  const pkg = loadPkg(root);
  if (!pkg) {
    return {
      detected: false,
      reasons: [chalk.red('  ✗ no package.json found')],
      hint: 'Point rvo at a project directory.',
    };
  }
  const deps = allDeps(pkg);
  const rsVersion = deps['react-scripts'];
  reasons.push(
    rsVersion
      ? chalk.green(`  ✓ react-scripts ${rsVersion} in dependencies`)
      : chalk.dim('  · no react-scripts dependency')
  );
  const publicHtml = path.join(root, 'public', 'index.html');
  const hasPublicHtml = exists(publicHtml);
  reasons.push(
    hasPublicHtml
      ? chalk.green('  ✓ public/index.html present')
      : chalk.dim('  · no public/index.html')
  );
  const entry = findCraEntry(root);
  reasons.push(
    entry
      ? chalk.green(`  ✓ entry ${rel(root, entry)}`)
      : chalk.dim('  · no src/index.{js,jsx,ts,tsx}')
  );
  const detected = Boolean(rsVersion) && (hasPublicHtml || Boolean(entry));

  // Gather everything the planner needs in one pass over the sources.
  const info = { pkg, deps, rsVersion, publicHtml, entry };
  if (detected) {
    const jsFiles = listJsFiles(root);
    info.jsFiles = jsFiles;
    // jsconfig baseUrl → vite alias
    const jsconfigPath = path.join(root, 'jsconfig.json');
    info.jsconfigBaseUrl = null;
    if (exists(jsconfigPath)) {
      try {
        const jc = JSON.parse(readFile(jsconfigPath));
        const bu = jc && jc.compilerOptions && jc.compilerOptions.baseUrl;
        if (typeof bu === 'string') info.jsconfigBaseUrl = bu;
      } catch {
        /* leave null */
      }
    }
    // CRA dev-server proxy
    info.proxy = typeof pkg.proxy === 'string' ? pkg.proxy : null;
    info.proxyObject = pkg.proxy && typeof pkg.proxy === 'object';
    info.setupProxy = exists(path.join(root, 'src', 'setupProxy.js'));
    info.setupTests = exists(path.join(root, 'src', 'setupTests.js'));
    info.webVitals =
      exists(path.join(root, 'src', 'reportWebVitals.js')) || Boolean(deps['web-vitals']);
    info.serviceWorker =
      exists(path.join(root, 'src', 'serviceWorker.js')) ||
      exists(path.join(root, 'src', 'service-worker.js'));
    // .env* files at the project root
    info.envFiles = fs
      .readdirSync(root)
      .filter(f => /^\.env(\..*)?$/.test(f) && fs.statSync(path.join(root, f)).isFile())
      .map(f => path.join(root, f));
    // REACT_APP_* usages in code
    info.envUsages = [];
    info.polyfillHints = [];
    info.svgReactComponent = [];
    for (const f of jsFiles) {
      let code;
      try {
        code = readFile(f);
      } catch {
        continue;
      }
      if (/process\.env\.REACT_APP_[A-Za-z0-9_]+/.test(code)) info.envUsages.push(f);
      // Node globals CRA polyfilled for the browser (process, Buffer) —
      // anything beyond the REACT_APP_ vars we rewrite ourselves.
      if (
        /process\.nextTick|require\(['"]buffer['"]\)|new\s+Buffer\(|Buffer\.from|global\s*\.\s*process/.test(
          code
        ) ||
        /process\.env\.(?!REACT_APP_)[A-Za-z0-9_]+/.test(code)
      )
        info.polyfillHints.push(f);
      if (/import\s*\{\s*ReactComponent/.test(code)) info.svgReactComponent.push(f);
    }
    // scripts that reference react-scripts
    info.scripts = {};
    for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
      if (/react-scripts/.test(String(cmd))) info.scripts[name] = String(cmd);
    }
    info.viteConfigExists = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'].some(f =>
      exists(path.join(root, f))
    );
  }
  return {
    detected,
    reasons,
    info,
    hint: 'Needs react-scripts in dependencies plus public/index.html or src/index.*.',
  };
}

function craConfigDetail(info) {
  const parts = [];
  if (info.proxy) parts.push(`dev proxy from package.json ("${info.proxy}")`);
  if (info.jsconfigBaseUrl)
    parts.push(`"@" alias for jsconfig baseUrl "${info.jsconfigBaseUrl}"`);
  if (info.svgReactComponent.length)
    parts.push(`svgr plugin (${info.svgReactComponent.length} file(s) import { ReactComponent })`);
  parts.push('@vitejs/plugin-react');
  return parts.join(', ');
}

async function planCra(root, det, opts) {
  const info = det.info;
  const steps = [];
  const followUps = [];
  const spinner = ora('Resolving latest versions from the npm registry…').start();
  const [viteV, pluginReactV, svgrV] = await Promise.all([
    latestStable('vite', '6.0.0'),
    latestStable('@vitejs/plugin-react', '4.0.0'),
    latestStable('vite-plugin-svgr', '4.0.0'),
  ]);
  spinner.stop();
  info.versions = {
    vite: '^' + viteV,
    pluginReact: '^' + pluginReactV,
    svgr: '^' + svgrV,
  };

  if (info.viteConfigExists) {
    steps.push({
      id: 'config',
      label: 'Keep existing vite.config.*',
      detail: 'already present — left untouched',
      skip: true,
    });
  } else {
    steps.push({
      id: 'config',
      label: 'Generate vite.config.js',
      detail: craConfigDetail(info),
    });
  }
  steps.push({
    id: 'html',
    label: 'Move public/index.html → index.html',
    detail: '%PUBLIC_URL% rewritten to /, entry <script type="module"> injected',
  });
  const envCount = info.envUsages.length + info.envFiles.length;
  steps.push({
    id: 'env',
    label: 'REACT_APP_* → VITE_* codemod',
    detail:
      envCount === 0
        ? 'no REACT_APP_* usages found'
        : `${info.envUsages.length} source file(s), ${info.envFiles.length} .env file(s)`,
    skip: envCount === 0,
  });
  const scriptNames = Object.keys(info.scripts);
  steps.push({
    id: 'scripts',
    label: 'Rewrite package.json scripts',
    detail:
      scriptNames.length === 0
        ? 'no react-scripts scripts found'
        : scriptNames.map(n => `${n}: ${info.scripts[n]}`).join('; '),
    skip: scriptNames.length === 0,
  });
  if (info.jsconfigBaseUrl) {
    steps.push({
      id: 'jsconfig',
      label: 'jsconfig baseUrl → editor paths',
      detail: `"@/*" paths added for baseUrl "${info.jsconfigBaseUrl}" (+ "@" alias in vite.config.js)`,
    });
    followUps.push(
      'Absolute imports: rvo added an "@" alias for src/ and matching jsconfig paths. ' +
        'Rewrite bare absolute imports (e.g. `from \'components/X\'`) to `@/components/X`, ' +
        'or extend vite.config.js resolve.alias.'
    );
  }
  steps.push({
    id: 'deps',
    label: 'Replace react-scripts with Vite',
    detail: `remove react-scripts ${info.rsVersion}; add vite ${info.versions.vite}, @vitejs/plugin-react ${info.versions.pluginReact}` +
      (info.svgReactComponent.length ? `, vite-plugin-svgr ${info.versions.svgr}` : ''),
  });
  if (opts.install === false) {
    steps.push({
      id: 'install',
      label: 'npm install',
      detail: 'skipped (--no-install)',
      skip: true,
    });
  } else {
    steps.push({ id: 'install', label: 'Run npm install', detail: 'installs the new devDependencies' });
  }

  if (info.proxyObject)
    followUps.push(
      'package.json "proxy" is an object (advanced config) — translate its rules into vite.config.js server.proxy manually.'
    );
  if (info.setupProxy)
    followUps.push(
      'src/setupProxy.js uses http-proxy-middleware — port its rules into vite.config.js server.proxy (same option shape).'
    );
  if (info.setupTests)
    followUps.push(
      'src/setupTests.js is a Jest setup file — kept as-is. Migrate it to a Vitest setup file when you move tests (rvo v2.1 will automate jest-to-vitest).'
    );
  if (info.webVitals)
    followUps.push(
      'web-vitals works unchanged with Vite — keep src/reportWebVitals.js, or delete it if unused.'
    );
  if (info.serviceWorker)
    followUps.push(
      "CRA's service worker relied on react-scripts' Workbox injection — switch to vite-plugin-pwa if you need offline support."
    );
  if (info.polyfillHints.length)
    followUps.push(
      `Node globals (process/Buffer) used in ${info.polyfillHints.length} file(s): ` +
        info.polyfillHints.map(f => rel(root, f)).join(', ') +
        ' — CRA polyfilled these; add vite-plugin-node-polyfills or refactor to browser APIs.'
    );
  if (info.scripts.test)
    followUps.push(
      'npm test now runs `vitest run` — install vitest and port jest config/setupTests before running it.'
    );
  return { steps, followUps };
}

// ------------------------------------------------------- cra-to-vite: steps
function stepCraConfig(root, info) {
  const useSvgr = info.svgReactComponent.length > 0;
  const useAlias = Boolean(info.jsconfigBaseUrl);
  let src = "import { defineConfig } from 'vite';\n";
  src += "import react from '@vitejs/plugin-react';\n";
  if (useSvgr) src += "import svgr from 'vite-plugin-svgr';\n";
  if (useAlias) src += "import path from 'path';\n";
  src += '\n// Migrated from Create React App by `rvo migrate cra-to-vite`.\n';
  src += 'export default defineConfig({\n';
  src += `  plugins: [react()${useSvgr ? ', svgr()' : ''}],\n`;
  if (useAlias) {
    src += '  resolve: {\n';
    src += '    alias: {\n';
    src += `      // Migrated from jsconfig.json baseUrl "${info.jsconfigBaseUrl}".\n`;
    src += "      // `@` maps to src/ — see MIGRATION-NOTES.md about bare absolute imports.\n";
    src += "      '@': path.resolve(__dirname, './src'),\n";
    src += '    },\n';
    src += '  },\n';
  }
  if (info.proxy) {
    src += '  server: {\n';
    src += '    proxy: {\n';
    src += '      // Migrated from CRA "proxy" in package.json.\n';
    src += '      // CRA proxied unknown requests; Vite needs path prefixes —\n';
    src += "      // adjust '/api' to match your backend routes.\n";
    src += `      '/api': { target: '${info.proxy}', changeOrigin: true },\n`;
    src += '    },\n';
    src += '  },\n';
  }
  src += '});\n';
  writeFile(path.join(root, 'vite.config.js'), src);
  return { changed: ['vite.config.js'] };
}

function stepCraHtml(root, info) {
  let html = readFile(info.publicHtml);
  // %PUBLIC_URL% refers to the public/ dir, which Vite also serves at /.
  html = html.replace(/%PUBLIC_URL%\//g, '/').replace(/%PUBLIC_URL%/g, '');
  const entryRel = rel(root, info.entry).replace(/\\/g, '/');
  const tag = `<script type="module" src="/${entryRel}"></script>`;
  if (/<\/body\s*>/i.test(html)) html = html.replace(/<\/body\s*>/i, `  ${tag}\n</body>`);
  else html += `\n${tag}\n`;
  writeFile(path.join(root, 'index.html'), html);
  fs.unlinkSync(info.publicHtml);
  return { changed: ['index.html', 'public/index.html (moved to root)'] };
}

function stepCraEnv(root, info) {
  const changed = [];
  const re = /process\.env\.(REACT_APP_[A-Za-z0-9_]+)/g;
  for (const f of info.jsFiles) {
    let code;
    try {
      code = readFile(f);
    } catch {
      continue;
    }
    if (!code.includes('process.env.REACT_APP_')) continue;
    const next = code.replace(re, (_, name) => `import.meta.env.${name.replace(/^REACT_APP_/, 'VITE_')}`);
    if (next !== code) {
      writeFile(f, next);
      changed.push(rel(root, f));
    }
  }
  for (const ef of info.envFiles) {
    const lines = readFile(ef).split('\n');
    let touched = false;
    const out = lines.map(line => {
      const m = line.match(/^(\s*)(REACT_APP_[A-Za-z0-9_]+)(\s*=)/);
      if (m) {
        touched = true;
        return `${m[1]}${m[2].replace(/^REACT_APP_/, 'VITE_')}${m[3]}${line.slice(m[0].length)}`;
      }
      return line;
    });
    if (touched) {
      writeFile(ef, out.join('\n'));
      changed.push(rel(root, ef));
    }
  }
  return { changed };
}

function stepCraScripts(root, info) {
  const pkg = loadPkg(root);
  const done = [];
  for (const [name, cmd] of Object.entries(info.scripts)) {
    if (/react-scripts\s+eject/.test(cmd)) {
      delete pkg.scripts[name];
      done.push(`${name}: removed (eject has no Vite equivalent)`);
      continue;
    }
    const next = cmd
      .replace(/react-scripts\s+start\b/, 'vite')
      .replace(/react-scripts\s+build\b/, 'vite build')
      .replace(/react-scripts\s+test\b/, 'vitest run');
    if (next !== cmd) {
      pkg.scripts[name] = next;
      done.push(`${name}: ${cmd} → ${next}`);
    }
  }
  writePkg(root, pkg);
  return { changed: ['package.json'], note: done.join('; ') };
}

function stepCraJsconfig(root, info) {
  const p = path.join(root, 'jsconfig.json');
  const jc = JSON.parse(readFile(p));
  jc.compilerOptions = jc.compilerOptions || {};
  jc.compilerOptions.paths = {
    '@/*': ['src/*'],
    ...(jc.compilerOptions.paths || {}),
  };
  writeFile(p, JSON.stringify(jc, null, 2) + '\n');
  return { changed: ['jsconfig.json'] };
}

function stepCraDeps(root, info) {
  const pkg = loadPkg(root);
  delete (pkg.dependencies || {})['react-scripts'];
  delete (pkg.devDependencies || {})['react-scripts'];
  pkg.devDependencies = pkg.devDependencies || {};
  pkg.devDependencies['vite'] = info.versions.vite;
  pkg.devDependencies['@vitejs/plugin-react'] = info.versions.pluginReact;
  if (info.svgReactComponent.length)
    pkg.devDependencies['vite-plugin-svgr'] = info.versions.svgr;
  writePkg(root, pkg);
  return { changed: ['package.json'] };
}

function stepCraInstall(root) {
  execFileSync('npm', ['install'], { cwd: root, stdio: 'inherit' });
  return { changed: [] };
}

const CRA_STEPS = {
  config: stepCraConfig,
  html: stepCraHtml,
  env: stepCraEnv,
  scripts: stepCraScripts,
  jsconfig: stepCraJsconfig,
  deps: stepCraDeps,
  install: stepCraInstall,
};

function transformCra(root, plan, det, opts) {
  const changed = [];
  const skipped = [];
  const notes = [];
  const info = det.info;
  const done = [];
  for (const step of plan.steps) {
    if (step.skip) {
      skipped.push({ step: step.label, reason: step.detail });
      continue;
    }
    const fn = CRA_STEPS[step.id];
    if (!fn) {
      skipped.push({ step: step.label, reason: 'unknown step' });
      continue;
    }
    const r = fn(root, info, opts);
    if (r.changed) changed.push(...r.changed);
    if (r.note) notes.push(`${step.label}: ${r.note}`);
    done.push(step.label);
  }
  writeFile(
    path.join(root, 'MIGRATION-NOTES.md'),
    [
      '# Migration notes — cra-to-vite',
      '',
      `Generated by \`rvo migrate cra-to-vite\` on ${new Date().toISOString()}.`,
      'Review each item, then delete this file.',
      '',
      '## Done automatically',
      ...done.map(d => `- ${d}`),
      '',
      '## Manual follow-ups',
      ...(plan.followUps.length ? plan.followUps.map(f => `- ${f}`) : ['- none']),
      '',
    ].join('\n')
  );
  changed.push('MIGRATION-NOTES.md');
  return { changed, skipped, notes };
}

async function verifyCra(root) {
  const checks = [];
  const check = (label, status, detail, output) =>
    checks.push({ label, status, detail, output });
  const cfg = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'].some(f =>
    exists(path.join(root, f))
  );
  check('vite.config.* present', cfg ? 'pass' : 'fail');
  const idx = path.join(root, 'index.html');
  if (exists(idx)) {
    const html = readFile(idx);
    check(
      'index.html at root, %PUBLIC_URL% rewritten',
      /%PUBLIC_URL%/.test(html) ? 'fail' : 'pass',
      /<script type="module"/.test(html) ? 'entry script injected' : 'entry <script type="module"> missing'
    );
    if (!/<script type="module"/.test(html))
      checks[checks.length - 1].status = 'fail';
  } else {
    check('index.html at root', 'fail');
  }
  check(
    'public/index.html moved',
    !exists(path.join(root, 'public', 'index.html')) ? 'pass' : 'fail'
  );
  const pkg = loadPkg(root);
  const deps = pkg ? allDeps(pkg) : {};
  check(
    'react-scripts removed, vite added',
    !deps['react-scripts'] && deps['vite'] ? 'pass' : 'fail',
    deps['vite'] ? `vite ${deps['vite']}` : undefined
  );
  let remaining = 0;
  for (const f of listJsFiles(root)) {
    try {
      if (readFile(f).includes('process.env.REACT_APP_')) remaining++;
    } catch {
      /* ignore */
    }
  }
  check(
    'no REACT_APP_* left in source',
    remaining === 0 ? 'pass' : 'fail',
    remaining ? `${remaining} file(s) still reference process.env.REACT_APP_*` : undefined
  );
  // Build check: only possible with dependencies installed.
  if (exists(path.join(root, 'node_modules')) && pkg && pkg.scripts && pkg.scripts.build) {
    try {
      execFileSync('npm', ['run', 'build'], {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 180000,
      });
      check('npm run build', 'pass');
    } catch (e) {
      const out = ((e.stdout || '') + '\n' + (e.stderr || '')).trim().split('\n').slice(-15).join('\n');
      check('npm run build', 'fail', 'build failed after migration', out);
    }
  } else {
    check('npm run build', 'skip', 'node_modules not installed — run npm install && npm run build');
  }
  return { checks };
}

registerMigration({
  id: 'cra-to-vite',
  title: 'CRA → Vite',
  description: 'Migrate a Create React App (react-scripts) project to Vite.',
  detect: detectCra,
  plan: planCra,
  transform: transformCra,
  verify: verifyCra,
});

// ================================================================ react-19
// Libraries with known React 19 incompatibilities (advisory precheck).
// `min` = oldest version with React 19 support; no `min` = unmaintained.
const REACT_19_RISKS = [
  { name: 'enzyme', reason: 'Enzyme is unmaintained and does not support React 19 — migrate to React Testing Library.' },
  { name: '@material-ui/core', reason: 'MUI v4 does not support React 19 — upgrade to @mui/material v6+.' },
  { name: 'react-test-renderer', reason: 'react-test-renderer is deprecated — use @testing-library/react v16+ instead.' },
  { name: '@testing-library/react', min: '16.0.0', reason: 'requires v16+ for React 19 support.' },
  { name: 'react-redux', min: '9.0.0', reason: 'requires v9+ for React 19 support.' },
  { name: 'react-router-dom', min: '6.28.0', reason: 'requires v6.28+ (or v7) for React 19 support.' },
  { name: 'styled-components', min: '6.1.0', reason: 'requires v6.1+ for React 19 support.' },
  { name: '@types/react', min: '19.0.0', reason: 'type packages must match React 19.' },
  { name: '@types/react-dom', min: '19.0.0', reason: 'type packages must match React 19.' },
];

const R19_PATTERNS = {
  render: /ReactDOM\s*\.\s*render\s*\(/g,
  hydrate: /ReactDOM\s*\.\s*hydrate\s*\(/g,
  stringRef: /\bref\s*=\s*"[^"]+"/g,
  contextTypes: /\b\w+\.contextTypes\s*=|static\s+contextTypes/g,
  childContext: /\bchildContextTypes\b/g,
  findDOMNode: /\bfindDOMNode\s*\(/g,
  forwardRef: /\bforwardRef\s*\(/g,
  propTypes: /\.propTypes\s*=/g,
};

function detectReact19(root) {
  const reasons = [];
  const pkg = loadPkg(root);
  if (!pkg) {
    return {
      detected: false,
      reasons: [chalk.red('  ✗ no package.json found')],
      hint: 'Point rvo at a project directory.',
    };
  }
  const deps = allDeps(pkg);
  const reactRange = deps['react'];
  if (!reactRange) {
    return {
      detected: false,
      reasons: [chalk.dim('  · no react dependency')],
      hint: 'react-19 needs a React project.',
    };
  }
  const major = majorOf(reactRange);
  reasons.push(
    chalk[major !== null && major < 19 ? 'green' : 'dim'](
      `  ${major !== null && major < 19 ? '✓' : '·'} react ${reactRange}${major !== null ? ` (major ${major})` : ''}`
    )
  );
  const jsFiles = listJsFiles(root);
  const hits = {};
  for (const key of Object.keys(R19_PATTERNS)) hits[key] = [];
  for (const f of jsFiles) {
    let code;
    try {
      code = readFile(f);
    } catch {
      continue;
    }
    for (const [key, re] of Object.entries(R19_PATTERNS)) {
      re.lastIndex = 0;
      if (re.test(code)) hits[key].push(f);
    }
  }
  const legacyCount =
    hits.render.length + hits.hydrate.length + hits.stringRef.length + hits.contextTypes.length;
  if (legacyCount)
    reasons.push(
      chalk.green(
        `  ✓ ${legacyCount} legacy pattern(s): ` +
          [
            hits.render.length && `${hits.render.length} ReactDOM.render`,
            hits.hydrate.length && `${hits.hydrate.length} ReactDOM.hydrate`,
            hits.stringRef.length && `${hits.stringRef.length} string ref(s)`,
            hits.contextTypes.length && `${hits.contextTypes.length} contextTypes`,
          ]
            .filter(Boolean)
            .join(', ')
      )
    );
  else reasons.push(chalk.dim('  · no legacy React patterns found'));
  const detected = major === null ? legacyCount > 0 : major < 19 || legacyCount > 0;
  return {
    detected,
    reasons,
    info: { pkg, deps, reactRange, major, jsFiles, hits },
    hint: 'Already on React 19 with no legacy patterns — nothing to migrate.',
  };
}

async function planReact19(root, det, opts) {
  const info = det.info;
  const steps = [];
  const followUps = [];
  const spinner = ora('Resolving latest versions from the npm registry…').start();
  const [reactV, reactDomV, typesReactV, typesDomV] = await Promise.all([
    latestStable('react', '19.0.0'),
    latestStable('react-dom', '19.0.0'),
    latestStable('@types/react', '19.0.0'),
    latestStable('@types/react-dom', '19.0.0'),
  ]);
  spinner.stop();
  info.versions = {
    react: '^' + reactV,
    reactDom: '^' + reactDomV,
    typesReact: '^' + typesReactV,
    typesDom: '^' + typesDomV,
  };

  // Peer-compat precheck against the known-risk list.
  info.peerRisks = [];
  for (const risk of REACT_19_RISKS) {
    const range = info.deps[risk.name];
    if (!range) continue;
    if (!risk.min) {
      info.peerRisks.push(`${risk.name} ${range} — ${risk.reason}`);
      continue;
    }
    const minV = majorOf(range) !== null ? semver.minVersion(String(range)) : null;
    if (minV && semver.lt(minV, risk.min))
      info.peerRisks.push(`${risk.name} ${range} — ${risk.reason}`);
  }
  if (info.peerRisks.length)
    followUps.push(
      'Peer-compat risks for React 19:\n      ' + info.peerRisks.join('\n      ')
    );

  const depTargets = ['react', 'react-dom'];
  if (info.deps['@types/react']) depTargets.push('@types/react');
  if (info.deps['@types/react-dom']) depTargets.push('@types/react-dom');
  steps.push({
    id: 'deps',
    label: 'Upgrade React to 19',
    detail: depTargets
      .map(n =>
        n === 'react'
          ? `react ${info.reactRange} → ${info.versions.react}`
          : n === 'react-dom'
            ? `react-dom ${info.deps['react-dom']} → ${info.versions.reactDom}`
            : `${n} → ${n === '@types/react' ? info.versions.typesReact : info.versions.typesDom}`
      )
      .join(', '),
  });
  const renderFiles = info.hits.render.length + info.hits.hydrate.length;
  steps.push({
    id: 'createroot',
    label: 'ReactDOM.render → createRoot',
    detail:
      renderFiles === 0
        ? 'no ReactDOM.render/hydrate calls found'
        : `${renderFiles} file(s)`,
    skip: renderFiles === 0,
  });
  steps.push({
    id: 'stringrefs',
    label: 'String refs → createRef',
    detail:
      info.hits.stringRef.length === 0
        ? 'no string refs found'
        : `${info.hits.stringRef.length} file(s)`,
    skip: info.hits.stringRef.length === 0,
  });
  let officialBin = null;
  try {
    officialBin = require.resolve('react-codemod/bin/react-codemod.js');
  } catch {
    /* not installed — built-ins cover the codemods */
  }
  info.officialBin = officialBin;
  steps.push({
    id: 'official',
    label: 'Official react-codemod transforms',
    detail: officialBin
      ? 'rename-unsafe-lifecycles, update-react-imports (via installed react-codemod)'
      : 'react-codemod not installed — rvo built-ins cover createRoot/string-refs',
    skip: !officialBin,
  });
  if (opts.install === false) {
    steps.push({ id: 'install', label: 'npm install', detail: 'skipped (--no-install)', skip: true });
  } else {
    steps.push({ id: 'install', label: 'Run npm install', detail: 'installs React 19' });
  }

  if (info.hits.contextTypes.length || info.hits.childContext.length)
    followUps.push(
      `Legacy context API (${[...info.hits.contextTypes, ...info.hits.childContext].map(f => rel(root, f)).join(', ')}) — ` +
        'contextTypes/childContextTypes have no safe automatic rewrite; migrate to the createContext/useContext API manually.'
    );
  if (info.hits.findDOMNode.length)
    followUps.push(
      `findDOMNode is REMOVED in React 19 (${info.hits.findDOMNode.map(f => rel(root, f)).join(', ')}) — replace with callback refs before upgrading.`
    );
  if (info.hits.forwardRef.length)
    followUps.push(
      `forwardRef used in ${info.hits.forwardRef.length} file(s) — React 19 accepts ref as a regular prop, so forwardRef wrappers can be simplified (left in place; still works).`
    );
  if (info.hits.propTypes.length)
    followUps.push(
      `PropTypes in ${info.hits.propTypes.length} file(s) — consider TypeScript types; PropTypes still work in React 19.`
    );
  return { steps, followUps };
}

// ------------------------------------------------- react-19: codemod utils
function tryParse(code, filename) {
  try {
    return parse(code, filename);
  } catch {
    return null;
  }
}

// ReactDOM.render(el, container) → createRoot(container).render(el)
// ReactDOM.hydrate(el, container) → hydrateRoot(container, el)
// Repairs the react-dom import: replaced by react-dom/client when ReactDOM
// is no longer referenced, otherwise the client import is added alongside.
function codemodCreateRoot(code, filename) {
  const ast = tryParse(code, filename);
  if (!ast) return { changed: false, reason: 'parse error' };
  const domNames = new Set();
  traverse(ast, {
    ImportDeclaration(p) {
      if (p.node.source.value === 'react-dom') {
        for (const s of p.node.specifiers) {
          if (t.isImportDefaultSpecifier(s) || t.isImportNamespaceSpecifier(s))
            domNames.add(s.local.name);
        }
      }
    },
  });
  if (!domNames.size) return { changed: false };
  let usesRender = false;
  let usesHydrate = false;
  let replaced = 0;
  traverse(ast, {
    CallExpression(p) {
      const cal = p.node.callee;
      if (!t.isMemberExpression(cal, { computed: false })) return;
      if (!t.isIdentifier(cal.object) || !domNames.has(cal.object.name)) return;
      if (!t.isIdentifier(cal.property)) return;
      const args = p.node.arguments;
      if (cal.property.name === 'render' && args.length >= 2) {
        p.replaceWith(
          t.callExpression(
            t.memberExpression(
              t.callExpression(t.identifier('createRoot'), [args[1]]),
              t.identifier('render')
            ),
            [args[0]]
          )
        );
        usesRender = true;
        replaced++;
      } else if (cal.property.name === 'hydrate' && args.length >= 2) {
        p.replaceWith(t.callExpression(t.identifier('hydrateRoot'), [args[1], args[0]]));
        usesHydrate = true;
        replaced++;
      }
    },
  });
  if (!replaced) return { changed: false };
  let stillUsed = false;
  traverse(ast, {
    MemberExpression(p) {
      if (t.isIdentifier(p.node.object) && domNames.has(p.node.object.name)) stillUsed = true;
    },
  });
  const needed = [];
  if (usesRender) needed.push('createRoot');
  if (usesHydrate) needed.push('hydrateRoot');
  const clientImport = t.importDeclaration(
    needed.map(n => t.importSpecifier(t.identifier(n), t.identifier(n))),
    t.stringLiteral('react-dom/client')
  );
  traverse(ast, {
    ImportDeclaration(p) {
      if (p.node.source.value !== 'react-dom') return;
      if (!stillUsed) {
        const kept = p.node.specifiers.filter(
          s => !t.isImportDefaultSpecifier(s) && !t.isImportNamespaceSpecifier(s)
        );
        if (!kept.length) p.replaceWith(clientImport);
        else {
          p.node.specifiers = kept;
          p.insertAfter(clientImport);
        }
      } else {
        p.insertAfter(clientImport);
      }
      p.stop();
    },
  });
  return { changed: true, code: generate(ast).code, replaced };
}

// ref="name" → ref={this.name} with this.name = React.createRef() in the
// constructor, and this.refs.name → this.name.current. Class components only.
// Skips refs whose name collides with an existing this.<name> assignment.
function codemodStringRefs(code, filename) {
  const ast = tryParse(code, filename);
  if (!ast) return { changed: false, reason: 'parse error' };
  const converted = new Set();
  const skipped = [];
  let dirty = false;
  traverse(ast, {
    Class(p) {
      // string refs owned by THIS class (skip nested classes)
      const refNames = new Map();
      p.traverse({
        Class(inner) {
          if (inner !== p) inner.skip();
        },
        JSXAttribute(ap) {
          if (
            ap.node.name &&
            ap.node.name.name === 'ref' &&
            t.isStringLiteral(ap.node.value) &&
            /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(ap.node.value.value)
          ) {
            const n = ap.node.value.value;
            if (!refNames.has(n)) refNames.set(n, []);
            refNames.get(n).push(ap);
          }
        },
      });
      if (!refNames.size) return;
      // names already assigned on this.* — never overwrite them
      const assigned = new Set();
      p.traverse({
        Class(inner) {
          if (inner !== p) inner.skip();
        },
        AssignmentExpression(aep) {
          const l = aep.node.left;
          if (
            t.isMemberExpression(l, { computed: false }) &&
            t.isThisExpression(l.object) &&
            t.isIdentifier(l.property)
          )
            assigned.add(l.property.name);
        },
        ClassProperty(cp) {
          if (t.isIdentifier(cp.node.key)) assigned.add(cp.node.key.name);
        },
      });
      const convertible = [...refNames.keys()].filter(n => !assigned.has(n));
      for (const n of refNames.keys()) {
        if (assigned.has(n))
          skipped.push(`ref="${n}": this.${n} already assigned — left unchanged`);
      }
      if (!convertible.length) return;
      let ctor = p.node.body.body.find(m => t.isClassMethod(m) && m.kind === 'constructor');
      if (!ctor) {
        ctor = t.classMethod(
          'constructor',
          t.identifier('constructor'),
          [t.identifier('props')],
          t.blockStatement([
            t.expressionStatement(t.callExpression(t.super(), [t.identifier('props')])),
          ])
        );
        p.node.body.body.unshift(ctor);
      }
      for (const n of convertible) {
        ctor.body.body.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.thisExpression(), t.identifier(n)),
              t.callExpression(
                t.memberExpression(t.identifier('React'), t.identifier('createRef')),
                []
              )
            )
          )
        );
        for (const ap of refNames.get(n)) {
          ap.node.value = t.jsxExpressionContainer(
            t.memberExpression(t.thisExpression(), t.identifier(n))
          );
        }
        converted.add(n);
      }
      // this.refs.<name> → this.<name>.current (only for converted refs)
      p.traverse({
        Class(inner) {
          if (inner !== p) inner.skip();
        },
        MemberExpression(mp) {
          const o = mp.node.object;
          if (
            t.isMemberExpression(o, { computed: false }) &&
            t.isThisExpression(o.object) &&
            t.isIdentifier(o.property, { name: 'refs' }) &&
            t.isIdentifier(mp.node.property) &&
            converted.has(mp.node.property.name)
          ) {
            mp.replaceWith(
              t.memberExpression(
                t.memberExpression(t.thisExpression(), t.identifier(mp.node.property.name)),
                t.identifier('current')
              )
            );
          }
        },
      });
      dirty = true;
    },
  });
  if (!dirty) return { changed: false, skipped };
  // ensure React is in scope for React.createRef()
  let hasReact = false;
  traverse(ast, {
    ImportDeclaration(p) {
      if (p.node.source.value === 'react') {
        for (const s of p.node.specifiers) {
          if (
            (t.isImportDefaultSpecifier(s) || t.isImportNamespaceSpecifier(s)) &&
            s.local.name === 'React'
          )
            hasReact = true;
        }
      }
    },
  });
  if (!hasReact) {
    ast.program.body.unshift(
      t.importDeclaration(
        [t.importDefaultSpecifier(t.identifier('React'))],
        t.stringLiteral('react')
      )
    );
  }
  return { changed: true, code: generate(ast).code, converted: [...converted], skipped };
}

// Best-effort wrapper around the official react-codemod transforms.
// Runs only when react-codemod is resolvable locally (no network fetch);
// any failure falls back to rvo's built-ins without failing the migration.
function tryOfficialCodemods(root, bin, names) {
  const srcDir = path.join(root, 'src');
  if (!exists(srcDir)) return { ran: false, reason: 'no src/ directory' };
  const ran = [];
  const failed = [];
  for (const name of names) {
    try {
      execFileSync('node', [bin, name, srcDir], {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 120000,
      });
      ran.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { ran: ran.length > 0, ranTransforms: ran, failed };
}

// ------------------------------------------------- react-19: transform/verify
function stepReact19Deps(root, info) {
  const pkg = loadPkg(root);
  const setDep = (name, version) => {
    if (pkg.dependencies && pkg.dependencies[name] !== undefined) pkg.dependencies[name] = version;
    else if (pkg.devDependencies && pkg.devDependencies[name] !== undefined)
      pkg.devDependencies[name] = version;
    else {
      pkg.dependencies = pkg.dependencies || {};
      pkg.dependencies[name] = version;
    }
  };
  setDep('react', info.versions.react);
  setDep('react-dom', info.versions.reactDom);
  if (allDeps(pkg)['@types/react']) setDep('@types/react', info.versions.typesReact);
  if (allDeps(pkg)['@types/react-dom']) setDep('@types/react-dom', info.versions.typesDom);
  writePkg(root, pkg);
  return { changed: ['package.json'] };
}

function stepReact19Codemods(root, info, stepIds) {
  const changed = [];
  const skipped = [];
  const notes = [];
  for (const f of info.jsFiles) {
    let code;
    try {
      code = readFile(f);
    } catch {
      continue;
    }
    let next = code;
    if (stepIds.includes('createroot')) {
      const r = codemodCreateRoot(next, f);
      if (r.changed) {
        next = r.code;
        notes.push(`${rel(root, f)}: ReactDOM.render → createRoot (${r.replaced})`);
      } else if (r.reason) {
        skipped.push({ step: rel(root, f), reason: `createRoot skipped (${r.reason})` });
      }
    }
    if (stepIds.includes('stringrefs')) {
      const r = codemodStringRefs(next, f);
      if (r.changed) {
        next = r.code;
        notes.push(`${rel(root, f)}: string refs → createRef (${r.converted.join(', ')})`);
      }
      for (const s of r.skipped || []) skipped.push({ step: rel(root, f), reason: s });
    }
    if (next !== code) {
      writeFile(f, next);
      changed.push(rel(root, f));
    }
  }
  return { changed, skipped, notes };
}

function transformReact19(root, plan, det, opts) {
  const changed = [];
  const skipped = [];
  const notes = [];
  const info = det.info;
  const active = new Set(plan.steps.filter(s => !s.skip).map(s => s.id));
  if (active.has('deps')) {
    const r = stepReact19Deps(root, info);
    changed.push(...r.changed);
    notes.push(`React upgraded: react ${info.versions.react}, react-dom ${info.versions.reactDom}`);
  }
  if (active.has('createroot') || active.has('stringrefs')) {
    const r = stepReact19Codemods(root, info, [...active]);
    changed.push(...r.changed);
    skipped.push(...r.skipped);
    notes.push(...r.notes);
  }
  if (active.has('official') && info.officialBin) {
    const r = tryOfficialCodemods(root, info.officialBin, [
      'rename-unsafe-lifecycles',
      'update-react-imports',
    ]);
    if (r.ran) {
      notes.push(`official react-codemod ran: ${r.ranTransforms.join(', ')}`);
      if (r.failed.length) notes.push(`official transforms failed (left to built-ins): ${r.failed.join(', ')}`);
    } else {
      notes.push('official react-codemod: skipped (no transforms applied)');
    }
  }
  if (active.has('install')) {
    execFileSync('npm', ['install'], { cwd: root, stdio: 'inherit' });
  }
  const done = plan.steps.filter(s => !s.skip).map(s => s.label);
  writeMigrationNotes(root, 'react-19', done, plan.followUps);
  changed.push('MIGRATION-NOTES.md');
  return { changed, skipped, notes };
}

async function verifyReact19(root) {
  const checks = [];
  const check = (label, status, detail) => checks.push({ label, status, detail });
  let renderLeft = 0;
  let refsLeft = 0;
  for (const f of listJsFiles(root)) {
    try {
      const code = readFile(f);
      if (/ReactDOM\s*\.\s*(render|hydrate)\s*\(/.test(code)) renderLeft++;
      if (/\bref\s*=\s*"[^"]+"/.test(code)) refsLeft++;
    } catch {
      /* ignore */
    }
  }
  check(
    'no ReactDOM.render/hydrate left',
    renderLeft === 0 ? 'pass' : 'fail',
    renderLeft ? `${renderLeft} file(s) still call ReactDOM.render/hydrate` : undefined
  );
  check(
    'no string refs left',
    refsLeft === 0 ? 'pass' : 'fail',
    refsLeft ? `${refsLeft} file(s) still use ref="…"` : undefined
  );
  const pkg = loadPkg(root);
  const major = pkg ? majorOf(allDeps(pkg)['react']) : null;
  check(
    'react is 19.x',
    major === 19 ? 'pass' : 'fail',
    major === null ? 'could not parse react version' : `react major is ${major}`
  );
  if (exists(path.join(root, 'node_modules')) && pkg && pkg.scripts && pkg.scripts.build) {
    try {
      execFileSync('npm', ['run', 'build'], {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 180000,
      });
      check('npm run build', 'pass');
    } catch (e) {
      const out = ((e.stdout || '') + '\n' + (e.stderr || '')).trim().split('\n').slice(-15).join('\n');
      check('npm run build', 'fail', 'build failed after migration', out);
    }
  } else {
    check('npm run build', 'skip', 'node_modules not installed — run npm install && npm run build');
  }
  return { checks };
}

registerMigration({
  id: 'react-19',
  title: 'React 19',
  description: 'Upgrade React 17/18 → 19 with peer-compat precheck and legacy codemods.',
  detect: detectReact19,
  plan: planReact19,
  transform: transformReact19,
  verify: verifyReact19,
});

// ------------------------------------------------------------------ exports
module.exports = {
  MIGRATIONS,
  listMigrations,
  runMigration,
  suggestMigrations,
  // exported for unit tests
  detectCra,
  detectReact19,
  codemodCreateRoot,
  codemodStringRefs,
  latestStable,
};
