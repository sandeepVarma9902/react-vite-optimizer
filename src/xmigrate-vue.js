// Vue target for rvo migrate --to vue: function components → <script setup>
// SFCs (Composition API), class components → best-effort SFC + loud TODOs.
const sh = require('./xmigrate-shared');
const { t, traverse } = sh;

// ------------------------------------------------------- function → Vue SFC

function convertFunctionVue(comp, ast, ctx) {
  const fn = comp.node;
  const S = {
    states: new Map(), // var -> setter name
    setters: new Map(), // setter -> var
    propNames: [],
    propsObj: null,
    imports: new Set(),
    hookCode: new Map(), // original stmt node -> [code strings]
    effectStmts: new Set(),
    replacedDecls: new Set(),
    lifecycle: new Set(), // onMounted / onUnmounted / watch
  };

  // ---- props from the first parameter
  const p0 = fn.params[0];
  if (p0) {
    if (t.isObjectPattern(p0)) {
      for (const prop of p0.properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key))
          S.propNames.push(prop.key.name);
        else {
          ctx.todos.push('rest/spread props are not mapped — declare explicitly');
          ctx.risky += 2;
        }
      }
    } else if (t.isIdentifier(p0)) {
      S.propsObj = p0.name;
    }
  }

  const stmts = fn.body.type === 'BlockStatement' ? fn.body.body : [];

  // Capture the return JSX *before* rewriting (template wants original exprs).
  let returnJSX = null;
  if (fn.body.type !== 'BlockStatement') {
    returnJSX = t.cloneNode(fn.body, true);
  } else {
    const ret = stmts.find(
      s =>
        t.isReturnStatement(s) &&
        s.argument &&
        (t.isJSXElement(s.argument) || t.isJSXFragment(s.argument))
    );
    if (ret) returnJSX = t.cloneNode(ret.argument, true);
  }

  collectHooksVue(stmts, S, ctx);
  // Setters passed as values (onChange={setX}) lose their declaration —
  // keep a compat wrapper so those references still resolve.
  const setterWrappers = [];
  for (const [setter, v] of S.setters) {
    if (sh.isReferencedAsValue(fn, setter))
      setterWrappers.push(`const ${setter} = (v) => { ${v}.value = v; };`);
  }
  rewriteVueReads(fn, S);

  // ---- script assembly
  const script = [];
  if (setterWrappers.length) script.push(...setterWrappers);
  if (S.propNames.length) {
    script.push(
      `const { ${S.propNames.join(', ')} } = defineProps([${S.propNames
        .map(n => `'${n}'`)
        .join(', ')}]);`
    );
    ctx.todos.push(
      'props are destructured from defineProps() — check reactivity if a parent mutates them'
    );
    ctx.risky++;
  } else if (S.propsObj) {
    script.push(`const ${S.propsObj} = defineProps();`);
    ctx.todos.push('declare prop names/types in defineProps()');
    ctx.risky++;
  }

  for (const stmt of stmts) {
    if (S.hookCode.has(stmt)) {
      script.push(...S.hookCode.get(stmt));
      continue;
    }
    if (S.effectStmts.has(stmt)) {
      script.push(...convertEffectVue(stmt, S, ctx));
      continue;
    }
    if (
      t.isReturnStatement(stmt) &&
      stmt.argument &&
      (t.isJSXElement(stmt.argument) || t.isJSXFragment(stmt.argument))
    ) {
      continue; // → template
    }
    if (t.isReturnStatement(stmt)) {
      ctx.todos.push('non-JSX return in component — verify control flow');
      ctx.risky++;
    }
    script.push(sh.exprCode(stmt));
  }

  // ---- template
  const cx = templateCtx(ctx);
  let template;
  if (returnJSX) {
    template = jsxToVue(returnJSX, cx);
  } else {
    ctx.todos.push('no JSX return found — template left empty');
    ctx.forceLow = true;
    template = '<!-- no JSX return found -->';
  }

  // ---- imports
  for (const n of S.lifecycle) S.imports.add(n);
  const importLines = [];
  const vueImports = [...S.imports].sort();
  if (vueImports.length)
    importLines.push(`import { ${vueImports.join(', ')} } from 'vue';`);
  if (cx.usesRouterLink) {
    importLines.push(`import { RouterLink } from 'vue-router';`);
    ctx.todos.push('install vue-router and register the router (see `rvo plan` scaffold)');
  }
  const { kept: keptImps, dropped: droppedImps } = sh.keptImports(ast, ctx.blockedLibs);
  for (const d of droppedImps)
    ctx.todos.push(`import "${d}" dropped — blocked library, no ${ctx.to === 'vue' ? 'Vue' : 'Angular'} equivalent`);
  for (const imp of keptImps)
    importLines.push(sh.exprCode(imp).replace(/;$/, '') + ';');

  const head = sh.headerLines(ctx, `function component ${comp.name || 'default'}`);
  const code =
    head +
    '<script setup>\n' +
    (importLines.length ? importLines.join('\n') + '\n' : '') +
    (script.length ? script.join('\n') + '\n' : '') +
    '</script>\n\n<template>\n' +
    sh.indent(template) +
    '\n</template>\n';

  const outRel = ctx.rel.replace(/\.[jt]sx?$/, '.vue');
  return {
    rel: ctx.rel,
    kind: 'component-vue',
    outputs: [{ rel: outRel, code }],
    confidence: ctx.confidence,
    todos: ctx.todos,
  };
}

function collectHooksVue(stmts, S, ctx) {
  for (const stmt of stmts) {
    if (t.isVariableDeclaration(stmt) && stmt.declarations.length === 1) {
      const d = stmt.declarations[0];
      if (t.isCallExpression(d.init)) {
        const name = sh.hookName(d.init.callee);
        if (name && (sh.KNOWN_HOOKS.has(name) || /^use[A-Z]/.test(name))) {
          S.replacedDecls.add(d);
          const out = [];
          const initArg = d.init.arguments[0];
          const initCode = initArg ? sh.exprCode(initArg) : 'undefined';
          if (
            name === 'useState' &&
            t.isArrayPattern(d.id) &&
            d.id.elements.length >= 1 &&
            t.isIdentifier(d.id.elements[0])
          ) {
            const v = d.id.elements[0].name;
            const setter =
              d.id.elements[1] && t.isIdentifier(d.id.elements[1])
                ? d.id.elements[1].name
                : null;
            S.states.set(v, setter);
            if (setter) S.setters.set(setter, v);
            S.imports.add('ref');
            out.push(`const ${v} = ref(${initCode});`);
          } else if (name === 'useState') {
            ctx.todos.push('non-destructured useState — verify by hand');
            ctx.risky += 2;
            out.push('// TODO(human): non-destructured useState — port manually');
            out.push(`// ${sh.exprCode(stmt)}`);
          } else if (name === 'useRef' && t.isIdentifier(d.id)) {
            S.imports.add('ref');
            out.push(`const ${d.id.name} = ref(${initCode});`);
            ctx.todos.push(`useRef ${d.id.name} → ref() — verify template-ref vs value usage`);
            ctx.risky++;
          } else if (name === 'useMemo' && t.isIdentifier(d.id)) {
            S.imports.add('computed');
            out.push(`const ${d.id.name} = computed(${initCode});`);
            ctx.risky++;
          } else if (name === 'useCallback' && t.isIdentifier(d.id)) {
            out.push(`const ${d.id.name} = ${initCode};`);
            ctx.todos.push(
              `useCallback ${d.id.name} lost its memoization — verify it is not load-bearing`
            );
            ctx.risky++;
          } else if (name === 'useContext' && t.isIdentifier(d.id)) {
            S.imports.add('inject');
            const key = initArg && t.isIdentifier(initArg) ? initArg.name : 'Context';
            out.push(`const ${d.id.name} = inject('${key}');`);
            ctx.todos.push(`useContext → inject('${key}') — ensure an ancestor provides it`);
            ctx.risky++;
          } else {
            // useReducer or custom hook — no direct equivalent
            out.push(`// TODO(human): port ${name} manually — no direct Vue equivalent`);
            out.push(`${sh.exprCode(stmt)}`);
            ctx.todos.push(`${name} has no direct Vue equivalent — port to a composable`);
            ctx.risky += 2;
          }
          if (out.length) S.hookCode.set(stmt, out);
          continue;
        }
      }
    }
    if (t.isExpressionStatement(stmt) && sh.isHookCall(stmt.expression, 'useEffect')) {
      S.effectStmts.add(stmt);
    }
  }
}

function rewriteVueReads(fn, S) {
  // Never rewrite the function's own parameter patterns.
  const paramNodes = new Set();
  for (const p of fn.params) {
    sh.traverseSub(p, {
      Identifier(q) {
        paramNodes.add(q.node);
      },
    });
  }
  sh.traverseSub(fn, {
    VariableDeclarator(p) {
      if (S.replacedDecls.has(p.node)) p.skip();
    },
    CallExpression(p) {
      const cal = p.node.callee;
      if (t.isIdentifier(cal) && S.setters.has(cal.name)) {
        const v = S.setters.get(cal.name);
        const args = p.node.arguments;
        // Parent-first: rewrite reads inside the args before building the
        // assignment (use return values — the root itself may be replaced).
        for (let i = 0; i < args.length; i++)
          args[i] = rewriteReadsOnly(args[i], S, paramNodes);
        let rhs = null;
        if (
          args.length === 1 &&
          (t.isArrowFunctionExpression(args[0]) || t.isFunctionExpression(args[0])) &&
          args[0].params.length === 1 &&
          t.isIdentifier(args[0].params[0])
        ) {
          const param = args[0].params[0].name;
          const body = sh.replaceIdentInTree(
            args[0].body,
            param,
            () => t.memberExpression(t.identifier(v), t.identifier('value'))
          );
          if (t.isBlockStatement(body)) {
            const ret = body.body.find(s => t.isReturnStatement(s));
            rhs = ret ? ret.argument : null;
          } else {
            rhs = body;
          }
        } else if (args.length === 1) {
          rhs = args[0];
        }
        if (rhs) {
          p.replaceWith(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.identifier(v), t.identifier('value')),
              rhs
            )
          );
          p.skip();
        }
      }
    },
    Identifier(p) {
      const name = p.node.name;
      if (paramNodes.has(p.node)) return;
      if (!S.states.has(name)) return;
      if (!sh.isReadPosition(p)) return;
      if (sh.insideEffectDeps(p)) return; // watch() needs the ref itself
      p.replaceWith(t.memberExpression(t.identifier(name), t.identifier('value')));
      p.skip();
    },
  });
}

// Rewrite state reads (x → x.value) inside an already-detached subtree.
// Returns the current root — callers must use the return value.
function rewriteReadsOnly(node, S, paramNodes) {
  return sh.traverseSub(node, {
    Identifier(p) {
      const name = p.node.name;
      if (paramNodes.has(p.node)) return;
      if (!S.states.has(name)) return;
      if (!sh.isReadPosition(p)) return;
      p.replaceWith(t.memberExpression(t.identifier(name), t.identifier('value')));
      p.skip();
    },
  });
}

function convertEffectVue(stmt, S, ctx) {  const call = stmt.expression;
  const [cb, deps] = call.arguments;
  if (!cb || !(t.isArrowFunctionExpression(cb) || t.isFunctionExpression(cb))) {
    ctx.todos.push('non-inline useEffect callback — port manually');
    ctx.risky += 2;
    return ['// TODO(human): non-inline useEffect — port manually'];
  }
  const bodyStmts = t.isBlockStatement(cb.body)
    ? [...cb.body.body]
    : [t.expressionStatement(t.cloneNode(cb.body, true))];
  let main = bodyStmts;
  let cleanup = null;
  const last = bodyStmts[bodyStmts.length - 1];
  if (
    last &&
    t.isReturnStatement(last) &&
    last.argument &&
    (t.isArrowFunctionExpression(last.argument) || t.isFunctionExpression(last.argument))
  ) {
    main = bodyStmts.slice(0, -1);
    cleanup = last.argument;
  }
  const mainCode = main.map(s => sh.exprCode(s)).join('\n');
  if (!deps) {
    ctx.todos.push(
      'useEffect without a dependency array runs after every render — no direct equivalent; review manually'
    );
    ctx.risky += 2;
    return ['// TODO(human): useEffect without deps — runs every render; port manually'];
  }
  if (t.isArrayExpression(deps) && deps.elements.length === 0) {
    const out = [`onMounted(() => {\n${sh.indent(mainCode)}\n});`];
    S.lifecycle.add('onMounted');
    if (cleanup) {
      out.push(`onUnmounted(${sh.exprCode(cleanup)});`);
      S.lifecycle.add('onUnmounted');
    }
    return out;
  }
  if (t.isArrayExpression(deps)) {
    const depList = deps.elements.map(e => sh.exprCode(e)).join(', ');
    S.lifecycle.add('watch');
    if (cleanup)
      ctx.todos.push('effect cleanup on dependency change — verify with the watch onCleanup API');
    ctx.risky++;
    return [`watch([${depList}], () => {\n${sh.indent(mainCode)}\n});`];
  }
  ctx.todos.push('dynamic useEffect dependency array — port manually');
  ctx.risky += 2;
  return ['// TODO(human): dynamic useEffect deps — port manually'];
}

// ---------------------------------------------------------- class → Vue

function convertClassVue(comp, ast, ctx) {
  const cls = comp.node;
  ctx.todos.push(
    `class component ${comp.name} — lifecycle/state mapping needs review (see notes below)`
  );
  ctx.forceLow = true;

  const stateKeys = []; // {key, init}
  let renderJSX = null;
  const methods = [];
  for (const el of cls.body.body) {
    if (t.isClassMethod(el) && el.kind === 'constructor') {
      for (const s of el.body.body) {
        if (
          t.isExpressionStatement(s) &&
          t.isAssignmentExpression(s.expression, { operator: '=' }) &&
          t.isMemberExpression(s.expression.left) &&
          t.isThisExpression(s.expression.left.object) &&
          t.isIdentifier(s.expression.left.property, { name: 'state' }) &&
          t.isObjectExpression(s.expression.right)
        ) {
          for (const prop of s.expression.right.properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key))
              stateKeys.push({ key: prop.key.name, init: prop.value });
          }
        }
      }
    }
    if (t.isClassMethod(el) && el.kind === 'method' && t.isIdentifier(el.key)) {
      if (el.key.name === 'render') {
        const ret = el.body.body.find(s => t.isReturnStatement(s));
        if (
          ret &&
          ret.argument &&
          (t.isJSXElement(ret.argument) || t.isJSXFragment(ret.argument))
        )
          renderJSX = t.cloneNode(ret.argument, true);
      } else if (
        ['componentDidMount', 'componentDidUpdate', 'componentWillUnmount'].includes(el.key.name)
      ) {
        ctx.todos.push(`${el.key.name} → map to onMounted/onUnmounted manually`);
      } else {
        methods.push({ name: el.key.name, params: el.params, body: el.body });
      }
    } else if (
      t.isClassProperty(el) &&
      t.isIdentifier(el.key) &&
      (t.isArrowFunctionExpression(el.value) || t.isFunctionExpression(el.value))
    ) {
      methods.push({ name: el.key.name, params: el.value.params, body: el.value.body });
    }
  }

  const script = [];
  if (stateKeys.length)
    script.push(...stateKeys.map(s => `const ${s.key} = ref(${sh.exprCode(s.init)});`));
  const stateNames = new Set(stateKeys.map(s => s.key));
  // rewrite this.setState / this.state / this.props / this.m() across the AST
  rewriteClassMethodVue(ast, stateNames);
  for (const m of methods) {
    const params = m.params.map(p => sh.exprCode(p)).join(', ');
    const body = m.body.body.map(s => sh.exprCode(s)).join('\n');
    script.push(`function ${m.name}(${params}) {\n${sh.indent(body)}\n}`);
  }

  const cx = templateCtx(ctx);
  const template = renderJSX
    ? jsxToVue(stripThisForTemplate(renderJSX, stateNames), cx)
    : '<!-- no render() JSX found -->';
  if (!renderJSX) ctx.todos.push('no render() JSX found');

  const importLines = [`import { ref } from 'vue';`];
  if (cx.usesRouterLink) importLines.push(`import { RouterLink } from 'vue-router';`);
  const { kept: keptImps, dropped: droppedImps } = sh.keptImports(ast, ctx.blockedLibs);
  for (const d of droppedImps)
    ctx.todos.push(`import "${d}" dropped — blocked library, no ${ctx.to === 'vue' ? 'Vue' : 'Angular'} equivalent`);
  for (const imp of keptImps)
    importLines.push(sh.exprCode(imp).replace(/;$/, '') + ';');

  const head = sh.headerLines(ctx, `class component ${comp.name} — review lifecycle mapping`);
  const code =
    head +
    '<script setup>\n' +
    importLines.join('\n') +
    '\n' +
    (script.length ? script.join('\n') + '\n' : '') +
    '</script>\n\n<template>\n' +
    sh.indent(template) +
    '\n</template>\n';

  const outRel = ctx.rel.replace(/\.[jt]sx?$/, '.vue');
  return {
    rel: ctx.rel,
    kind: 'component-vue',
    outputs: [{ rel: outRel, code }],
    confidence: ctx.confidence,
    todos: ctx.todos,
  };
}

// Rewrite this.state.x → x.value, this.props.y → y inside a subtree.
// Returns the current root — callers must use the return value.
function rewriteThisRefsVue(node, stateNames) {
  const isThisStateProp = n =>
    t.isMemberExpression(n) &&
    t.isMemberExpression(n.object) &&
    t.isThisExpression(n.object.object) &&
    t.isIdentifier(n.object.property, { name: 'state' }) &&
    t.isIdentifier(n.property) &&
    stateNames.has(n.property.name);
  const isThisPropsProp = n =>
    t.isMemberExpression(n) &&
    t.isMemberExpression(n.object) &&
    t.isThisExpression(n.object.object) &&
    t.isIdentifier(n.object.property, { name: 'props' }) &&
    t.isIdentifier(n.property);
  return sh.traverseSub(node, {
    MemberExpression(p) {
      const n = p.node;
      if (isThisStateProp(n)) {
        p.replaceWith(
          t.memberExpression(t.identifier(n.property.name), t.identifier('value'))
        );
        p.skip();
        return;
      }
      if (isThisPropsProp(n)) {
        p.replaceWith(t.identifier(n.property.name));
        p.skip();
      }
    },
  });
}

// Rewrite class-method bodies in place: this.setState / this.state /
// this.props / this.method(). Traverses the whole AST once — the transforms
// are idempotent, so render/constructor are safe to include.
function rewriteClassMethodVue(ast, stateNames) {
  sh.traverseSub(ast, {
    ExpressionStatement(p) {
      // this.setState({x: 1}) → x.value = 1
      const e = p.node.expression;
      if (
        t.isCallExpression(e) &&
        t.isMemberExpression(e.callee) &&
        t.isThisExpression(e.callee.object) &&
        t.isIdentifier(e.callee.property, { name: 'setState' }) &&
        e.arguments[0] &&
        t.isObjectExpression(e.arguments[0])
      ) {
        const assigns = [];
        for (const pr of e.arguments[0].properties) {
          if (t.isObjectProperty(pr) && t.isIdentifier(pr.key)) {
            // values may reference this.state.* — rewrite before grafting,
            // because replaceWithMultiple nodes are not revisited
            pr.value = rewriteThisRefsVue(pr.value, stateNames);
            assigns.push(
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.memberExpression(t.identifier(pr.key.name), t.identifier('value')),
                  pr.value
                )
              )
            );
          }
        }
        if (assigns.length) p.replaceWithMultiple(assigns);
      }
    },
    CallExpression(p) {
      // this.method() → method()  (setState handled above)
      const cal = p.node.callee;
      if (
        t.isMemberExpression(cal) &&
        t.isThisExpression(cal.object) &&
        t.isIdentifier(cal.property) &&
        cal.property.name !== 'setState'
      ) {
        p.node.callee = t.identifier(cal.property.name);
      }
    },
    MemberExpression(p) {
      const n = p.node;
      // this.state.x → x.value
      if (
        t.isMemberExpression(n.object) &&
        t.isThisExpression(n.object.object) &&
        t.isIdentifier(n.object.property, { name: 'state' }) &&
        t.isIdentifier(n.property) &&
        stateNames.has(n.property.name)
      ) {
        p.replaceWith(
          t.memberExpression(t.identifier(n.property.name), t.identifier('value'))
        );
        p.skip();
        return;
      }
      // this.props.y → y
      if (
        t.isMemberExpression(n.object) &&
        t.isThisExpression(n.object.object) &&
        t.isIdentifier(n.object.property, { name: 'props' }) &&
        t.isIdentifier(n.property)
      ) {
        p.replaceWith(t.identifier(n.property.name));
        p.skip();
      }
    },
  });
}

// Template-side: this.state.x → x, this.props.y → y, this.m → m
function stripThisForTemplate(node, stateNames) {
  return sh.traverseSub(node, {
    MemberExpression(p) {
      const n = p.node;
      if (
        t.isMemberExpression(n.object) &&
        t.isThisExpression(n.object.object) &&
        t.isIdentifier(n.object.property) &&
        t.isIdentifier(n.property)
      ) {
        const holder = n.object.property.name;
        const key = n.property.name;
        if ((holder === 'state' && stateNames.has(key)) || holder === 'props') {
          p.replaceWith(t.identifier(key));
          p.skip();
        }
        return;
      }
      if (t.isThisExpression(n.object) && t.isIdentifier(n.property)) {
        const prop = n.property.name;
        if (stateNames.has(prop) || !['state', 'props', 'setState'].includes(prop)) {
          p.replaceWith(t.identifier(prop));
          p.skip();
        }
      }
    },
  });
  return node;
}

// ------------------------------------------------------- JSX → Vue template

function templateCtx(ctx) {
  return {
    todos: ctx.todos,
    riskyUp: () => ctx.risky++,
    usesRouterLink: false,
    vForKeys: new Set(),
  };
}

function jsxToVue(node, cx, extra) {
  extra = extra || [];
  if (t.isJSXFragment(node)) {
    const inner = node.children.map(c => childToVue(c, cx)).join('');
    if (!extra.length) return inner;
    return `<template ${extra.join(' ')}>${inner}</template>`;
  }
  if (!t.isJSXElement(node)) return '';
  const raw = sh.jsxName(node.openingElement.name);

  if (raw === 'Routes') {
    cx.todos.push('translate the <Routes> table into a vue-router routes array (see `rvo plan`)');
    return `<RouterView />`;
  }
  if (raw === 'Route') return '';

  let tag = raw;
  if (raw === 'Link') {
    tag = 'RouterLink';
    cx.usesRouterLink = true;
  } else if (/^[A-Z]/.test(raw)) {
    cx.todos.push(`custom component <${raw}> — ensure it is migrated and imported`);
    cx.riskyUp();
  }

  const attrs = node.openingElement.attributes
    .map(a => attrToVue(a, cx, tag))
    .filter(Boolean);
  const all = [...extra, ...attrs].filter(Boolean).join(' ');
  const children = node.children.map(c => childToVue(c, cx)).join('');
  if (node.openingElement.selfClosing && !children)
    return `<${tag}${all ? ' ' + all : ''} />`;
  return `<${tag}${all ? ' ' + all : ''}>${children}</${tag}>`;
}

function attrToVue(attr, cx, tag) {
  if (t.isJSXSpreadAttribute(attr)) return `v-bind="${sh.exprCode(attr.argument)}"`;
  const rawName = attr.name.name;
  const evt = /^on([A-Z])/.exec(rawName);
  const val = attr.value;
  const mapped =
    rawName === 'className' ? 'class' : rawName === 'htmlFor' ? 'for' : rawName;
  if (!val) return mapped;
  if (t.isStringLiteral(val)) {
    if (tag === 'RouterLink' && mapped === 'to') return `to="${val.value}"`;
    return `${mapped}="${val.value}"`;
  }
  if (!t.isJSXExpressionContainer(val)) return '';
  const expr = val.expression;
  if (t.isJSXEmptyExpression(expr)) return '';
  if (evt) {
    const evName = evt[1].toLowerCase() + rawName.slice(3);
    return `@${evName}="${handlerCode(expr)}"`;
  }
  if (rawName === 'dangerouslySetInnerHTML') {
    cx.todos.push('dangerouslySetInnerHTML → v-html — audit for XSS');
    cx.riskyUp();
    let inner = '""';
    if (t.isObjectExpression(expr)) {
      const p = expr.properties.find(
        pr => t.isObjectProperty(pr) && t.isIdentifier(pr.key, { name: '__html' })
      );
      if (p) inner = sh.exprCode(p.value);
    }
    return `v-html="${inner}"`;
  }
  if (rawName === 'style' && t.isObjectExpression(expr))
    return `:style="${sh.exprCode(expr)}"`;
  if (rawName === 'ref') {
    cx.todos.push('ref object → verify as a Vue template ref');
    cx.riskyUp();
    return t.isIdentifier(expr) ? `ref="${expr.name}"` : `:ref="${sh.exprCode(expr)}"`;
  }
  if (rawName === 'key') return `:key="${sh.exprCode(expr)}"`;
  if (tag === 'RouterLink' && mapped === 'to') return `:to="${sh.exprCode(expr)}"`;
  return `:${mapped}="${sh.exprCode(expr)}"`;
}

function handlerCode(expr) {
  if (t.isIdentifier(expr) || t.isMemberExpression(expr)) return sh.exprCode(expr);
  if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
    const params = expr.params.map(p => sh.exprCode(p)).join(', ');
    const body = t.isBlockStatement(expr.body)
      ? `{ ${expr.body.body.map(s => sh.exprCode(s)).join(' ')} }`
      : sh.exprCode(expr.body);
    return `(${params}) => ${body}`;
  }
  return sh.exprCode(expr);
}

function childToVue(child, cx) {
  if (t.isJSXText(child)) {
    const v = child.value;
    if (/^\s*$/.test(v)) return /\n/.test(v) ? '' : ' ';
    return v.replace(/\s+/g, ' ');
  }
  if (t.isJSXElement(child) || t.isJSXFragment(child)) return jsxToVue(child, cx);
  if (t.isJSXExpressionContainer(child)) {
    const expr = child.expression;
    if (t.isJSXEmptyExpression(expr)) return '';
    if (
      t.isLogicalExpression(expr, { operator: '&&' }) &&
      (t.isJSXElement(expr.right) || t.isJSXFragment(expr.right))
    ) {
      return jsxToVue(expr.right, cx, [`v-if="${sh.exprCode(expr.left)}"`]);
    }
    if (
      t.isConditionalExpression(expr) &&
      (t.isJSXElement(expr.consequent) || t.isJSXFragment(expr.consequent)) &&
      (t.isJSXElement(expr.alternate) || t.isJSXFragment(expr.alternate))
    ) {
      const c = sh.exprCode(expr.test);
      return (
        `<template v-if="${c}">${jsxToVue(expr.consequent, cx)}</template>` +
        `<template v-else>${jsxToVue(expr.alternate, cx)}</template>`
      );
    }
    const m = sh.asMapCall(expr);
    if (m) {
      const iter = m.index
        ? `(${m.item}, ${m.index}) in ${m.list}`
        : `${m.item} in ${m.list}`;
      const hasKey =
        t.isJSXElement(m.jsx) &&
        m.jsx.openingElement.attributes.some(
          a => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: 'key' })
        );
      const key = m.list + '|' + m.item;
      if (!hasKey && !cx.vForKeys.has(key)) {
        cx.todos.push('v-for list — add a stable :key');
        cx.vForKeys.add(key);
      }
      return jsxToVue(m.jsx, cx, [`v-for="${iter}"`]);
    }
    return `{{ ${sh.exprCode(expr)} }}`;
  }
  return '';
}

module.exports = { convertFunctionVue, convertClassVue };
