// Codemods: apply React.lazy, React.memo and useMemo transforms to source files.
// Every transform is idempotent — running `fix` twice is a no-op.
const fs = require('fs');
const generate = require('@babel/generator').default;
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const { parse } = require('./utils');
const { findUseMemoOps, isTopLevelPath } = require('./ast');

function genCode(ast) {
  return generate(ast, { jsescOption: { minimal: true } }).code;
}

function ensureReactNamedImport(ast, names) {
  let decl = null;
  for (const n of ast.program.body) {
    if (t.isImportDeclaration(n) && n.source.value === 'react') {
      decl = n;
      break;
    }
  }
  const have = new Set();
  if (decl)
    decl.specifiers.forEach(s => {
      if (t.isImportSpecifier(s)) have.add(s.imported.name);
    });
  const missing = names.filter(n => !have.has(n));
  if (!missing.length) return;
  const specs = missing.map(n => t.importSpecifier(t.identifier(n), t.identifier(n)));
  if (decl) decl.specifiers.push(...specs);
  else ast.program.body.unshift(t.importDeclaration(specs, t.stringLiteral('react')));
}

function isSuspenseElement(p) {
  return (
    p.isJSXElement() &&
    t.isJSXIdentifier(p.node.openingElement.name, { name: 'Suspense' })
  );
}

function isInSuspense(elPath) {
  return !!elPath.findParent(p => isSuspenseElement(p));
}

// True when the file already binds `name` at top level for another reason,
// so introducing `const <name> = lazy(...)` would collide.
function hasOtherTopLevelBinding(ast, name, excludeSource) {
  return ast.program.body.some(n => {
    if (t.isVariableDeclaration(n))
      return n.declarations.some(d => t.isIdentifier(d.id, { name }));
    if ((t.isFunctionDeclaration(n) || t.isClassDeclaration(n)) && n.id)
      return n.id.name === name;
    if (t.isImportDeclaration(n) && n.source.value !== excludeSource)
      return n.specifiers.some(s => s.local.name === name);
    return false;
  });
}

function makeImportCall(source) {
  let imp;
  try {
    imp = t.import();
  } catch {
    imp = { type: 'Import' };
  }
  return t.callExpression(imp, [t.stringLiteral(source)]);
}

function wrapInSuspense(elPath) {
  const fallback = t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier('div'), [], false),
    t.jsxClosingElement(t.jsxIdentifier('div')),
    [t.jsxText('Loading…')],
    false
  );
  elPath.replaceWith(
    t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier('Suspense'), [
        t.jsxAttribute(
          t.jsxIdentifier('fallback'),
          t.jsxExpressionContainer(fallback)
        ),
      ]),
      t.jsxClosingElement(t.jsxIdentifier('Suspense')),
      [elPath.node]
    )
  );
}

// ---------------------------------------------------------------------------
// React.lazy: turn `import Foo from './Foo'` into
// `const Foo = lazy(() => import('./Foo'))` and wrap render sites in Suspense.
// ---------------------------------------------------------------------------
function applySingleLazy(ast, cand) {
  if (hasOtherTopLevelBinding(ast, cand.component, cand.source))
    return {
      applied: false,
      reason: `name "${cand.component}" is already declared in this file`,
    };

  // 1. Collect render sites (before mutating anything). Wrapping is decided
  //    later, so sites already under a Suspense are still collected.
  const usages = []; // { path, depth, isAttr }
  traverse(ast, {
    JSXElement(p) {
      const nm = p.node.openingElement.name;
      if (t.isJSXIdentifier(nm, { name: cand.component }))
        usages.push({ path: p, depth: p.getAncestry().length, isAttr: false });
    },
    JSXAttribute(p) {
      const v = p.node.value;
      if (
        t.isJSXExpressionContainer(v) &&
        t.isIdentifier(v.expression, { name: cand.component })
      ) {
        const el = p.findParent(x => x.isJSXElement());
        if (el) usages.push({ path: p, depth: p.getAncestry().length, isAttr: true });
      }
    },
  });
  if (!usages.length)
    return {
      applied: false,
      reason: 'component is imported but never rendered as JSX here',
    };

  // 2. Remove the static import specifier.
  let removed = false;
  traverse(ast, {
    ImportDeclaration(p) {
      if (p.node.source.value !== cand.source) return;
      const i = p.node.specifiers.findIndex(
        s =>
          s.local.name === cand.component &&
          ((cand.kind === 'default' && t.isImportDefaultSpecifier(s)) ||
            (cand.kind === 'named' && t.isImportSpecifier(s)))
      );
      if (i === -1) return;
      p.node.specifiers.splice(i, 1);
      if (!p.node.specifiers.length) p.remove();
      removed = true;
      p.stop();
    },
  });
  if (!removed) return { applied: false, reason: 'import statement not found' };

  // 3. Ensure `lazy` / `Suspense` are imported from react.
  ensureReactNamedImport(ast, ['lazy', 'Suspense']);

  // 4. Insert `const X = lazy(() => import('...'))` after the last import.
  const body = ast.program.body;
  let lastImport = -1;
  body.forEach((n, i) => {
    if (t.isImportDeclaration(n)) lastImport = i;
  });
  let factory = t.arrowFunctionExpression([], makeImportCall(cand.source));
  if (cand.kind === 'named') {
    factory = t.arrowFunctionExpression(
      [],
      t.callExpression(
        t.memberExpression(makeImportCall(cand.source), t.identifier('then')),
        [
          t.arrowFunctionExpression(
            [t.identifier('m')],
            t.objectExpression([
              t.objectProperty(
                t.identifier('default'),
                t.memberExpression(t.identifier('m'), t.identifier(cand.importedName))
              ),
            ])
          ),
        ]
      )
    );
  }
  body.splice(
    lastImport + 1,
    0,
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(cand.component),
        t.callExpression(t.identifier('lazy'), [factory])
      ),
    ])
  );

  // 5. Wrap render sites in <Suspense>, deepest first.
  //    For `component={X}` (react-router v5) inside a <Switch>, wrap the Switch.
  const wrapped = new Set();
  usages
    .sort((a, b) => b.depth - a.depth)
    .forEach(({ path, isAttr }) => {
      let target = isAttr ? path.findParent(x => x.isJSXElement()) : path;
      if (!target) return;
      if (isAttr) {
        const sw =
          target.findParent(
            p =>
              p.isJSXElement() &&
              t.isJSXIdentifier(p.node.openingElement.name, { name: 'Switch' })
          ) ||
          (t.isJSXIdentifier(target.node.openingElement.name, { name: 'Switch' })
            ? target
            : null);
        if (sw) target = sw;
      }
      if (isInSuspense(target) || wrapped.has(target.node)) return;
      wrapped.add(target.node);
      wrapInSuspense(target);
    });

  return { applied: true };
}

function applyLazyToFile(file, cands, dryRun) {
  let code;
  try {
    code = fs.readFileSync(file, 'utf8');
  } catch {
    return { applied: 0, skipped: cands.map(cand => ({ cand, reason: 'file unreadable' })) };
  }
  let applied = 0;
  const skipped = [];
  for (const cand of cands) {
    let ast;
    try {
      ast = parse(code, file);
    } catch {
      skipped.push({ cand, reason: 'file could not be analyzed safely' });
      continue;
    }
    let r;
    try {
      r = applySingleLazy(ast, cand);
    } catch {
      skipped.push({ cand, reason: 'transform failed safely, file untouched' });
      continue;
    }
    if (r.applied) {
      code = genCode(ast);
      applied++;
    } else skipped.push({ cand, reason: r.reason });
  }
  if (applied && !dryRun) fs.writeFileSync(file, code + '\n');
  return { applied, skipped };
}

// ---------------------------------------------------------------------------
// React.memo: wrap top-level components that receive props.
// ---------------------------------------------------------------------------
function applyMemoToFile(file, cands, dryRun) {
  let code, ast;
  try {
    code = fs.readFileSync(file, 'utf8');
    ast = parse(code, file);
  } catch {
    return {
      applied: 0,
      skipped: cands.map(c => ({ cand: c, reason: 'file could not be analyzed safely' })),
    };
  }
  const byName = new Map(cands.map(c => [c.name, c]));
  let applied = 0;

  traverse(ast, {
    VariableDeclarator(p) {
      const id = p.node.id;
      if (!t.isIdentifier(id) || !byName.has(id.name) || !isTopLevelPath(p)) return;
      const init = p.node.init;
      if (!init) return;
      const isPlainFn = t.isArrowFunctionExpression(init) || t.isFunctionExpression(init);
      // forwardRef(...) (or React.forwardRef(...)) composes with memo(...).
      const isFwdRef =
        t.isCallExpression(init) &&
        (t.isIdentifier(init.callee, { name: 'forwardRef' }) ||
          (t.isMemberExpression(init.callee) &&
            !init.callee.computed &&
            t.isIdentifier(init.callee.property, { name: 'forwardRef' })));
      if (!isPlainFn && !isFwdRef) return;
      p.node.init = t.callExpression(t.identifier('memo'), [init]);
      byName.delete(id.name);
      applied++;
    },
    FunctionDeclaration(p) {
      const id = p.node.id;
      if (!id || !byName.has(id.name) || !isTopLevelPath(p)) return;
      const n = id.name;
      const memoFn = t.callExpression(t.identifier('memo'), [
        t.functionExpression(
          t.identifier(n),
          p.node.params,
          p.node.body,
          p.node.generator,
          p.node.async
        ),
      ]);
      const parent = p.parentPath;
      if (parent.isExportDefaultDeclaration()) {
        parent.node.declaration = memoFn;
      } else if (parent.isExportNamedDeclaration()) {
        parent.node.declaration = t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(n), memoFn),
        ]);
      } else {
        p.replaceWith(
          t.variableDeclaration('const', [
            t.variableDeclarator(t.identifier(n), memoFn),
          ])
        );
      }
      byName.delete(n);
      applied++;
    },
  });

  if (applied && !dryRun) {
    ensureReactNamedImport(ast, ['memo']);
    fs.writeFileSync(file, genCode(ast) + '\n');
  }
  return {
    applied,
    skipped: [...byName.values()].map(c => ({
      cand: c,
      reason: 'declaration not found or not a plain function component',
    })),
  };
}

// ---------------------------------------------------------------------------
// useMemo: wrap expensive render-time computations with a safe dep list.
// ---------------------------------------------------------------------------
function applyUseMemoToFile(file, dryRun) {
  let code, ast, ops;
  try {
    code = fs.readFileSync(file, 'utf8');
    ast = parse(code, file);
    ops = findUseMemoOps(ast);
  } catch {
    return { applied: 0 };
  }
  let applied = 0;
  if (ops.length) {
    const byKey = new Map(ops.map(o => [`${o.name}:${o.line}`, o]));
    traverse(ast, {
      VariableDeclarator(p) {
        const id = p.node.id;
        if (!t.isIdentifier(id) || !p.node.init) return;
        const op = byKey.get(`${id.name}:${p.node.loc.start.line}`);
        if (!op) return;
        p.node.init = t.callExpression(t.identifier('useMemo'), [
          t.arrowFunctionExpression([], p.node.init),
          t.arrayExpression(op.deps.map(d => t.identifier(d))),
        ]);
        applied++;
      },
    });
    if (applied && !dryRun) {
      ensureReactNamedImport(ast, ['useMemo']);
      fs.writeFileSync(file, genCode(ast) + '\n');
    }
  }
  return { applied };
}

// ---------------------------------------------------------------------------
function groupBy(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = x[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function applyFixes(results, { dryRun = false } = {}) {
  const summary = {
    lazy: { applied: 0, skipped: [] },
    memo: { applied: 0, skipped: [] },
    usememo: { applied: 0, skipped: [] },
    changedFiles: [],
  };
  const seen = new Set();
  const mark = f => {
    if (!seen.has(f)) {
      seen.add(f);
      summary.changedFiles.push(f);
    }
  };

  for (const [file, cands] of groupBy(results.lazy || [], 'file')) {
    const r = applyLazyToFile(file, cands, dryRun);
    summary.lazy.applied += r.applied;
    r.skipped.forEach(s => summary.lazy.skipped.push({ file, ...s }));
    if (r.applied) mark(file);
  }
  // NOTE: useMemo must run before memo — once a component is wrapped in
  // memo(...), the component detector no longer sees a plain function.
  for (const [file] of groupBy(results.usememo || [], 'file')) {
    const r = applyUseMemoToFile(file, dryRun);
    summary.usememo.applied += r.applied;
    if (r.applied) mark(file);
  }
  for (const [file, cands] of groupBy(results.memo || [], 'file')) {
    const r = applyMemoToFile(file, cands, dryRun);
    summary.memo.applied += r.applied;
    r.skipped.forEach(s => summary.memo.skipped.push({ file, ...s }));
    if (r.applied) mark(file);
  }
  return summary;
}

module.exports = { applyFixes, applyLazyToFile, applyMemoToFile, applyUseMemoToFile };
