// rvo plan — cross-framework migration architecture blueprint (premium tier).
//
// Consumes `rvo assess` output (never re-derives the analysis) and produces:
//   1. target architecture decisions with rationale
//   2. per-module plans in assess's leaf-first migration order (effort S/M/L)
//   3. a scaffold checklist (files to create, not generated files)
//   4. a risk register carrying assess blockers forward with owner actions
const path = require('path');
const chalk = require('chalk');
const { assessProject, scanFileDeep } = require('./assess');

function buildPlan(root, { from = 'react', to } = {}) {
  const a = assessProject(root, { from, to }); // validates from/to
  return {
    tool: 'rvo plan',
    from: a.from,
    to: a.to,
    root: a.root,
    verdict: a.verdict,
    assessReasons: a.topReasons,
    decisions: buildDecisions(a),
    modules: buildModulePlans(a),
    migrationOrder: a.migrationOrder,
    scaffold: buildScaffold(a),
    risks: buildRisks(a),
  };
}

// ------------------------------------------------------------- decisions

function buildDecisions(a) {
  const inv = a.inventory;
  const to = a.to;
  const out = [];
  const isVue = to === 'vue';

  // Language
  out.push({
    area: 'Language',
    decision: inv.typescript
      ? 'TypeScript throughout'
      : 'JavaScript (TypeScript recommended)',
    rationale: inv.typescript
      ? `The codebase is already TypeScript (${inv.tsFiles} ts files). Both targets are TS-first; keep types and tighten the \`any\`s the converter leaves behind.`
      : 'Both targets work in plain JS, but their ecosystems (Volar/vee-validate, Angular CLI) assume TypeScript. Adopting it during the move pays for itself.',
  });

  // State management
  const libs = inv.stateLibs;
  const hasRedux = libs.some(n => /redux/.test(n));
  const hasAtomic = libs.some(n =>
    ['zustand', 'jotai', 'recoil', 'valtio', 'xstate'].includes(n)
  );
  const hasMobx = libs.some(n => /mobx/.test(n));
  const hasCtx = inv.context.providers > 0 || inv.context.createContext > 0;
  let stateDecision, stateWhy;
  if (hasRedux) {
    stateDecision = isVue ? 'Pinia (migrate off Redux)' : 'NgRx SignalStore, or services + signals';
    stateWhy =
      'Redux Toolkit idioms (slices, thunks, selectors) have no direct port. ' +
      (isVue
        ? 'Pinia is the official, Composition-API-native store — model each slice as a Pinia store.'
        : 'For most apps, injectable services holding signals replace Redux with far less ceremony; reach for NgRx SignalStore only if you need time-travel/devtools.');
  } else if (hasAtomic || hasMobx) {
    stateDecision = isVue ? 'Pinia' : 'Injectable services with signals';
    stateWhy = `${libs.join(', ')} ${
      libs.length === 1 ? 'is' : 'are'
    } React-bound. The equivalent target idiom is ${
      isVue
        ? 'Pinia (atomic, composable stores)'
        : 'a singleton service exposing signals — same mental model, no library'
    }.`;
  } else if (hasCtx) {
    stateDecision = isVue ? 'provide/inject for tree-scoped state' : 'Hierarchical injectable services';
    stateWhy =
      `${inv.context.providers} context provider(s) detected. ` +
      (isVue
        ? 'Map each context to a provide/inject pair (or a tiny Pinia store if the state is truly global).'
        : 'Map each context to an @Injectable service; provide it at the component level to keep the old scoping.');
  } else {
    stateDecision = 'Local component state only';
    stateWhy =
      'No global state library or context detected — component-local state (ref/signal) covers the migration.';
  }
  out.push({ area: 'State management', decision: stateDecision, rationale: stateWhy });

  // Routing
  if (inv.router.present) {
    out.push({
      area: 'Routing',
      decision: isVue ? 'vue-router' : '@angular/router',
      rationale:
        `${inv.router.routes} route(s) on ${inv.router.library || 'react-router'}. ` +
        (isVue
          ? 'Translate the <Routes>/<Route> tree into a routes array; <Link> → <RouterLink>; useNavigate() → useRouter().push(); useParams() → useRoute().params.'
          : 'Translate the route tree into a Routes array (use loadComponent for code-split routes); <Link> → [routerLink]; useNavigate() → Router.navigate(); useParams() → ActivatedRoute params.'),
    });
  } else {
    out.push({
      area: 'Routing',
      decision: 'No router required',
      rationale:
        'No client-side router detected. Add routing on the target only if deep links become a requirement.',
    });
  }

  // Styling
  const styleMap = {
    tailwind: isVue
      ? 'Tailwind works on both — keep the config, update content globs for .vue files'
      : 'Tailwind works on both — keep the config, update content globs for .component.html files',
    'tailwind (likely)': 'Utility classes detected — confirm Tailwind config exists, then keep it on the target',
    'CSS modules': isVue
      ? 'CSS Modules → <style scoped> blocks (or keep CSS Modules — Vue supports them)'
      : 'CSS Modules → component styles array (styleUrls)',
    'styled-components': isVue
      ? 'Replace styled-components with SFC <style scoped> + CSS variables for theming'
      : 'Replace styled-components with component styles + CSS variables for theming',
    emotion: isVue
      ? 'Replace Emotion with SFC <style scoped> + CSS variables for theming'
      : 'Replace Emotion with component styles + CSS variables for theming',
    'plain CSS': 'Plain stylesheets move as-is into the global stylesheet',
    Sass: 'Sass is supported natively by both toolchains — keep the files',
    'inline styles / unknown':
      'Inline style objects → :style bindings (Vue) / [ngStyle] (Angular)',
  };
  const styles = inv.styling
    .map(s => styleMap[s] || `${s} — review manually`)
    .filter(Boolean);
  out.push({
    area: 'Styling',
    decision: `Port per strategy (${inv.styling.join(', ')})`,
    rationale: styles.join('; ') + '.',
  });

  // Data fetching
  const libNames = a.libraries.map(l => l.name);
  const fetchBits = [];
  if (libNames.includes('axios')) fetchBits.push('axios is framework-agnostic — keep it');
  const rq = a.libraries.find(l => l.name === '@tanstack/react-query');
  if (rq)
    fetchBits.push(
      `react-query → ${rq.with || (isVue ? '@tanstack/vue-query' : 'Angular HttpClient + signals')}`
    );
  if (libNames.includes('swr'))
    fetchBits.push(
      isVue ? 'swr → @tanstack/vue-query or plain composables' : 'swr → Angular HttpClient + signals'
    );
  if (fetchBits.length)
    out.push({
      area: 'Data fetching',
      decision: 'Keep agnostic libs, swap React bindings',
      rationale: fetchBits.join('; ') + '.',
    });

  // Testing
  const tf = inv.tests.frameworks;
  out.push({
    area: 'Testing',
    decision: isVue ? 'Vitest + Vue Test Utils' : 'Jest (keep) or Karma/Jasmine + TestBed',
    rationale:
      `${inv.tests.unit} unit test file(s)${tf.length ? ` (${tf.join(', ')})` : ''}. ` +
      (isVue
        ? 'Port React Testing Library tests to Vue Test Utils; Vitest keeps the runner.'
        : 'Keep Jest if present and add Angular TestBed; otherwise the Angular CLI default (Karma/Jasmine) works.') +
      (inv.tests.e2e.length
        ? ` E2E (${inv.tests.e2e.join(', ')}) is framework-agnostic — keep as-is.`
        : ' No E2E suite detected — consider adding one after the move.'),
  });

  // Build & tooling
  out.push({
    area: 'Build & tooling',
    decision: isVue ? 'Vite + @vitejs/plugin-vue' : 'Angular CLI (angular.json)',
    rationale: isVue
      ? 'Stay on Vite if already there; swap @vitejs/plugin-react for @vitejs/plugin-vue. Dev server, HMR and build semantics stay familiar.'
      : 'Angular owns its build pipeline — scaffold with `ng new` and port source into it; do not try to keep a custom webpack/Vite setup.',
  });

  return out;
}

// ----------------------------------------------------------- module plans

function effortOf(tier) {
  return tier === 'red' ? 'L' : tier === 'yellow' ? 'M' : 'S';
}

function buildModulePlans(a) {
  const byName = new Map(a.modules.map(m => [m.name, m]));
  return a.migrationOrder.map(name => {
    const m = byName.get(name);
    const notes = [];
    // Supplementary per-file signals (assess's own scanner — the analysis
    // itself, scores and order, still comes from assessProject above).
    let classNames = [];
    let hocs = 0;
    let renderProps = 0;
    for (const rel of m.fileList || []) {
      const deep = scanFileDeep(path.join(a.root, rel));
      classNames.push(...deep.classComponents);
      hocs += deep.hocs;
      renderProps += deep.renderProps;
    }
    if (classNames.length)
      notes.push(
        `class component(s) ${[...new Set(classNames)].join(', ')} → rewrite as ${
          a.to === 'vue' ? 'Composition API' : 'standalone components'
        }`
      );
    if (hocs)
      notes.push(
        `${hocs} HOC usage(s) → unwrap to ${a.to === 'vue' ? 'composables' : 'services/directives'}`
      );
    if (renderProps)
      notes.push(
        `${renderProps} render-prop usage(s) → ${a.to === 'vue' ? 'slots' : 'content projection (<ng-content>)'}`
      );
    for (const b of a.blockers) {
      if ((b.files || []).some(f => (m.fileList || []).includes(f.split(':')[0])))
        notes.push(`BLOCKED — ${b.library || b.type}: resolve before migrating this module`);
    }
    for (const l of a.libraries) {
      if (
        l.status === 'replace' &&
        (l.fileList || []).some(f => (m.fileList || []).includes(f))
      )
        notes.push(`replace ${l.name} → ${l.with}`);
    }
    return {
      name: m.name,
      files: m.files,
      tier: m.tier,
      score: m.score,
      effort: effortOf(m.tier),
      notes,
      filePlans: buildFilePlans(a, m),
    };
  });
}

// Per-file effort + notes within a module (leaf-first order is the module
// order; files inside a module are listed alphabetically).
function buildFilePlans(a, m) {
  const plans = [];
  for (const rel of [...(m.fileList || [])].sort()) {
    const deep = scanFileDeep(path.join(a.root, rel));
    const notes = [];
    let effort = 'S';
    if (deep.classComponents.length) {
      effort = 'M';
      notes.push(
        `class component → rewrite as ${a.to === 'vue' ? 'Composition API' : 'standalone component'}`
      );
    }
    if (deep.hocs) {
      if (effort === 'S') effort = 'M';
      notes.push(`${deep.hocs} HOC usage(s) → unwrap manually`);
    }
    if (deep.renderProps) {
      if (effort === 'S') effort = 'M';
      notes.push(`${deep.renderProps} render-prop usage(s) → ${a.to === 'vue' ? 'slots' : '<ng-content>'}`);
    }
    const blockedHere = (a.libraries || []).filter(
      l => l.status === 'blocked' && (l.fileList || []).includes(rel)
    );
    for (const b of blockedHere) {
      effort = 'L';
      notes.push(`uses ${b.name} — blocked, resolve before migrating this file`);
    }
    plans.push({ file: rel, effort, notes });
  }
  return plans;
}

// ------------------------------------------------------------ scaffold

function buildScaffold(a) {
  const inv = a.inventory;
  const isVue = a.to === 'vue';
  const items = [];
  if (isVue) {
    items.push(
      { file: 'vite.config.js', task: 'Swap @vitejs/plugin-react for @vitejs/plugin-vue' },
      { file: 'index.html', task: 'Point the entry script at /src/main.js' },
      { file: 'src/main.js', task: 'createApp(App) + app.use(router) + app.use(pinia) wiring' },
      { file: 'src/App.vue', task: 'Root component — converted first, hosts <RouterView/>' }
    );
    if (inv.router.present)
      items.push({ file: 'src/router/index.js', task: 'vue-router: translate the route table (see Routing decision)' });
    if (inv.stateLibs.length || inv.context.providers)
      items.push({ file: 'src/stores/', task: 'Pinia stores — one per Redux slice / global context' });
    if (inv.typescript) items.push({ file: 'tsconfig.json', task: 'Keep strict TS; enable vue-tsc type checking' });
    items.push({ file: 'src/assets/main.css', task: 'Global stylesheet (ported plain CSS / Tailwind directives)' });
  } else {
    items.push(
      { file: 'angular.json', task: 'Scaffold via `ng new` — do not hand-roll the build config' },
      { file: 'src/main.ts', task: 'bootstrapApplication(AppComponent, appConfig)' },
      { file: 'src/app/app.config.ts', task: 'provideRouter(routes) + global providers' },
      { file: 'src/app/app.component.ts', task: 'Root standalone component — converted first, hosts <router-outlet>' }
    );
    if (inv.router.present)
      items.push({ file: 'src/app/app.routes.ts', task: '@angular/router: translate the route table (see Routing decision)' });
    if (inv.stateLibs.length || inv.context.providers)
      items.push({ file: 'src/app/core/services/', task: 'Injectable services with signals — one per Redux slice / global context' });
    items.push({ file: 'src/styles.css', task: 'Global stylesheet (ported plain CSS / Tailwind directives)' });
  }
  return items;
}

// ---------------------------------------------------------------- risks

function buildRisks(a) {
  const risks = a.blockers.map(b => ({
    item: b.library || b.type,
    impact: b.why,
    ownerAction: b.suggestion,
  }));
  for (const m of a.modules) {
    if (m.tier === 'red')
      risks.push({
        item: `module "${m.name}"`,
        impact: `High complexity (score ${m.score}, ${m.files} files) — the converter will punt parts of it to humans.`,
        ownerAction: 'Migrate this module in a spike first; budget rewrite time, not just conversion time.',
      });
  }
  return risks;
}

// --------------------------------------------------------------- output

function printPlan(p) {
  console.log(chalk.bold.cyan('\nrvo plan') + chalk.dim(` — ${p.from} → ${p.to}`));
  console.log(chalk.dim('  ' + p.root));
  const vc =
    p.verdict === 'high-risk'
      ? chalk.red.bold
      : p.verdict === 'feasible-with-caveats'
      ? chalk.yellow.bold
      : chalk.green.bold;
  console.log(`\n  Assess verdict: ${vc(p.verdict.toUpperCase().replace(/-/g, ' '))}`);

  console.log(chalk.bold('\nArchitecture decisions'));
  for (const d of p.decisions) {
    console.log(`\n  ${chalk.bold(d.area)}: ${chalk.cyan(d.decision)}`);
    console.log(chalk.dim(`    ${d.rationale}`));
  }

  console.log(chalk.bold('\nModule plan (leaf-first migration order)'));
  const effortColor = e =>
    e === 'L' ? chalk.red.bold : e === 'M' ? chalk.yellow.bold : chalk.green.bold;
  p.modules.forEach((m, i) => {
    console.log(
      `  ${chalk.dim(`${i + 1}.`)} ${m.name.padEnd(18)} [${effortColor(m.effort)(m.effort)}] ${chalk.dim(
        `${m.tier} · ${m.files} file(s)`
      )}`
    );
    for (const n of m.notes) {
      const blocked = n.startsWith('BLOCKED');
      console.log(`     ${blocked ? chalk.red('!') : chalk.dim('•')} ${blocked ? chalk.red(n) : chalk.dim(n)}`);
    }
    for (const f of m.filePlans || []) {
      console.log(
        `     ${chalk.dim('–')} ${f.file} [${effortColor(f.effort)(f.effort)}]`
      );
      for (const n of f.notes)
        console.log(`       ${chalk.dim('·')} ${chalk.dim(n)}`);
    }
  });

  console.log(chalk.bold('\nScaffold checklist'));
  for (const s of p.scaffold)
    console.log(`  ${chalk.dim('[ ]')} ${s.file} ${chalk.dim('— ' + s.task)}`);

  console.log(chalk.bold(`\nRisk register (${p.risks.length})`));
  if (!p.risks.length)
    console.log(chalk.green('  ✓ no blockers carried forward.'));
  for (const r of p.risks) {
    console.log(`  ${chalk.red('!')} ${chalk.bold(r.item)} — ${r.impact}`);
    console.log(chalk.dim(`      → Owner action: ${r.ownerAction}`));
  }
  console.log(
    chalk.dim('\n  rvo plan is premium. `rvo migrate --to <angular|vue> --out <dir>` executes it.')
  );
}

module.exports = { buildPlan, printPlan };
