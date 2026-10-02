// rvo split — microfrontend readiness analyzer (free tier).
//
// Answers two questions about a React (+Vite) app:
//   1. Do you need microfrontends at all? (honest verdict, not a sales pitch)
//   2. If so, what splits cleanly — and what would hurt?
//
// Method: cluster src/ into feature areas (top-level dirs + react-router
// route groups), build the cross-cluster import matrix, inventory the shared
// surface (shared dirs, context/state used by several features), then score.
// The JSON output doubles as the plan consumed by `rvo split convert`.
const fs = require('fs');
const path = require('path');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const chalk = require('chalk');
const { parse, loadConfig, readJson } = require('./utils');
const { buildProject } = require('./analyzer');

const posix = p => String(p).split(path.sep).join('/');

// Directories that are infrastructure, not features. Files under them form
// the shared surface (shell or shared federation modules), never remotes.
const SHARED_DIRS = new Set([
  'components', 'common', 'shared', 'ui', 'kit', 'design-system', 'ds',
  'context', 'contexts', 'store', 'stores', 'state',
  'hooks', 'utils', 'util', 'helpers', 'helper', 'lib', 'libs',
  'services', 'service', 'api', 'apis', 'assets', 'styles', 'style',
  'theme', 'themes', 'config', 'configs', 'constants', 'const',
  'types', 'models', 'mocks', 'fixtures', 'test-utils',
]);

// Containers whose children are the real features: src/pages/shop → shop.
const FEATURE_CONTAINER_DIRS = new Set([
  'pages', 'routes', 'views', 'screens', 'features', 'modules',
  'domains', 'apps', 'sections',
]);

const STATE_LIBS = new Set([
  'redux', 'react-redux', '@reduxjs/toolkit', 'zustand', 'jotai',
  'recoil', 'mobx', 'mobx-react', 'valtio', 'xstate', '@xstate/react',
]);

// Preferred federation `shared` order: framework first, then state.
const FEDERATION_SHARED_ORDER = [
  'react', 'react-dom', 'react-router-dom', 'react-router',
];

// Map a src-relative path (e.g. 'shop/ShopHome.jsx', 'pages/admin/X.jsx')
// to its cluster. Returns { kind: 'feature'|'shared'|'shell', name, depth }
// where depth = leading path segments that identify the cluster.
function clusterOf(srcRel) {
  const parts = srcRel.split('/').filter(Boolean);
  if (parts.length <= 1) return { kind: 'shell', name: 'shell', depth: 0 };
  const top = parts[0].toLowerCase();
  if (FEATURE_CONTAINER_DIRS.has(top)) {
    const sub = (parts[1] || '').toLowerCase();
    if (!sub) return { kind: 'shell', name: 'shell', depth: 1 };
    if (SHARED_DIRS.has(sub)) return { kind: 'shared', name: sub, depth: 2 };
    return { kind: 'feature', name: sub, depth: 2 };
  }
  if (SHARED_DIRS.has(top)) return { kind: 'shared', name: top, depth: 1 };
  return { kind: 'feature', name: top, depth: 1 };
}

function groupKey(routePath) {
  const seg = String(routePath).split('/').filter(Boolean)[0];
  return (seg || 'root').toLowerCase();
}

function jsxAttrString(value) {
  if (!value) return null;
  if (t.isStringLiteral(value)) return value.value;
  if (t.isJSXExpressionContainer(value)) {
    const e = value.expression;
    if (t.isStringLiteral(e)) return e.value;
    if (t.isTemplateLiteral(e) && e.expressions.length === 0)
      return e.quasis.map(q => q.value.cooked).join('');
  }
  return null;
}

// Collect routes from <Route path="…"> JSX and from route-config objects
// ({ path: '/x', children: [...] }). Config objects are only trusted in
// files that touch react-router (or are named *route*), to avoid
// false-positives like { path: '/api/…' } fetch configs.
function collectRoutes(project) {
  const routes = []; // { path, file, kind }
  for (const abs of project.files.keys()) {
    let code;
    try {
      code = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!/Route/.test(code) && !/\bpath\s*:/.test(code)) continue;
    let ast;
    try {
      ast = parse(code, abs);
    } catch {
      continue;
    }
    const info = project.files.get(abs);
    const routerish = (info && info.usesRouter) || /route/i.test(path.basename(abs));
    const fileRel = abs;
    traverse(ast, {
      JSXElement(p) {
        const opening = p.node.openingElement;
        if (!t.isJSXIdentifier(opening.name, { name: 'Route' })) return;
        const attr = opening.attributes.find(
          a => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: 'path' })
        );
        const v = attr && jsxAttrString(attr.value);
        // Only absolute paths drive cluster grouping; relative nested
        // routes (path="cart") belong to the enclosing <Routes> anyway.
        if (v && v.startsWith('/')) routes.push({ path: v, file: fileRel, kind: 'jsx' });
      },
      ObjectProperty(p) {
        if (!routerish) return;
        const key = p.node.key;
        const isPathKey =
          t.isIdentifier(key, { name: 'path' }) ||
          t.isStringLiteral(key, { value: 'path' });
        if (isPathKey && t.isStringLiteral(p.node.value) && p.node.value.value.startsWith('/')) {
          routes.push({ path: p.node.value.value, file: fileRel, kind: 'config' });
        }
      },
    });
  }
  return routes;
}

// Files that call createContext(): { file, names[] }.
function collectContexts(project) {
  const out = [];
  for (const abs of project.files.keys()) {
    let code;
    try {
      code = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!code.includes('createContext')) continue;
    let ast;
    try {
      ast = parse(code, abs);
    } catch {
      continue;
    }
    const names = [];
    traverse(ast, {
      CallExpression(p) {
        if (!t.isIdentifier(p.node.callee, { name: 'createContext' })) return;
        const parent = p.parentPath;
        if (parent.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
          names.push(parent.node.id.name);
        }
      },
    });
    if (names.length) out.push({ file: abs, names });
  }
  return out;
}

function readPkg(root) {
  try {
    return readJson(path.join(root, 'package.json'));
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ analyze

function analyzeSplit(root) {
  root = path.resolve(root);
  const config = loadConfig(root);
  const srcDir = path.join(root, config.srcDir);
  const project = buildProject(root, config);
  const pkg = readPkg(root);
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  // --- cluster every file -------------------------------------------------
  const fileCluster = new Map(); // abs -> { kind, name, depth }
  for (const abs of project.files.keys()) {
    fileCluster.set(abs, clusterOf(posix(path.relative(srcDir, abs))));
  }
  const clusters = new Map(); // `${kind}:${name}` -> cluster record
  const relRoot = abs => posix(path.relative(root, abs));
  for (const [abs, c] of fileCluster) {
    const key = `${c.kind}:${c.name}`;
    if (!clusters.has(key)) {
      clusters.set(key, {
        kind: c.kind,
        name: c.name,
        files: [],
        loc: 0,
        routes: [],
      });
    }
    const rec = clusters.get(key);
    rec.files.push(relRoot(abs));
    rec.loc += project.files.get(abs).lineCount || 0;
  }
  for (const rec of clusters.values()) rec.files.sort();

  const featureClusters = [...clusters.values()]
    .filter(c => c.kind === 'feature')
    .sort((a, b) => b.files.length - a.files.length);
  const sharedClusters = [...clusters.values()].filter(c => c.kind === 'shared');
  const shellFiles = (clusters.get('shell:shell') || { files: [] }).files;

  // --- routes → feature clusters ------------------------------------------
  const routes = collectRoutes(project);
  const warnings = [];
  const routesByFile = new Map(); // abs -> count (for entry picking)
  for (const r of routes) {
    routesByFile.set(r.file, (routesByFile.get(r.file) || 0) + 1);
    const gk = groupKey(r.path);
    const match = featureClusters.find(c => c.name === gk);
    if (match) {
      if (!match.routes.includes(r.path)) match.routes.push(r.path);
    } else if (gk !== 'root') {
      warnings.push(
        `Route "${r.path}" (${relRoot(r.file)}) has no matching feature directory — kept in the shell.`
      );
    }
  }
  for (const c of featureClusters) c.routes.sort();

  // --- coupling: cross-feature import matrix -------------------------------
  let intra = 0;
  const pairMap = new Map(); // "a → b" -> { from, to, imports, examples[] }
  for (const [target, importers] of project.importers) {
    const tc = fileCluster.get(target);
    if (!tc) continue;
    const seen = new Set(); // dedupe multiple specifiers of one statement
    for (const imp of importers) {
      const fc = fileCluster.get(imp.from);
      if (!fc) continue;
      const dedupe = imp.from + '\n' + target;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      if (fc.kind !== 'feature' || tc.kind !== 'feature') continue;
      if (fc.name === tc.name) {
        intra++;
      } else {
        const pk = `${fc.name} → ${tc.name}`;
        if (!pairMap.has(pk)) {
          pairMap.set(pk, { from: fc.name, to: tc.name, imports: 0, examples: [] });
        }
        const pe = pairMap.get(pk);
        pe.imports++;
        if (pe.examples.length < 3) {
          pe.examples.push({ from: relRoot(imp.from), to: relRoot(target) });
        }
      }
    }
  }
  const pairs = [...pairMap.values()].map(pe => {
    const circular = pairMap.has(`${pe.to} → ${pe.from}`);
    return {
      ...pe,
      circular,
      risk: pe.imports >= 3 || circular ? 'high' : 'medium',
    };
  });
  pairs.sort((a, b) => b.imports - a.imports || a.from.localeCompare(b.from));
  const cross = pairs.reduce((n, p) => n + p.imports, 0);
  const crossRatio = intra + cross === 0 ? 0 : cross / (intra + cross);

  // --- shared surface -------------------------------------------------------
  const sharedFiles = sharedClusters.flatMap(c => c.files).sort();
  const sharedDirs = sharedClusters
    .map(c => ({ name: c.name, files: c.files.length }))
    .sort((a, b) => b.files - a.files);
  const contexts = collectContexts(project).map(ctx => {
    const usedBy = new Set();
    for (const imp of project.importers.get(ctx.file) || []) {
      const c = fileCluster.get(imp.from);
      if (c && c.kind === 'feature') usedBy.add(c.name);
    }
    return {
      names: ctx.names,
      file: relRoot(ctx.file),
      usedBy: [...usedBy].sort(),
    };
  });
  const stateLibs = [...STATE_LIBS].filter(l => deps[l]);
  const multiFeatureContexts = contexts.filter(c => c.usedBy.length >= 2);

  const sharedDeps = [
    ...FEDERATION_SHARED_ORDER.filter(l => deps[l]),
    ...stateLibs.filter(l => !FEDERATION_SHARED_ORDER.includes(l)),
  ];

  // --- verdict ----------------------------------------------------------------
  const totalFiles = project.files.size;
  const totalLoc = [...project.files.values()].reduce(
    (n, f) => n + (f.lineCount || 0),
    0
  );
  const reasons = [];
  let verdict;
  if (featureClusters.length < 2) {
    verdict = 'not-needed';
    reasons.push(
      `Only ${featureClusters.length} distinct feature area(s) detected — there is nothing meaningful to split; a monolith is the right call.`
    );
  } else if (totalFiles < 15 || totalLoc < 1500) {
    verdict = 'not-needed';
    reasons.push(
      `Small, cohesive app (${totalFiles} files, ${totalLoc.toLocaleString()} LOC) — microfrontends would add deployment and versioning cost without benefit.`
    );
  } else if (crossRatio > 0.6) {
    verdict = 'worth-considering';
    reasons.push(
      `High inter-feature coupling (${Math.round(crossRatio * 100)}% of feature imports cross boundaries) — decouple ${pairs[0].from} → ${pairs[0].to} first, then split.`
    );
    reasons.push(
      `${featureClusters.length} independently-routable feature areas detected; size justifies splitting once coupling drops.`
    );
  } else if (featureClusters.length >= 3) {
    verdict = 'recommended';
    reasons.push(
      `${featureClusters.length} independently-routable feature areas with low coupling (${Math.round(crossRatio * 100)}% cross-feature imports) — strong microfrontend candidates.`
    );
  } else {
    verdict = 'worth-considering';
    reasons.push(
      `${featureClusters.length} feature areas in a mid-size app (${totalFiles} files) — splitting is viable but optional; the monolith is not hurting you yet.`
    );
  }
  if (multiFeatureContexts.length) {
    reasons.push(
      `Shared state (${multiFeatureContexts.map(c => c.names.join('/')).join(', ')}) is used by ${[
        ...new Set(multiFeatureContexts.flatMap(c => c.usedBy)),
      ].join(', ')} — keep it in the shell or a shared federation module.`
    );
  }

  // --- remotes -----------------------------------------------------------------
  const pickEntry = c => {
    const absFiles = c.files.map(f => path.join(root, f)).sort();
    let best = null;
    let bestScore = -1;
    for (const abs of absFiles) {
      const routeCount = routesByFile.get(abs) || 0;
      const info = project.files.get(abs);
      const base = path.basename(abs);
      let score = routeCount * 10;
      // The entry should be renderable — prefer files that define components,
      // especially a default-exported *Routes component (what the shell mounts).
      if (info && info.components && info.components.length) score += 8;
      const defName = info && info.defaultExportName;
      if (defName) score += /routes?$/i.test(defName) ? 12 : 2;
      if (/routes?\./i.test(base)) score += 5;
      if (/^index\./i.test(base)) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = abs;
      }
    }
    return relRoot(best || absFiles[0]);
  };
  const remotes = featureClusters.map(c => ({
    name: c.name,
    routes: c.routes,
    files: c.files,
    entry: pickEntry(c),
    loc: c.loc,
    fileCount: c.files.length,
  }));

  const risks = pairs.map(
    p =>
      `Decouple "${p.from} → ${p.to}" (${p.imports} cross-import${p.imports === 1 ? '' : 's'}, risk: ${p.risk}${p.circular ? ', circular' : ''}) before extracting — move the shared code into the shell or a shared module first.`
  );

  return {
    tool: 'rvo split',
    version: '1.0.0',
    root,
    generatedAt: new Date().toISOString(),
    verdict,
    reasons,
    stats: {
      files: totalFiles,
      loc: totalLoc,
      features: featureClusters.length,
      sharedFiles: sharedFiles.length,
      shellFiles: shellFiles.length,
      routes: routes.length,
    },
    clusters: [...clusters.values()].map(c => ({
      kind: c.kind,
      name: c.name,
      files: c.files,
      fileCount: c.files.length,
      loc: c.loc,
      routes: c.routes,
    })),
    coupling: { intra, cross, crossRatio: Math.round(crossRatio * 1000) / 1000, pairs },
    shared: {
      dirs: sharedDirs,
      files: sharedFiles,
      contexts,
      stateLibs,
    },
    remotes,
    shell: { files: shellFiles },
    sharedDeps,
    risks,
    warnings,
  };
}

// ------------------------------------------------------------------ printing

function printSplit(plan) {
  const vColor =
    plan.verdict === 'recommended'
      ? chalk.green
      : plan.verdict === 'worth-considering'
        ? chalk.yellow
        : chalk.cyan;
  console.log(chalk.bold.cyan('\nrvo split — microfrontend analysis'));
  console.log(chalk.dim('  ' + plan.root));
  console.log(`\n  Verdict: ${vColor.bold(plan.verdict.toUpperCase())}`);
  for (const r of plan.reasons) console.log(chalk.dim(`    · ${r}`));

  const feats = plan.clusters.filter(c => c.kind === 'feature');
  console.log(chalk.bold(`\n  Feature candidates (${feats.length}):`));
  for (const c of feats) {
    const routes = c.routes.length ? ` — routes: ${c.routes.join(', ')}` : '';
    console.log(
      `    ${chalk.green('●')} ${chalk.bold(c.name)} — ${c.fileCount} files, ${c.loc.toLocaleString()} LOC${chalk.dim(routes)}`
    );
  }

  const { intra, cross, pairs } = plan.coupling;
  console.log(
    chalk.bold(
      `\n  Coupling — cross-feature imports: ${cross} (${Math.round(plan.coupling.crossRatio * 100)}% of feature imports; ${intra} intra-feature)`
    )
  );
  if (!pairs.length) {
    console.log(chalk.dim('    No cross-feature imports — clean boundaries.'));
  }
  for (const p of pairs) {
    const mark = p.risk === 'high' ? chalk.red('✗') : chalk.yellow('!');
    console.log(
      `    ${mark} ${p.from} → ${p.to} — ${p.imports} import${p.imports === 1 ? '' : 's'} (risk: ${p.risk}${p.circular ? ', circular' : ''})`
    );
    for (const e of p.examples) console.log(chalk.dim(`        ${e.from} → ${e.to}`));
  }

  console.log(chalk.bold('\n  Shared surface (keep in shell / shared modules):'));
  if (plan.shared.dirs.length) {
    console.log(
      `    dirs: ${plan.shared.dirs.map(d => `${d.name} (${d.files} files)`).join(', ')}`
    );
  } else {
    console.log(chalk.dim('    No shared directories detected.'));
  }
  for (const c of plan.shared.contexts) {
    const scope =
      c.usedBy.length >= 2
        ? `used by ${c.usedBy.join(', ')}`
        : c.usedBy.length === 1
          ? `used by ${c.usedBy[0]} only`
          : 'no cross-file usage detected';
    console.log(`    state: ${c.names.join(', ')} (${c.file}) — ${scope}`);
  }
  if (plan.shared.stateLibs.length) {
    console.log(`    state libs: ${plan.shared.stateLibs.join(', ')}`);
  }

  console.log(chalk.bold('\n  Recommendations:'));
  console.log(`    remotes: ${plan.remotes.map(r => r.name).join(', ') || '—'}`);
  console.log('    shell keeps: app shell, router, auth, design system');
  console.log(
    `    shared via federation: ${plan.sharedDeps.join(', ') || 'react, react-dom (add as needed)'}`
  );

  if (plan.risks.length) {
    console.log(chalk.bold('\n  Risks:'));
    for (const r of plan.risks) console.log(chalk.yellow(`    ! ${r}`));
  }
  if (plan.warnings.length) {
    console.log(chalk.bold('\n  Warnings:'));
    for (const w of plan.warnings) console.log(chalk.dim(`    · ${w}`));
  }

  console.log(chalk.dim('\n  Next steps:'));
  console.log(chalk.dim('    rvo split --json --output split-plan.json   # review & edit the plan'));
  console.log(
    chalk.dim('    rvo split convert --plan split-plan.json --out ./microfrontends   # license required')
  );
  console.log('');
}

const esc = s =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function buildSplitHtmlReport(plan) {
  const vClass =
    plan.verdict === 'recommended'
      ? 'ok'
      : plan.verdict === 'worth-considering'
        ? 'warn'
        : 'info';
  const feats = plan.clusters.filter(c => c.kind === 'feature');
  const featRows = feats
    .map(
      c => `<tr><td><b>${esc(c.name)}</b></td><td>${c.fileCount}</td><td>${c.loc.toLocaleString()}</td>` +
        `<td>${c.routes.map(esc).join('<br>') || '<span class="dim">—</span>'}</td></tr>`
    )
    .join('');
  const pairRows = plan.coupling.pairs.length
    ? plan.coupling.pairs
        .map(
          p => `<tr><td>${esc(p.from)} → ${esc(p.to)}</td><td>${p.imports}</td>` +
            `<td><span class="sev sev-${p.risk === 'high' ? 'error' : 'warning'}">${esc(p.risk)}${p.circular ? ' · circular' : ''}</span></td>` +
            `<td class="dim">${p.examples.map(e => esc(e.from) + ' → ' + esc(e.to)).join('<br>')}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="none">No cross-feature imports — clean boundaries.</td></tr>';
  const sharedRows = plan.shared.dirs.length
    ? plan.shared.dirs.map(d => `<tr><td>${esc(d.name)}/</td><td>${d.files}</td></tr>`).join('')
    : '<tr><td colspan="2" class="none">No shared directories detected.</td></tr>';
  const ctxRows = plan.shared.contexts.length
    ? plan.shared.contexts
        .map(
          c => `<tr><td>${c.names.map(esc).join(', ')}</td><td class="dim">${esc(c.file)}</td>` +
            `<td>${c.usedBy.map(esc).join(', ') || '<span class="dim">—</span>'}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="none">No createContext usage detected.</td></tr>';
  const remoteRows = plan.remotes.length
    ? plan.remotes
        .map(
          r => `<tr><td><b>${esc(r.name)}</b></td><td class="dim">${esc(r.entry)}</td>` +
            `<td>${r.fileCount} files</td><td>${r.routes.map(esc).join('<br>') || '<span class="dim">—</span>'}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="none">No remotes recommended.</td></tr>';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>rvo split — ${esc(plan.verdict)} — ${esc(path.basename(plan.root))}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;background:#0b0e14;color:#e6e9f0}
h1{font-size:1.5rem} h2{font-size:1.15rem;margin-top:2.2rem;color:#e6e9f0}
.meta{color:#9aa3b2} .badge{display:inline-block;padding:.2rem .7rem;border-radius:999px;font-size:.8rem;font-weight:700}
.ok{background:#12351f;color:#3fb950}.warn{background:#3a2c10;color:#d29922}.info{background:#12283a;color:#61dafb}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #1d2536;vertical-align:top}
th{color:#9aa3b2;font-weight:600} .dim{color:#9aa3b2;font-size:.85rem} .none{color:#6b7688;font-style:italic}
.sev{border-radius:4px;padding:.1rem .45rem;font-size:.75rem;font-weight:600}
.sev-error{background:#3d1518;color:#f85149}.sev-warning{background:#3a2c10;color:#d29922}
.cards{display:flex;gap:.75rem;margin:1rem 0;flex-wrap:wrap}
.card{border:1px solid #1d2536;background:#11151f;border-radius:8px;padding:.75rem 1rem;min-width:110px}
.card b{font-size:1.4rem;display:block}
ul.reasons{color:#c7cdd8} ul.reasons li{margin:.3rem 0}
.risk{background:#1a1410;border:1px solid #3a2c10;border-radius:8px;padding:.6rem .9rem;margin:.4rem 0;font-size:.9rem}
code{background:#161c2a;padding:.1rem .35rem;border-radius:4px;font-size:.85rem}
footer{margin-top:2.5rem;color:#6b7688;font-size:.8rem}
</style></head><body>
<h1>rvo split — microfrontend analysis</h1>
<p class="meta">${esc(plan.root)}<br>Generated ${esc(plan.generatedAt)}</p>
<p><span class="badge ${vClass}">${esc(plan.verdict.toUpperCase())}</span></p>
<ul class="reasons">${plan.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
<div class="cards">
<div class="card"><b>${plan.stats.files}</b>files</div>
<div class="card"><b>${plan.stats.features}</b>feature areas</div>
<div class="card"><b>${plan.stats.routes}</b>routes</div>
<div class="card"><b>${plan.coupling.cross}</b>cross-feature imports</div>
<div class="card"><b>${plan.shared.files}</b>shared files</div>
</div>
<h2>Feature candidates</h2>
<table><tr><th>Feature</th><th>Files</th><th>LOC</th><th>Routes</th></tr>${featRows}</table>
<h2>Coupling — cross-feature imports</h2>
<table><tr><th>Pair</th><th>Imports</th><th>Risk</th><th>Examples</th></tr>${pairRows}</table>
<h2>Shared surface</h2>
<table><tr><th>Directory</th><th>Files</th></tr>${sharedRows}</table>
<table><tr><th>Context</th><th>Defined in</th><th>Used by features</th></tr>${ctxRows}</table>
${plan.shared.stateLibs.length ? `<p class="meta">State libraries: ${plan.shared.stateLibs.map(esc).join(', ')}</p>` : ''}
<h2>Recommended remotes</h2>
<table><tr><th>Remote</th><th>Entry</th><th>Size</th><th>Routes</th></tr>${remoteRows}</table>
<p class="meta">Shell keeps: app shell, router, auth, design system.<br>
Suggested federation shared deps: <code>${plan.sharedDeps.map(esc).join(', ') || 'react, react-dom'}</code></p>
${plan.risks.length ? `<h2>Risks</h2>${plan.risks.map(r => `<div class="risk">⚠ ${esc(r)}</div>`).join('')}` : ''}
${plan.warnings.length ? `<h2>Warnings</h2><ul class="reasons">${plan.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
<footer>Generated by react-vite-optimizer — rvo split</footer>
</body></html>`;
}

module.exports = {
  analyzeSplit,
  printSplit,
  buildSplitHtmlReport,
  clusterOf,
  groupKey,
  SHARED_DIRS,
  FEATURE_CONTAINER_DIRS,
};
