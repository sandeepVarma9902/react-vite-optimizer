// Shared helpers for the cross-framework migrator (rvo migrate --to vue|angular).
const t = require('@babel/types');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

const KNOWN_HOOKS = new Set([
  'useState',
  'useEffect',
  'useContext',
  'useReducer',
  'useRef',
  'useMemo',
  'useCallback',
]);

function kebab(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function exprCode(node) {
  return generate(node).code;
}

function indent(s, n) {
  const pad = ' '.repeat(n == null ? 2 : n);
  return String(s)
    .split('\n')
    .map(l => (l.trim() ? pad + l : l))
    .join('\n');
}

function hookName(callee) {
  if (t.isIdentifier(callee)) return callee.name;
  if (
    t.isMemberExpression(callee) &&
    t.isIdentifier(callee.object, { name: 'React' }) &&
    t.isIdentifier(callee.property)
  )
    return callee.property.name;
  return null;
}

function isHookCall(node, name) {
  return t.isCallExpression(node) && hookName(node.callee) === name;
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

// babel's traverse() only accepts a Program/File root (or an explicit
// scope+parentPath). This wraps any subtree in a synthetic File so visitors
// run correctly. Mutations apply to the REAL nodes for every descendant.
// Returns the current root — use the return value, because replacing the
// subtree root itself swaps it out of the synthetic wrapper (your old
// reference would then be stale).
function traverseSub(node, visitors) {
  if (node && (node.type === 'File' || node.type === 'Program')) {
    traverse(node, visitors);
    return node;
  }
  let stmt;
  let getRoot;
  if (t.isStatement(node)) {
    stmt = node;
    getRoot = () => stmt;
  } else {
    try {
      stmt = t.expressionStatement(node);
      getRoot = () => stmt.expression;
    } catch (_) {
      // patterns (e.g. destructured params) are not expressions
      stmt = t.variableDeclaration('const', [t.variableDeclarator(node)]);
      getRoot = () => stmt.declarations[0].id;
    }
  }
  traverse(t.file(t.program([stmt])), visitors);
  return getRoot();
}

function containsJSX(node) {
  let found = false;
  try {
    traverseSub(node, {
      JSXElement(p) {
        found = true;
        p.stop();
      },
      JSXFragment(p) {
        found = true;
        p.stop();
      },
    });
  } catch (_) {
    /* best effort */
  }
  return found;
}

// Position check: is this Identifier a *read* of a tracked name (not a
// declaration id, object key, member property, param, or import/export)?
function isReadPosition(p) {
  const node = p.node;
  const parent = p.parent;
  if (!parent) return true;
  if (t.isVariableDeclarator(parent) && parent.id === node) return false;
  if (t.isFunction(parent) && parent.params.includes(node)) return false;
  // object pattern values inside params are handled by skipping params outright
  if (
    (t.isFunctionDeclaration(parent) ||
      t.isFunctionExpression(parent) ||
      t.isClassDeclaration(parent) ||
      t.isClassExpression(parent)) &&
    parent.id === node
  )
    return false;
  if (
    (t.isObjectProperty(parent) || t.isObjectMethod(parent)) &&
    parent.key === node &&
    !parent.computed
  )
    return false;
  if (
    t.isMemberExpression(parent) &&
    parent.property === node &&
    !parent.computed
  )
    return false;
  if (
    t.isImportSpecifier(parent) ||
    t.isImportDefaultSpecifier(parent) ||
    t.isImportNamespaceSpecifier(parent)
  )
    return false;
  if (t.isExportSpecifier(parent)) return false;
  if (
    t.isLabeledStatement(parent) ||
    t.isBreakStatement(parent) ||
    t.isContinueStatement(parent)
  )
    return false;
  if (t.isCatchClause(parent) && parent.param === node) return false;
  if (t.isClassMethod(parent) || t.isClassProperty(parent)) {
    if (parent.key === node && !parent.computed) return false;
  }
  return true;
}

// True when this identifier sits inside the deps array of a useEffect call
// (watch() needs the ref itself, not .value).
function insideEffectDeps(p) {
  let cur = p;
  while (cur && cur.parentPath) {
    const parent = cur.parentPath.node;
    if (
      t.isCallExpression(parent) &&
      hookName(parent.callee) === 'useEffect' &&
      parent.arguments[1] === cur.node
    )
      return true;
    cur = cur.parentPath;
  }
  return false;
}

function containsIdent(node, name) {
  let found = false;
  try {
    traverseSub(node, {
      Identifier(p) {
        if (p.node.name === name && isReadPosition(p)) {
          found = true;
          p.stop();
        }
      },
    });
  } catch (_) {}
  return found;
}

// Is `name` referenced as a *value* (not just called) inside node?
// Used to detect setState setters passed as callbacks: onChange={setValue}.
function isReferencedAsValue(node, name) {
  let found = false;
  try {
    traverseSub(node, {
      Identifier(p) {
        if (p.node.name !== name) return;
        const parent = p.parent;
        if (t.isArrayPattern(parent) || t.isObjectPattern(parent)) return; // the declarator itself
        if (t.isCallExpression(parent) && parent.callee === p.node) return; // a direct call
        if (!isReadPosition(p)) return;
        found = true;
        p.stop();
      },
    });
  } catch (_) {}
  return found;
}

// Original imports worth keeping: drops react/react-dom/react-router and
// stylesheet imports (handled per target).
function keptImports(ast, blocked) {
  const kept = [];
  const dropped = [];
  for (const stmt of ast.program.body) {
    if (!t.isImportDeclaration(stmt)) continue;
    const src = stmt.source.value;
    if (src === 'react' || src === 'react-dom' || src === 'react-dom/client') continue;
    if (/^react-router(-dom)?$/.test(src)) continue;
    if (/\.(css|scss|sass|less)$/.test(src)) continue;
    if (blocked && blocked.has(src)) {
      dropped.push(src);
      continue;
    }
    kept.push(stmt);
  }
  return { kept, dropped };
}

function confidenceOf(ctx) {
  if (ctx.forceLow) return 'low';
  if (ctx.risky === 0) return 'high';
  if (ctx.risky <= 2) return 'medium';
  return 'low';
}

// Every emitted file gets this header: conversion confidence + loud TODOs.
function headerLines(ctx, reason, commentStyle) {
  const conf = confidenceOf(ctx);
  ctx.confidence = conf;
  const c = commentStyle || '//';
  const lines = [`${c} rvo migrate: react → ${ctx.to} · confidence: ${conf} · ${reason}`];
  for (const td of ctx.todos) lines.push(`${c} TODO(human): ${td}`);
  return lines.join('\n') + '\n';
}

function jsxName(name) {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) return `${jsxName(name.object)}.${name.property.name}`;
  return 'unknown';
}

// {list.map(item => <X/>)} pattern → { list, item, index, jsx }
function asMapCall(expr) {
  if (!t.isCallExpression(expr)) return null;
  const cal = expr.callee;
  if (!t.isMemberExpression(cal) || !t.isIdentifier(cal.property, { name: 'map' }))
    return null;
  const fn = expr.arguments[0];
  if (!fn || !(t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn))) return null;
  const body = fn.body;
  const jsx = t.isJSXElement(body) || t.isJSXFragment(body) ? body : null;
  if (!jsx) return null;
  const params = fn.params.filter(p => t.isIdentifier(p)).map(p => p.name);
  if (!params.length) return null;
  return { list: exprCode(cal.object), listNode: cal.object, item: params[0], index: params[1] || null, jsx };
}

// Replace reads of `name` inside a tree with make(). Used for functional
// setState updaters: setX(prev => prev + 1). Returns the current root —
// callers must use the return value.
function replaceIdentInTree(node, name, make) {
  return traverseSub(node, {
    Identifier(p) {
      if (p.node.name !== name) return;
      if (!isReadPosition(p)) return;
      p.replaceWith(make());
      p.skip();
    },
  });
}

module.exports = {
  KNOWN_HOOKS,
  traverseSub,
  kebab,
  exprCode,
  indent,
  hookName,
  isHookCall,
  isComponentSuperclass,
  containsJSX,
  isReadPosition,
  insideEffectDeps,
  containsIdent,
  isReferencedAsValue,
  keptImports,
  confidenceOf,
  headerLines,
  jsxName,
  asMapCall,
  replaceIdentInTree,
  t,
  traverse,
};
