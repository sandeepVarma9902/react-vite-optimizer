// AST helpers: component discovery, prop/hook introspection, useMemo opportunity finder.
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

function isTopLevelPath(p) {
  let cur = p;
  while (cur.parentPath && !cur.parentPath.isProgram()) {
    const parent = cur.parentPath;
    if (
      parent.isExportNamedDeclaration() ||
      parent.isExportDefaultDeclaration() ||
      parent.isVariableDeclaration()
    ) {
      cur = parent;
      continue;
    }
    return false;
  }
  return !!(cur.parentPath && cur.parentPath.isProgram());
}

function returnsJSX(fnPath) {
  const body = fnPath.get('body');
  if (!body || !body.node) return false;
  if (body.isJSXElement() || body.isJSXFragment()) return true;
  if (!body.isBlockStatement()) return false;
  let found = false;
  body.traverse({
    Function(p) {
      p.skip();
    },
    ReturnStatement(p) {
      const arg = p.get('argument');
      if (arg.node && (arg.isJSXElement() || arg.isJSXFragment())) found = true;
    },
  });
  return found;
}

// Name of a call's callee: `memo`, `React.memo`, `forwardRef`, etc.
function calleeName(calleePath) {
  if (calleePath.isIdentifier()) return calleePath.node.name;
  if (
    calleePath.isMemberExpression() &&
    !calleePath.node.computed &&
    calleePath.get('property').isIdentifier()
  )
    return calleePath.get('property').node.name;
  return null;
}

// Unwrap memo(...)/forwardRef(...) to the inner function, if any.
// Returns { path, alreadyMemo, wrapped } or null.
function unwrapMemoized(exprPath) {
  let cur = exprPath;
  let alreadyMemo = false;
  let wrapped = false;
  while (cur.isCallExpression() && ['memo', 'forwardRef'].includes(calleeName(cur.get('callee')))) {
    if (calleeName(cur.get('callee')) === 'memo') alreadyMemo = true;
    wrapped = true;
    const args = cur.get('arguments');
    if (!args.length) return null;
    cur = args[0];
  }
  if (cur.isArrowFunctionExpression() || cur.isFunctionExpression())
    return { path: cur, alreadyMemo, wrapped };
  return null;
}

// Calls cb({ name, kind, node, fnPath, alreadyMemo }) for every top-level
// function component (name starts with an uppercase letter, returns JSX),
// including ones already wrapped in memo(...).
function eachComponent(ast, cb) {
  traverse(ast, {
    FunctionDeclaration(p) {
      if (!isTopLevelPath(p)) return;
      const name = p.node.id && p.node.id.name;
      if (!name || !/^[A-Z]/.test(name)) return;
      if (!returnsJSX(p)) return;
      cb({ name, kind: 'function', node: p.node, fnPath: p, alreadyMemo: false });
    },
    VariableDeclarator(p) {
      if (!isTopLevelPath(p)) return;
      const { id, init } = p.node;
      if (!t.isIdentifier(id) || !/^[A-Z]/.test(id.name) || !init) return;
      const unwrapped = unwrapMemoized(p.get('init'));
      if (!unwrapped) return;
      if (!returnsJSX(unwrapped.path)) return;
      cb({
        name: id.name,
        kind: 'var',
        node: p.node,
        fnPath: unwrapped.path,
        alreadyMemo: unwrapped.alreadyMemo,
      });
    },
    ExportDefaultDeclaration(p) {
      const unwrapped = unwrapMemoized(p.get('declaration'));
      // Plain `export default function Foo()` is handled by FunctionDeclaration above.
      if (!unwrapped || !unwrapped.wrapped) return;
      const d = unwrapped.path.node;
      const name = d.id && d.id.name;
      if (!name || !/^[A-Z]/.test(name)) return;
      if (!returnsJSX(unwrapped.path)) return;
      cb({
        name,
        kind: 'export-default',
        node: unwrapped.path.node,
        fnPath: unwrapped.path,
        alreadyMemo: unwrapped.alreadyMemo,
      });
    },
  });
}

function getPropsInfo(fnPath) {
  const params = fnPath.get('params');
  if (!params.length) return { hasProps: false, names: [] };
  const first = params[0];
  if (first.isObjectPattern()) {
    const names = first.node.properties
      .map(pr => {
        if (t.isObjectProperty(pr)) return pr.key.name || pr.key.value;
        if (t.isRestElement(pr) && t.isIdentifier(pr.argument)) return '...' + pr.argument.name;
        return null;
      })
      .filter(Boolean);
    return { hasProps: true, names };
  }
  if (first.isIdentifier()) return { hasProps: true, names: [first.node.name] };
  return { hasProps: true, names: [] };
}

function getHooks(fnPath) {
  const hooks = new Set();
  const body = fnPath.get('body');
  if (!body || !body.node) return [];
  body.traverse({
    Function(p) {
      p.skip();
    },
    CallExpression(p) {
      const c = p.node.callee;
      if (t.isIdentifier(c) && /^use[A-Z]/.test(c.name)) hooks.add(c.name);
    },
  });
  return [...hooks];
}

const EXPENSIVE_METHODS = new Set(['map', 'filter', 'reduce', 'flatMap', 'sort']);

function isExpensiveInit(node) {
  if (!t.isCallExpression(node)) return false;
  const cal = node.callee;
  if (
    t.isMemberExpression(cal) &&
    !cal.computed &&
    t.isIdentifier(cal.property) &&
    EXPENSIVE_METHODS.has(cal.property.name)
  )
    return true;
  if (
    t.isMemberExpression(cal) &&
    t.isIdentifier(cal.object, { name: 'JSON' }) &&
    t.isIdentifier(cal.property) &&
    ['parse', 'stringify'].includes(cal.property.name)
  )
    return true;
  return false;
}

function alreadyInHook(initPath) {
  const n = initPath.node;
  if (t.isCallExpression(n) && t.isIdentifier(n.callee) && /^use[A-Z]/.test(n.callee.name))
    return true;
  return !!initPath.findParent(
    p =>
      p.isCallExpression() &&
      t.isIdentifier(p.node.callee) &&
      /^use[A-Z]/.test(p.node.callee.name)
  );
}

// Compute a safe dependency list for wrapping `init` in useMemo.
// Returns null when it cannot be proven safe (bail out).
function computeDeps(fnPath, declPath, initPath) {
  const deps = [];
  let ok = true;
  const fnScope = fnPath.scope;
  const progScope = initPath.scope.getProgramParent();

  initPath.traverse({
    Identifier(p) {
      if (!ok) return;
      const parent = p.parent;
      // Not a value reference: property keys, member keys, declarations, import parts.
      if (t.isMemberExpression(parent) && parent.property === p.node && !parent.computed)
        return;
      if (
        (t.isObjectProperty(parent) || t.isObjectMethod(parent)) &&
        parent.key === p.node &&
        !parent.computed
      )
        return;
      if (
        (t.isVariableDeclarator(parent) || t.isFunction(parent)) &&
        parent.id === p.node
      )
        return;
      if (
        t.isImportSpecifier(parent) ||
        t.isImportDefaultSpecifier(parent) ||
        t.isImportNamespaceSpecifier(parent)
      )
        return;

      const name = p.node.name;
      if (name === 'undefined') return;
      if (name === 'arguments') {
        ok = false;
        return;
      }
      const binding = p.scope.getBinding(name);
      if (!binding) return; // globals: Math, JSON, console, ...
      if (binding.path === declPath) {
        ok = false;
        return;
      }
      // Declared inside the init expression itself (arrow params, inner consts)
      // -> local to the computation, not a dependency.
      let bp = binding.path;
      let inside = false;
      while (bp) {
        if (bp === initPath) {
          inside = true;
          break;
        }
        bp = bp.parentPath;
      }
      if (inside) return;

      const bScope = binding.scope;
      if (bScope === fnScope) {
        if (binding.kind === 'param') {
          deps.push(name);
          return;
        }
        if (binding.path.isVariableDeclarator() && binding.kind === 'const') {
          deps.push(name); // derived const: stable within this render
          return;
        }
        ok = false; // let/var/function declared in component body -> unsafe
        return;
      }
      if (bScope === progScope || binding.kind === 'module') return; // module-level / import -> stable
      ok = false;
    },
  });

  return ok ? [...new Set(deps)] : null;
}

function findUseMemoOps(ast) {
  const ops = [];
  eachComponent(ast, ({ name, fnPath }) => {
    const body = fnPath.get('body');
    if (!body.isBlockStatement()) return;
    for (const stmt of body.get('body')) {
      if (!stmt.isVariableDeclaration()) continue;
      for (const decl of stmt.get('declarations')) {
        const id = decl.node.id;
        const init = decl.get('init');
        if (!t.isIdentifier(id) || !init.node) continue;
        if (!isExpensiveInit(init.node)) continue;
        if (alreadyInHook(init)) continue;
        const deps = computeDeps(fnPath, decl, init);
        if (deps === null) continue;
        ops.push({
          component: name,
          name: id.name,
          line: decl.node.loc.start.line,
          deps,
        });
      }
    }
  });
  return ops;
}

module.exports = {
  isTopLevelPath,
  returnsJSX,
  eachComponent,
  getPropsInfo,
  getHooks,
  findUseMemoOps,
};
