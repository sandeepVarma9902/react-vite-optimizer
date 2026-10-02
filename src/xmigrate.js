// rvo migrate --to vue|angular — cross-framework migration accelerator (premium).
//
// Converts what is mechanical, marks the rest for humans. Conservative by
// design: anything the converter cannot map confidently is emitted as a loud
// TODO(human) block instead of invented code. Never touches the source tree —
// the converted tree is written to --out preserving relative paths.
//
// Reuses rvo assess for the analysis (blockers, library table, inventory);
// the AST conversion here is the transform step, not a re-analysis.
const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const chalk = require('chalk');
const { parse, loadConfig } = require('./utils');
const { assessProject } = require('./assess');
const sh = require('./xmigrate-shared');
const { convertFunctionVue, convertClassVue } = require('./xmigrate-vue');
const { convertFunctionAngular, convertClassAngular } = require('./xmigrate-angular');

const { t } = sh;

// ------------------------------------------------------------------ entry

function runCrossFramework(
  root,
  { from = 'react', to, out, dryRun = false, only = null } = {}
) {
  if (from !== 'react')
    throw new Error(`rvo migrate currently supports --from react only (got "${from}").`);
  if (!to || !['angular', 'vue'].includes(to))
    throw new Error(
      'rvo migrate needs --to <angular|vue>. Example: rvo migrate ./my-app --to vue --out ./vue-app'
    );
  if (!dryRun && !out)
    throw new Error(
      'rvo migrate needs --out <dir> to write the converted tree (or use --dry-run to preview).'
    );

  const resolvedOut = out ? path.resolve(out) : null;
  const config = loadConfig(root);
  const srcDir = path.join(root, config.srcDir);
  if (!fs.existsSync(srcDir)) throw new Error(`No source directory at ${srcDir}`);
  if (
    resolvedOut &&
    (resolvedOut === srcDir || resolvedOut === path.resolve(root))
  )
    throw new Error(
      'rvo migrate: --out must not be the project root or src dir (source is never overwritten).'
    );

  const a = assessProject(root, { from, to });

  let files = fg.sync(['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'], {
    cwd: srcDir,
    onlyFiles: true,
    ignore: ['**/node_modules/**'],
  });
  if (only) {
    const wanted = String(only)
      .split(',')
      .map(s => s.trim().replace(/\\/g, '/'))
      .filter(Boolean);
    files = files.filter(f =>
      wanted.some(w => f === w || f.startsWith(w.replace(/\/?$/, '/')))
    );
  }
  if (!files.length) throw new Error('No source files matched.');

  const results = files.map(rel =>
    convertFile(path.join(srcDir, rel), srcDir, a, to)
  );

  if (dryRun) {
    printDryRun(results, to);
    return { dryRun: true, results };
  }

  for (const r of results) {
    for (const o of r.outputs) {
      const dest = path.join(resolvedOut, o.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, o.code);
    }
  }
  printSummary(results, to, resolvedOut);
  return { results, out: resolvedOut };
}

// -------------------------------------------------------------- per file

function convertFile(abs, srcDir, assess, to) {
  const rel = path.relative(srcDir, abs).split(path.sep).join('/');
  const rootRel = path.relative(assess.root, abs).split(path.sep).join('/');
  const code = fs.readFileSync(abs, 'utf8');
  const ctx = {
    rel,
    to,
    assess,
    todos: [],
    risky: 0,
    forceLow: false,
    fileIsTest: /\.(test|spec)\.[jt]sx?$/.test(rel),
  };

  let ast;
  try {
    ast = parse(code, abs);
  } catch (e) {
    ctx.todos.push(`could not parse this file (${e.message}) — copied as-is`);
    ctx.forceLow = true;
    return copied(rel, code, ctx, 'unparseable — copied as-is');
  }

  analyzeImports(ast, ctx, rootRel);

  if (ctx.fileIsTest) {
    ctx.todos.push(
      `port this test to ${to === 'vue' ? 'Vue Test Utils + Vitest' : 'Angular TestBed'}`
    );
    return copied(rel, code, ctx, 'test file — copied as-is, port manually');
  }

  const comps = findComponents(ast);
  if (!comps.length) return copied(rel, code, ctx, 'no components — copied as-is');

  const primary =
    comps.find(c => c.isDefault) || comps.find(c => c.kind === 'function') || comps[0];
  for (const c of comps) {
    if (c !== primary)
      ctx.todos.push(`also exports component ${c.name} — convert manually`);
  }

  if (primary.kind === 'hoc') {
    ctx.todos.push(
      `${primary.name} is wrapped in a higher-order component — unwrap to a ${
        to === 'vue' ? 'composable' : 'service/directive'
      } before converting`
    );
    ctx.forceLow = true;
    return copied(rel, code, ctx, 'HOC-wrapped — copied as-is');
  }
  if (primary.kind === 'class') {
    return to === 'vue'
      ? convertClassVue(primary, ast, ctx)
      : convertClassAngular(primary, ast, ctx);
  }
  return to === 'vue'
    ? convertFunctionVue(primary, ast, ctx)
    : convertFunctionAngular(primary, ast, ctx);
}

function copied(rel, code, ctx, reason) {
  const head = sh.headerLines(ctx, reason);
  return {
    rel,
    kind: 'copied',
    outputs: [{ rel, code: head + code }],
    confidence: ctx.confidence,
    todos: ctx.todos,
  };
}

// ---------------------------------------------------------------- imports

function analyzeImports(ast, ctx, rootRel) {
  ctx.usesRouter = false;
  ctx.cssImports = [];
  for (const stmt of ast.program.body) {
    if (!t.isImportDeclaration(stmt)) continue;
    const src = stmt.source.value;
    if (/^react-router(-dom)?$/.test(src)) ctx.usesRouter = true;
    if (/\.(css|scss|sass|less)$/.test(src)) ctx.cssImports.push(src);
  }
  const blocked = (ctx.assess.libraries || []).filter(
    l => l.status === 'blocked' && (l.fileList || []).includes(rootRel)
  );
  ctx.blockedLibs = new Set(blocked.map(l => l.name));
  for (const l of blocked) {
    ctx.todos.push(
      `uses blocked library "${l.name}" — ${l.suggestion || 'resolve before migrating this file'}`
    );
    ctx.forceLow = true;
  }
  if (ctx.cssImports.length) {
    ctx.todos.push(
      `stylesheet import(s) ${ctx.cssImports.join(', ')} dropped — port into ${
        ctx.to === 'vue' ? '<style>' : 'component styles'
      }`
    );
    ctx.risky++;
  }
}

// ------------------------------------------------------------- components

function findComponents(ast) {
  const found = [];
  for (const stmt of ast.program.body) {
    let node = stmt;
    let isDefault = false;
    let exported = false;
    if (t.isExportDefaultDeclaration(stmt)) {
      node = stmt.declaration;
      isDefault = true;
      exported = true;
    } else if (t.isExportNamedDeclaration(stmt) && stmt.declaration) {
      node = stmt.declaration;
      exported = true;
    } else if (t.isExportNamedDeclaration(stmt) && !stmt.declaration) {
      continue;
    }
    if (t.isFunctionDeclaration(node) && sh.containsJSX(node)) {
      const name = node.id ? node.id.name : isDefault ? 'Default' : null;
      if (name) found.push({ kind: 'function', name, node, isDefault, exported });
    } else if (t.isVariableDeclaration(node)) {
      for (const d of node.declarations) {
        if (!t.isIdentifier(d.id) || !/^[A-Z]/.test(d.id.name) || !d.init) continue;
        const nm = d.id.name;
        if (
          (t.isArrowFunctionExpression(d.init) || t.isFunctionExpression(d.init)) &&
          sh.containsJSX(d.init)
        ) {
          found.push({ kind: 'function', name: nm, node: d.init, isDefault, exported });
        } else if (t.isCallExpression(d.init)) {
          // HOC-wrapped: memo(...), connect(...)(X), observer(...)
          let wrapsJsx = false;
          for (const arg of d.init.arguments) {
            if (
              (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) &&
              sh.containsJSX(arg)
            )
              wrapsJsx = true;
          }
          if (wrapsJsx || sh.containsJSX(d.init))
            found.push({ kind: 'hoc', name: nm, node: d.init, isDefault, exported });
        }
      }
    } else if (
      t.isClassDeclaration(node) &&
      sh.isComponentSuperclass(node.superClass)
    ) {
      found.push({ kind: 'class', name: node.id.name, node, isDefault, exported });
    }
  }
  return found;
}

// ---------------------------------------------------------------- output

function confColor(c) {
  return c === 'high' ? chalk.green : c === 'medium' ? chalk.yellow : chalk.red;
}

function printDryRun(results, to) {
  console.log(chalk.bold.cyan(`\nrvo migrate --to ${to}`) + chalk.dim(' — dry run'));
  for (const r of results) {
    for (const o of r.outputs) {
      const arrow = r.kind === 'copied' ? chalk.dim('copy →') : chalk.green('convert →');
      console.log(
        `  ${r.rel} ${arrow} ${o.rel} ${confColor(r.confidence)(`[${r.confidence}]`)}`
      );
    }
    for (const td of r.todos.slice(0, 3)) console.log(chalk.dim(`      · ${td}`));
    if (r.todos.length > 3) console.log(chalk.dim(`      · …${r.todos.length - 3} more`));
  }
  console.log(chalk.yellow('\nDry run — no files were written.'));
}

function printSummary(results, to, outDir) {
  const conv = results.filter(r => r.kind !== 'copied').length;
  const copiedN = results.length - conv;
  const todos = results.reduce((n, r) => n + r.todos.length, 0);
  const low = results.filter(r => r.confidence === 'low').length;
  console.log(chalk.bold.cyan(`\nrvo migrate --to ${to}`) + chalk.dim(' — done'));
  console.log(`  ${chalk.green(`${conv} converted`)} · ${chalk.dim(`${copiedN} copied as-is`)} → ${outDir}`);
  console.log(
    `  ${todos} TODO(human) marker(s)${low ? ` · ${chalk.red(`${low} low-confidence file(s)`)}` : ''}`
  );
  console.log(
    chalk.dim(
      '\n  Next: review every TODO(human), run `rvo plan` for the architecture blueprint, then wire router/store/scaffold by hand.'
    )
  );
}

module.exports = { runCrossFramework, convertFile };
