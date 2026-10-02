// rvo doctor: environment + project health checks. Diagnostic only —
// never modifies anything and never requires a license.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readJson } = require('./utils');

function majorOf(v) {
  const m = /^v?(\d+)/.exec(String(v || ''));
  return m ? Number(m[1]) : null;
}

// Returns { checks: [{ name, status: 'pass'|'warn'|'fail', detail }], failed, warned }
function checkDoctor(root) {
  const checks = [];
  const push = (name, status, detail) => checks.push({ name, status, detail });

  // --- Node.js
  const nodeMajor = majorOf(process.versions.node);
  if (nodeMajor == null) push('Node.js version', 'warn', 'could not determine version');
  else if (nodeMajor >= 18)
    push('Node.js version', 'pass', `${process.versions.node} (>= 18 recommended)`);
  else if (nodeMajor >= 16)
    push('Node.js version', 'warn', `${process.versions.node} — works, but 18+ is recommended`);
  else
    push('Node.js version', 'fail', `${process.versions.node} — rvo requires Node >= 16`);

  // --- npm
  try {
    const npmV = execFileSync('npm', ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
    const npmMajor = majorOf(npmV);
    if (npmMajor != null && npmMajor >= 8)
      push('npm available', 'pass', `npm ${npmV}`);
    else
      push('npm available', 'warn', `npm ${npmV} — 8+ recommended for \`rvo upgrade\``);
  } catch {
    push('npm available', 'warn', 'npm not found on PATH — `rvo upgrade` needs it');
  }

  // --- package.json
  const pkgPath = path.join(root, 'package.json');
  let pkg = null;
  if (!fs.existsSync(pkgPath)) {
    push('package.json', 'fail', `no package.json found under ${root}`);
    return finalize(checks);
  }
  try {
    pkg = readJson(pkgPath);
    push('package.json', 'pass', pkg.name ? `${pkg.name}${pkg.version ? '@' + pkg.version : ''}` : 'found');
  } catch {
    push('package.json', 'fail', 'package.json exists but is not valid JSON');
    return finalize(checks);
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  // --- React
  if (deps.react) push('React dependency', 'pass', `react ${deps.react}`);
  else push('React dependency', 'fail', 'react not found in dependencies — rvo analyzes React codebases');
  if (deps['react-dom']) push('react-dom dependency', 'pass', `react-dom ${deps['react-dom']}`);
  else push('react-dom dependency', 'warn', 'react-dom not found — fine for React Native, unusual for web');

  // --- Vite
  const hasViteDep = Boolean(deps.vite);
  const hasViteConfig =
    fs.existsSync(path.join(root, 'vite.config.js')) ||
    fs.existsSync(path.join(root, 'vite.config.ts')) ||
    fs.existsSync(path.join(root, 'vite.config.mjs'));
  if (hasViteDep || hasViteConfig)
    push(
      'Vite project',
      'pass',
      [hasViteDep ? `vite ${deps.vite}` : null, hasViteConfig ? 'vite.config.* found' : null]
        .filter(Boolean)
        .join(', ')
    );
  else
    push('Vite project', 'warn', 'no vite dependency or vite.config.* — rvo works anyway, some checks assume Vite');

  // --- src directory
  if (fs.existsSync(path.join(root, 'src'))) push('src/ directory', 'pass', 'found');
  else push('src/ directory', 'warn', 'no src/ directory — set "srcDir" in .rvorc.json if sources live elsewhere');

  // --- build script
  const scripts = pkg.scripts || {};
  if (scripts.build) push('build script', 'pass', `npm run build → ${scripts.build}`);
  else push('build script', 'warn', 'no "build" script — bundle-budget checks need `vite build` output in dist/');

  // --- rvo config
  if (fs.existsSync(path.join(root, '.rvorc.json')))
    push('rvo config', 'pass', '.rvorc.json found — custom settings active');
  else push('rvo config', 'pass', 'no .rvorc.json — using defaults');

  return finalize(checks);
}

function finalize(checks) {
  return {
    checks,
    failed: checks.filter(c => c.status === 'fail').length,
    warned: checks.filter(c => c.status === 'warn').length,
  };
}

module.exports = { checkDoctor };
