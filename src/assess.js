// rvo assess — cross-framework migration readiness analyzer (free tier).
// Detects: inventory, library equivalence, blockers, complexity scores,
// module migration order, and an overall feasibility verdict.
const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const chalk = require('chalk');
const { parse, readJson, loadConfig } = require('./utils');
const { buildProject, resolveImport } = require('./analyzer');

const LIB_KB = require('./assess-libs.json');

const KNOWN_HOOKS = new Set([
  'useState',
  'useEffect',
  'useContext',
  'useReducer',
  'useRef',
  'useMemo',
  'useCallback',
]);

// Higher-order component factories worth flagging: they rarely survive a
// framework move untouched.
const HOC_NAMES = new Set([
  'connect',
  'withRouter',
  'withStyles',
  'withTheme',
  'inject',
  'observer',
  'withTranslation',
  'withApollo',
  'graphql',
  'withFormik',
]);

const STATE_LIBS = new Set([
  'redux',
  'react-redux',
  '@reduxjs/toolkit',
  'zustand',
  'jotai',
  'recoil',
  'mobx',
  'mobx-react',
  'valtio',
  'xstate',
  '@xstate/react',
]);

// Exact match first, then scope-root fallback (e.g. @nivo/bar -> @nivo).
function lookupLib(name, target) {
  const entry =
    LIB_KB[name] ||
    (name.startsWith('@') ? LIB_KB[name.split('/')[0]] : null);
  if (!entry) return { status: 'unknown' };
  return entry[target] || { status: 'unknown' };
}

function isComponentSuperclass(superClass) {
  if (!superClass) return false;
  if (t.isIdentifier(superClass))
    return ['Component', 'PureComponent'].includes(superClass.name);
  if (
    t.isMemberExpression(superClass) &&
    t.isIdentifier(superClass.object, { name: 'React' }) &&
    t.isIdentifier(superClass.property)
  )
    return ['Component', 'PureComponent'].includes(superClass.property.name);
  return false;
}

// Deep per-file signals the shared analyzer doesn't collect: class
// components, HOCs, render props, context providers/consumers, refs,
// dangerouslySetInnerHTML, route count, react-native imports.
function scanFileDeep(file) {
  const s = {
    classComponents: [], // names
    hocs: 0,
    renderProps: 0,
    providers: 0,
    consumers: 0,
    createContext: 0,
    refs: 0,
    dangerousHTML: [], // { line }
    routes: 0,
    usesReactNative: false,
    classNames: [], // className string literals (tailwind heuristic)
  };
  let code;
  try {
    code = fs.readFileSync(file, 'utf8');
  } catch {
    return s;
  }
  let ast;
  try {
    ast = parse(code, file);
  } catch {
    return s;
  }
  const checkClass = (p, name) => {
    if (isComponentSuperclass(p.node.superClass) && name)
      s.classComponents.push(name);
  };
  traverse(ast, {
    ImportDeclaration(p) {
      const src = p.node.source.value;
      if (src === 'react-native' || src.startsWith('react-native/'))
        s.usesReactNative = true;
    },
    ClassDeclaration(p) {
      checkClass(p, p.node.id && p.node.id.name);
    },
    ClassExpression(p) {
      checkClass(p, p.node.id && p.node.id.name);
    },
    CallExpression(p) {
      const cal = p.node.callee;
      const name = t.isIdentifier(cal) ? cal.name : null;
      if (!name) return;
      if (name === 'createContext') s.createContext++;
      if (name === 'createRef') s.refs++;
      if (
        HOC_NAMES.has(name) &&
        p.node.arguments.some(
          a => t.isIdentifier(a) && /^[A-Z]/.test(a.name)
        )
      )
        s.hocs++;
    },
    JSXAttribute(p) {
      const id = p.node.name;
      if (!t.isJSXIdentifier(id)) return;
      const attr = id.name;
      if (attr === 'dangerouslySetInnerHTML') {
        s.dangerousHTML.push({ line: p.node.loc.start.line });
        return;
      }
      if (attr === 'className' && t.isStringLiteral(p.node.value))
        s.classNames.push(p.node.value.value);
      if (
        attr === 'render' ||
        attr === 'children' ||
        /^render[A-Z]/.test(attr)
      ) {
        const v = p.node.value;
        if (
          v &&
          t.isJSXExpressionContainer(v) &&
          (t.isArrowFunctionExpression(v.expression) ||
            t.isFunctionExpression(v.expression))
        )
          s.renderProps++;
      }
    },
    JSXOpeningElement(p) {
      const n = p.node.name;
      if (t.isJSXMemberExpression(n) && t.isJSXIdentifier(n.property)) {
        if (n.property.name === 'Provider') s.providers++;
        if (n.property.name === 'Consumer') s.consumers++;
      }
      if (t.isJSXIdentifier(n) && n.name === 'Route') s.routes++;
    },
  });
  return s;
}

const TAILWIND_TOKEN =
  /^(flex|grid|block|inline|hidden|px-|py-|p-|mx-|my-|mt-|mb-|ml-|mr-|text-|bg-|border|rounded|shadow|w-|h-|min-|max-|gap-|space-|items-|justify-|font-|tracking-|leading-|uppercase|lowercase|capitalize|opacity-|z-|absolute|relative|fixed|sticky|overflow-|cursor-|select-|transition|duration-|ease-|scale-|rotate-|translate-)/;

function detectStyling(root, deps, project, deepByFile) {
  const found = new Set();
  const importsStyle = (ext, exclude) => {
    for (const [, info] of project.files)
      for (const imp of info.imports)
        if (imp.source.endsWith(ext) && !(exclude && imp.source.endsWith(exclude)))
          return true;
    return false;
  };
  const libImported = name => {
    for (const [, info] of project.files)
      for (const imp of info.imports) {
        const src = imp.source;
        const lib = src.startsWith('@')
          ? src.split('/').slice(0, 2).join('/')
          : src.split('/')[0];
        if (lib === name) return true;
      }
    return false;
  };
  if (libImported('styled-components')) found.add('styled-components');
  if (libImported('@emotion/react') || libImported('@emotion/styled'))
    found.add('emotion');
  if (
    deps.tailwindcss ||
    fg.sync('tailwind.config.*', { cwd: root, onlyFiles: true }).length
  ) {
    found.add('tailwind');
  } else {
    // Heuristic: many className strings full of utility tokens.
    let hits = 0;
    for (const d of deepByFile.values())
      for (const c of d.classNames)
        if (c.split(/\s+/).filter(tok => TAILWIND_TOKEN.test(tok)).length >= 2)
          hits++;
    if (hits >= 5) found.add('tailwind (likely)');
  }
  if (importsStyle('.module.css')) found.add('CSS modules');
  if (importsStyle('.css', '.module.css')) found.add('plain CSS');
  if (importsStyle('.scss') || importsStyle('.sass')) found.add('Sass');
  if (!found.size) found.add('inline styles / unknown');
  return [...found];
}

function detectTests(root, deps) {
  const unit = fg
    .sync(['**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}'], {
      cwd: root,
      onlyFiles: true,
      ignore: ['**/node_modules/**'],
    })
    .filter(f => !/node_modules/.test(f));
  const frameworks = new Set();
  if (deps.jest) frameworks.add('jest');
  if (deps.vitest) frameworks.add('vitest');
  if (deps['@testing-library/react']) frameworks.add('testing-library');
  const e2e = [];
  if (
    deps.cypress ||
    fg.sync('cypress.config.*', { cwd: root, onlyFiles: true }).length
  )
    e2e.push('cypress');
  if (
    deps['@playwright/test'] ||
    deps.playwright ||
    fg.sync('playwright.config.*', { cwd: root, onlyFiles: true }).length
  )
    e2e.push('playwright');
  return { unit: unit.length, unitFiles: unit, frameworks: [...frameworks], e2e };
}

// Complexity score per file. Tuned so a typical 60-line, 3-hook component
// lands ~12 (yellow) and a 200-line, 4-hook file lands ~28 (red).
function fileScore(info, deep) {
  const hookCount = info.components.reduce(
    (n, c) => n + (c.hooks ? c.hooks.length : 0),
    0
  );
  return (
    info.lineCount * 0.1 +
    hookCount * 2 +
    deep.classComponents.length * 4 +
    deep.hocs * 3 +
    deep.renderProps * 3 +
    deep.consumers * 2 +
    deep.refs * 1.5 +
    deep.dangerousHTML.length * 5
  );
}

function moduleTier(score) {
  if (score >= 20) return 'red';
  if (score >= 10) return 'yellow';
  return 'green';
}

function assessProject(root, { from = 'react', to }) {
  if (from !== 'react')
    throw new Error(
      `rvo assess currently supports --from react only (got "${from}").`
    );
  if (!to || !['angular', 'vue'].includes(to))
    throw new Error(
      'rvo assess needs --to <angular|vue>. Example: rvo assess ./my-app --to vue'
    );

  let pkg = {};
  try {
    pkg = readJson(path.join(root, 'package.json'));
  } catch {
    /* treat as dependency-less */
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const config = loadConfig(root);
  const project = buildProject(root, config);
  const srcDir = path.join(root, config.srcDir);

  // ---- per-file data ----
  const files = [];
  const deepByFile = new Map();
  for (const [file, info] of project.files) {
    const deep = scanFileDeep(file);
    deepByFile.set(file, deep);
    files.push({ file, rel: path.relative(root, file), info, deep });
  }

  // ---- inventory ----
  let functionComponents = 0;
  let classComponents = 0;
  let loc = 0;
  let tsFiles = 0;
  let jsFiles = 0;
  const hookCounts = {};
  const customHooks = new Set();
  let providers = 0;
  let consumers = 0;
  let createContext = 0;
  let routes = 0;
  let usesRouter = false;
  let usesReactNative = false;
  const dangerousFiles = [];
  for (const f of files) {
    loc += f.info.lineCount;
    if (/\.tsx?$/.test(f.file)) tsFiles++;
    else jsFiles++;
    functionComponents += f.info.components.length;
    classComponents += f.deep.classComponents.length;
    for (const c of f.info.components)
      for (const h of c.hooks || []) {
        hookCounts[h] = (hookCounts[h] || 0) + 1;
        if (!KNOWN_HOOKS.has(h)) customHooks.add(h);
      }
    // useRef inside class-less helpers is still caught via hooks above;
    // createRef counted in deep scan.
    providers += f.deep.providers;
    consumers += f.deep.consumers;
    createContext += f.deep.createContext;
    routes += f.deep.routes;
    if (f.info.usesRouter) usesRouter = true;
    if (f.deep.usesReactNative) usesReactNative = true;
    for (const d of f.deep.dangerousHTML)
      dangerousFiles.push({ file: f.rel, line: d.line });
  }

  // ---- library usage + equivalence ----
  const libUse = new Map(); // lib -> Set<rel>
  const libNameOf = src =>
    src.startsWith('@')
      ? src.split('/').slice(0, 2).join('/')
      : src.split('/')[0];
  for (const f of files)
    for (const imp of f.info.imports) {
      const src = imp.source;
      if (src.startsWith('.') || src.startsWith('/')) continue;
      const lib = libNameOf(src);
      if (!libUse.has(lib)) libUse.set(lib, new Set());
      libUse.get(lib).add(f.rel);
    }
  const libraries = [...libUse.entries()]
    .map(([name, rels]) => {
      const kb = lookupLib(name, to);
      return {
        name,
        status: kb.status,
        with: kb.with || null,
        note: kb.note || null,
        suggestion: kb.suggestion || null,
        files: rels.size,
        fileList: [...rels].sort(),
      };
    })
    .sort((a, b) => {
      const rank = { blocked: 0, replace: 1, binding: 2, unknown: 3, native: 4 };
      return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name);
    });
  const nativeLibs = libraries.filter(l => l.status === 'native');
  const nonNativeLibs = libraries.filter(l => l.status !== 'native');
  const stateLibs = [...new Set(libraries.map(l => l.name))].filter(n =>
    STATE_LIBS.has(n)
  );

  // ---- blockers (RED) ----
  const blockers = [];
  for (const l of libraries) {
    if (l.status !== 'blocked') continue;
    blockers.push({
      type: 'library',
      library: l.name,
      files: l.fileList,
      why: l.note || 'No equivalent exists for the target framework.',
      suggestion: l.suggestion || 'Find or build a target-framework alternative first.',
    });
  }
  if (usesReactNative) {
    const rnFiles = files
      .filter(f => f.deep.usesReactNative)
      .map(f => f.rel);
    blockers.push({
      type: 'react-native',
      library: 'react-native',
      files: rnFiles,
      why: 'React Native is a mobile framework; it cannot move to a web target.',
      suggestion:
        'Rewrite as a responsive web app first, or target Ionic/Capacitor separately.',
    });
  }
  if (dangerousFiles.length) {
    blockers.push({
      type: 'dangerouslySetInnerHTML',
      library: null,
      files: dangerousFiles.map(d => `${d.file}:${d.line}`),
      why: `${dangerousFiles.length} use(s) of dangerouslySetInnerHTML — raw HTML injection rarely ports cleanly and needs sanitization review.`,
      suggestion:
        'Audit each usage; prefer framework-safe rendering or a sanitizer on the target.',
    });
  }
  if (fs.existsSync(path.join(root, 'webpack.config.js'))) {
    blockers.push({
      type: 'webpack',
      library: null,
      files: ['webpack.config.js'],
      why: 'Custom webpack config will not transfer — the target uses its own build pipeline.',
      suggestion:
        'Inventory custom loaders/plugins now; plan equivalents in the target toolchain.',
    });
  }

  // ---- complexity + modules ----
  const ORDER = { red: 0, yellow: 1, green: 2 };
  const modules = new Map(); // name -> { files: [], score, internalDeps }
  for (const f of files) {
    const relFromSrc = path.relative(srcDir, f.file);
    const first = relFromSrc.split(path.sep)[0];
    const modName =
      !first || first === relFromSrc ? '(root)' : first;
    if (!modules.has(modName))
      modules.set(modName, { name: modName, files: [], internalDeps: 0 });
    const m = modules.get(modName);
    const score = fileScore(f.info, f.deep);
    m.files.push({ file: f.rel, score: Math.round(score * 10) / 10 });
    let internal = 0;
    for (const imp of f.info.imports)
      if (resolveImport(f.file, imp.source)) internal++;
    m.internalDeps += internal;
  }
  const moduleList = [...modules.values()]
    .map(m => {
      const total = m.files.reduce((n, x) => n + x.score, 0);
      const avgScore = m.files.length
        ? Math.round((total / m.files.length) * 10) / 10
        : 0;
      return {
        name: m.name,
        files: m.files.length,
        fileList: m.files.map(x => x.file),
        score: avgScore,
        tier: moduleTier(avgScore),
        avgInternalDeps:
          Math.round((m.internalDeps / Math.max(m.files.length, 1)) * 10) / 10,
      };
    })
    .sort(
      (a, b) => ORDER[a.tier] - ORDER[b.tier] || b.score - a.score
    );
  const migrationOrder = [...moduleList]
    .sort((a, b) => a.avgInternalDeps - b.avgInternalDeps)
    .map(m => m.name);

  // ---- verdict ----
  const redCount = moduleList.filter(m => m.tier === 'red').length;
  const yellowCount = moduleList.filter(m => m.tier === 'yellow').length;
  const replaceCount = libraries.filter(l => l.status === 'replace').length;
  const reasons = [];
  if (blockers.length)
    reasons.push({
      weight: 100,
      text: `${blockers.length} blocker(s): ${blockers
        .map(b => b.library || b.type)
        .slice(0, 3)
        .join(', ')}${blockers.length > 3 ? '…' : ''}`,
    });
  if (redCount)
    reasons.push({
      weight: 60,
      text: `${redCount} of ${moduleList.length} module(s) are high complexity (red)`,
    });
  if (classComponents)
    reasons.push({
      weight: 40,
      text: `${classComponents} class component(s) — idiom differs on the target; plan rewrites`,
    });
  if (replaceCount)
    reasons.push({
      weight: 30,
      text: `${replaceCount} librar${replaceCount === 1 ? 'y needs' : 'ies need'} replacing with a target-framework alternative`,
    });
  if (customHooks.size)
    reasons.push({
      weight: 20,
      text: `${customHooks.size} custom hook(s) (${[...customHooks]
        .slice(0, 4)
        .join(', ')}) — portable logic, but each needs a target idiom`,
    });
  if (yellowCount && !redCount)
    reasons.push({
      weight: 15,
      text: `${yellowCount} module(s) are medium complexity (yellow)`,
    });
  let verdict = 'feasible';
  if (blockers.length) verdict = 'high-risk';
  else if (
    redCount > 0 ||
    yellowCount >= 3 ||
    replaceCount >= 6 ||
    classComponents > 0
  )
    verdict = 'feasible-with-caveats';
  if (!reasons.length)
    reasons.push({
      weight: 0,
      text: 'No blockers, low complexity, and all libraries map cleanly.',
    });
  reasons.sort((a, b) => b.weight - a.weight);
  const topReasons = reasons.slice(0, 3).map(r => r.text);

  const styling = detectStyling(root, deps, project, deepByFile);
  const tests = detectTests(root, deps);
  const routerLib =
    libraries.find(l => l.name === 'react-router-dom') ||
    libraries.find(l => l.name === 'react-router') ||
    libraries.find(l => l.name === 'wouter');

  return {
    tool: 'rvo assess',
    from,
    to,
    root,
    scannedFiles: files.length,
    verdict,
    topReasons,
    inventory: {
      components: {
        total: functionComponents + classComponents,
        function: functionComponents,
        class: classComponents,
      },
      loc,
      files: files.length,
      typescript: tsFiles > 0,
      tsFiles,
      jsFiles,
      hooks: hookCounts,
      customHooks: [...customHooks].sort(),
      context: { providers, consumers, createContext },
      stateLibs,
      router: {
        present: usesRouter,
        library: routerLib ? routerLib.name : null,
        routes,
      },
      styling,
      tests,
    },
    blockers,
    libraries,
    modules: moduleList,
    migrationOrder,
  };
}

// ------------------------------------------------------------------ output

function verdictColor(v) {
  if (v === 'high-risk') return chalk.red.bold;
  if (v === 'feasible-with-caveats') return chalk.yellow.bold;
  return chalk.green.bold;
}

function statusColor(s) {
  if (s === 'blocked') return chalk.red;
  if (s === 'replace') return chalk.yellow;
  if (s === 'binding') return chalk.cyan;
  if (s === 'native') return chalk.green;
  return chalk.dim;
}

function tierColor(t) {
  if (t === 'red') return chalk.red;
  if (t === 'yellow') return chalk.yellow;
  return chalk.green;
}

function printAssess(a) {
  const vc = verdictColor(a.verdict);
  console.log(chalk.bold.cyan('\nrvo assess') + chalk.dim(` — ${a.from} → ${a.to}`));
  console.log(chalk.dim('  ' + a.root));
  console.log(`\n  Verdict: ${vc(a.verdict.toUpperCase().replace(/-/g, ' '))}`);
  for (const r of a.topReasons) console.log(chalk.dim(`    • ${r}`));

  const inv = a.inventory;
  console.log(chalk.bold('\nInventory'));
  console.log(
    `  ${inv.components.total} components (${inv.components.function} function, ${inv.components.class} class) · ${inv.loc} LOC · ${inv.files} files`
  );
  console.log(
    `  TypeScript: ${inv.typescript ? chalk.green('yes') : chalk.dim('no')} (${inv.tsFiles} ts / ${inv.jsFiles} js)`
  );
  const hookBits = Object.entries(inv.hooks)
    .sort((x, y) => y[1] - x[1])
    .map(([h, n]) => `${h} ×${n}`);
  console.log(
    `  Hooks: ${hookBits.length ? hookBits.join(', ') : chalk.dim('none')}`
  );
  if (inv.customHooks.length)
    console.log(chalk.dim(`    custom: ${inv.customHooks.join(', ')}`));
  console.log(
    `  Context: ${inv.context.providers} provider(s), ${inv.context.consumers} consumer(s)` +
      (inv.stateLibs.length ? ` · State: ${inv.stateLibs.join(', ')}` : '')
  );
  console.log(
    `  Router: ${
      inv.router.present
        ? `${inv.router.library || 'react-router'} (${inv.router.routes} route(s))`
        : chalk.dim('none')
    }`
  );
  console.log(`  Styling: ${inv.styling.join(', ')}`);
  console.log(
    `  Tests: ${inv.tests.unit} unit file(s)${
      inv.tests.frameworks.length ? ` (${inv.tests.frameworks.join(', ')})` : ''
    } · e2e: ${inv.tests.e2e.length ? inv.tests.e2e.join(', ') : chalk.dim('none')}`
  );

  console.log(chalk.bold(`\nBlockers (${a.blockers.length})`));
  if (!a.blockers.length) {
    console.log(chalk.green('  ✓ none — nothing fundamentally unportable detected.'));
  }
  for (const b of a.blockers) {
    console.log(
      `  ${chalk.red('✗')} ${chalk.bold(b.library || b.type)} — ${b.why}`
    );
    for (const f of b.files.slice(0, 5))
      console.log(chalk.dim(`      ${f}`));
    if (b.files.length > 5)
      console.log(chalk.dim(`      …and ${b.files.length - 5} more`));
    console.log(chalk.dim(`      → ${b.suggestion}`));
  }

  const nonNative = a.libraries.filter(l => l.status !== 'native');
  const native = a.libraries.filter(l => l.status === 'native');
  console.log(chalk.bold(`\nLibraries (${a.libraries.length})`));
  for (const l of nonNative) {
    const equiv = l.with ? ` → ${l.with}` : '';
    console.log(
      `  ${statusColor(l.status)(l.status.padEnd(7))} ${l.name}${equiv} ${chalk.dim(`(${l.files} file${l.files === 1 ? '' : 's'})`)}`
    );
  }
  if (native.length)
    console.log(
      chalk.dim(
        `  ${native.length} framework-agnostic (move as-is): ${native
          .map(l => l.name)
          .join(', ')}`
      )
    );

  console.log(chalk.bold('\nModule complexity'));
  for (const m of a.modules) {
    console.log(
      `  ${tierColor(m.tier)('●')} ${m.name.padEnd(18)} ${tierColor(m.tier)(
        m.tier.padEnd(6)
      )} score ${String(m.score).padEnd(5)} ${chalk.dim(`(${m.files} files)`)}`
    );
  }

  console.log(chalk.bold('\nSuggested migration order (leaf modules first)'));
  a.migrationOrder.forEach((m, i) =>
    console.log(chalk.dim(`  ${i + 1}. ${m}`))
  );
  console.log(
    chalk.dim(
      '\n  rvo assess is free. `rvo migrate` (commercial) executes the plan: detect → plan → transform → verify.'
    )
  );
}

const esc = s =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function buildAssessHtmlReport(a) {
  const vc =
    a.verdict === 'high-risk'
      ? 'verdict-bad'
      : a.verdict === 'feasible-with-caveats'
      ? 'verdict-warn'
      : 'verdict-ok';
  const badge = s => {
    const c =
      s === 'blocked'
        ? 'st-blocked'
        : s === 'replace'
        ? 'st-replace'
        : s === 'binding'
        ? 'st-binding'
        : s === 'native'
        ? 'st-native'
        : 'st-unknown';
    return `<span class="st ${c}">${esc(s)}</span>`;
  };
  const tbadge = t =>
    `<span class="st ${t === 'red' ? 'st-blocked' : t === 'yellow' ? 'st-replace' : 'st-native'}">${esc(t)}</span>`;
  const inv = a.inventory;
  const hookRows = Object.entries(inv.hooks)
    .sort((x, y) => y[1] - x[1])
    .map(([h, n]) => `<tr><td>${esc(h)}</td><td>${n}</td></tr>`)
    .join('');
  const blockerRows = a.blockers.length
    ? a.blockers
        .map(
          b => `<tr><td><b>${esc(b.library || b.type)}</b></td><td>${esc(
            b.why
          )}<br><span class="dim">${b.files
            .slice(0, 6)
            .map(esc)
            .join('<br>')}${
            b.files.length > 6 ? `<br>…and ${b.files.length - 6} more` : ''
          }</span></td><td>${esc(b.suggestion)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="dim">None — nothing fundamentally unportable detected.</td></tr>';
  const libRows = a.libraries
    .map(
      l => `<tr><td>${esc(l.name)}</td><td>${badge(l.status)}</td><td>${
        l.with ? esc(l.with) : '<span class="dim">—</span>'
      }</td><td>${l.files}</td></tr>`
    )
    .join('');
  const modRows = a.modules
    .map(
      m => `<tr><td>${esc(m.name)}</td><td>${tbadge(m.tier)}</td><td>${m.score}</td><td>${m.files}</td></tr>`
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>rvo assess — ${esc(path.basename(a.root))} (${esc(a.from)} → ${esc(a.to)})</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0b0e14;color:#e6e9f0;max-width:1000px;margin:2rem auto;padding:0 1rem;line-height:1.6}
h1{font-size:1.5rem} h2{font-size:1.15rem;margin-top:2rem;color:#9aa3b2;text-transform:uppercase;letter-spacing:.06em;font-size:.85rem}
a{color:#61dafb}.dim{color:#9aa3b2;font-size:.85rem}
.verdict{display:inline-block;padding:.5rem 1.2rem;border-radius:10px;font-weight:800;font-size:1.1rem;letter-spacing:.04em}
.verdict-ok{background:#0e2a1a;color:#3fb950;border:1px solid #1d4d2e}
.verdict-warn{background:#2a2110;color:#d29922;border:1px solid #6b5416}
.verdict-bad{background:#2a1215;color:#f85149;border:1px solid #6b1f26}
.cards{display:flex;gap:.75rem;margin:1rem 0;flex-wrap:wrap}
.card{background:#11151f;border:1px solid #1d2536;border-radius:12px;padding:.75rem 1rem;min-width:120px}
.card b{font-size:1.4rem;display:block}.card span{color:#9aa3b2;font-size:.8rem}
table{width:100%;border-collapse:collapse;font-size:.9rem;background:#11151f;border:1px solid #1d2536;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:.55rem .8rem;border-bottom:1px solid #1d2536;vertical-align:top}
th{background:#161c2a;color:#9aa3b2;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}
.st{border-radius:4px;padding:.12rem .5rem;font-size:.75rem;font-weight:700}
.st-blocked{background:#2a1215;color:#f85149}.st-replace{background:#2a2110;color:#d29922}
.st-binding{background:#0e2233;color:#61dafb}.st-native{background:#0e2a1a;color:#3fb950}
.st-unknown{background:#1d2536;color:#9aa3b2}
ol.steps{background:#11151f;border:1px solid #1d2536;border-radius:12px;padding:1rem 1rem 1rem 2.5rem}
ol.steps li{margin:.3rem 0}
ul.reasons{list-style:none;padding:0}ul.reasons li{margin:.25rem 0}
ul.reasons li::before{content:"• ";color:#61dafb}
footer{margin-top:2.5rem;color:#6b7688;font-size:.8rem}
</style></head><body>
<h1>rvo assess — migration readiness</h1>
<p class="dim">${esc(a.root)}<br>${esc(a.from)} → ${esc(a.to)} · ${a.scannedFiles} source file(s) scanned</p>
<h2>Verdict</h2>
<p><span class="verdict ${vc}">${esc(a.verdict.toUpperCase().replace(/-/g, ' '))}</span></p>
<ul class="reasons">${a.topReasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
<h2>Inventory</h2>
<div class="cards">
<div class="card"><b>${inv.components.total}</b><span>components (${inv.components.function} fn / ${inv.components.class} class)</span></div>
<div class="card"><b>${inv.loc}</b><span>lines of code</span></div>
<div class="card"><b>${inv.typescript ? 'TS' : 'JS'}</b><span>${inv.tsFiles} ts / ${inv.jsFiles} js files</span></div>
<div class="card"><b>${inv.router.routes}</b><span>routes${inv.router.library ? ' (' + esc(inv.router.library) + ')' : ''}</span></div>
<div class="card"><b>${inv.tests.unit}</b><span>unit test files</span></div>
</div>
<p class="dim">Styling: ${esc(inv.styling.join(', '))} · Context: ${inv.context.providers} provider(s), ${inv.context.consumers} consumer(s)${
    inv.stateLibs.length ? ` · State: ${esc(inv.stateLibs.join(', '))}` : ''
  }</p>
${hookRows ? `<h2>Hooks</h2><table><thead><tr><th>Hook</th><th>Uses</th></tr></thead><tbody>${hookRows}</tbody></table>` : ''}
<h2>Blockers (${a.blockers.length})</h2>
<table><thead><tr><th>Blocker</th><th>Why</th><th>Suggested path</th></tr></thead><tbody>${blockerRows}</tbody></table>
<h2>Library equivalence (${a.libraries.length})</h2>
<table><thead><tr><th>Library</th><th>Status (${esc(a.to)})</th><th>Target equivalent</th><th>Files</th></tr></thead><tbody>${libRows}</tbody></table>
<h2>Module complexity</h2>
<table><thead><tr><th>Module</th><th>Tier</th><th>Score</th><th>Files</th></tr></thead><tbody>${modRows}</tbody></table>
<h2>Suggested migration order</h2>
<ol class="steps">${a.migrationOrder.map(m => `<li>${esc(m)}</li>`).join('')}</ol>
<footer>Generated by rvo assess (free tier) — react-vite-optimizer</footer>
</body></html>`;
}

module.exports = {
  assessProject,
  printAssess,
  buildAssessHtmlReport,
  lookupLib,
  scanFileDeep,
};
