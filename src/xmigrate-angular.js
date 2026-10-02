// Angular target for rvo migrate --to angular: function components →
// standalone @Component classes with signals; class components map naturally.
const sh = require('./xmigrate-shared');
const { t, traverse } = sh;

// ------------------------------------------------------- function → Angular

function convertFunctionAngular(comp, ast, ctx) {
  const fn = comp.node;
  const S = {
    states: new Map(), // var -> setter
    setters: new Map(), // setter -> var
    propNames: [],
    propsObj: null,
    hookCode: new Map(), // stmt -> {kind:'field'|'method'|'init', code}
    effectStmts: new Set(), // useEffect ExpressionStatements
    replacedDecls: new Set(),
    needsOnInit: false,
    usesRouterLink: false,
  };

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

  // Template source: pre-rewrite clone of the return JSX.
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

  collectHooksAngular(stmts, S, ctx);
  // Setters passed as values (onChange={setX}) lose their declaration —
  // keep a compat method so those references still resolve.
  const setterWrappers = [];
  const setterWrapperNames = new Set();
  for (const [setter, v] of S.setters) {
    if (sh.isReferencedAsValue(fn, setter)) {
      setterWrappers.push(`  ${setter}(v: any): void {\n    this.${v}.set(v);\n  }`);
      setterWrapperNames.add(setter);
    }
  }
  rewriteAngularReads(fn, S);

  // ---- class members
  const fields = [];
  const methods = [...setterWrappers];
  const initBody = [];
  for (const pn of S.propNames) fields.push(`  ${pn} = input<any>();`);
  if (S.propNames.length) S.usesInput = true;

  for (const stmt of stmts) {
    if (S.hookCode.has(stmt)) {
      const h = S.hookCode.get(stmt);
      if (h.kind === 'field') fields.push(h.code);
      else if (h.kind === 'method') methods.push(h.code);
      else initBody.push(h.code);
      continue;
    }
    if (S.effectStmts.has(stmt)) {
      const conv = convertEffectAngular(stmt, S, ctx);
      if (conv) initBody.push(conv);
      continue;
    }
    if (
      t.isReturnStatement(stmt) &&
      stmt.argument &&
      (t.isJSXElement(stmt.argument) || t.isJSXFragment(stmt.argument))
    )
      continue; // → template
    if (t.isReturnStatement(stmt)) {
      ctx.todos.push('non-JSX return in component — verify control flow');
      ctx.risky++;
      continue;
    }
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      methods.push(methodFromFn(stmt.id.name, stmt.params, stmt.body));
      continue;
    }
    if (
      t.isVariableDeclaration(stmt) &&
      stmt.declarations.length === 1 &&
      t.isIdentifier(stmt.declarations[0].id) &&
      (t.isArrowFunctionExpression(stmt.declarations[0].init) ||
        t.isFunctionExpression(stmt.declarations[0].init))
    ) {
      const d = stmt.declarations[0];
      methods.push(methodFromFn(d.id.name, d.init.params, d.init.body));
      continue;
    }
    if (t.isVariableDeclaration(stmt)) {
      // plain const → field (semantics: initialized once — flag it)
      for (const d of stmt.declarations) {
        if (t.isIdentifier(d.id) && d.init) {
          fields.push(`  ${d.id.name} = ${sh.exprCode(d.init)};`);
          ctx.todos.push(`"${d.id.name}" became a class field — verify initialization timing`);
          ctx.risky++;
        }
      }
      continue;
    }
    ctx.todos.push(`unmapped statement kept as comment: ${sh.exprCode(stmt).slice(0, 60)}`);
    initBody.push(`  // TODO(human): port manually — ${sh.exprCode(stmt)}`);
    ctx.risky++;
  }

  // ---- template
  const cx = { todos: ctx.todos, riskyUp: () => ctx.risky++, usesRouterLink: false, vForKeys: new Set() };
  const sigNames = new Set([...S.states.keys(), ...S.propNames]);
  // setter wrappers take the event value: (change)="setX($event)"
  cx.setterNames = setterWrapperNames;
  let template;
  if (returnJSX) {
    template = jsxToAngular(returnJSX, cx, sigNames);
  } else {
    ctx.todos.push('no JSX return found — template left empty');
    ctx.forceLow = true;
    template = '<!-- no JSX return found -->';
  }
  if (cx.usesRouterLink) {
    ctx.todos.push('install @angular/router and register routes (see `rvo plan` scaffold)');
    S.usesRouterLink = true;
  }

  // ---- component.ts
  const base = ctx.rel.replace(/\.[jt]sx?$/, '');
  const kebabName = sh.kebab(base.split('/').pop());
  const className = `${(comp.name || 'App').replace(/[^A-Za-z0-9_$]/g, '')}Component`;
  const coreImports = ['Component'];
  if (S.states.size) coreImports.push('signal');
  if (S.usesInput) coreImports.push('input');
  if (S.needsOnInit) coreImports.push('OnInit');
  const ngImports = [];
  if (S.usesRouterLink) ngImports.push('RouterLink');

  const importLines = [
    `import { ${coreImports.join(', ')} } from '@angular/core';`,
  ];
  if (ngImports.length)
    importLines.push(`import { ${ngImports.join(', ')} } from '@angular/router';`);
  const { kept: keptImps, dropped: droppedImps } = sh.keptImports(ast, ctx.blockedLibs);
  for (const d of droppedImps)
    ctx.todos.push(`import "${d}" dropped — blocked library, no ${ctx.to === 'vue' ? 'Vue' : 'Angular'} equivalent`);
  for (const imp of keptImps)
    importLines.push(sh.exprCode(imp).replace(/;$/, '') + ';');

  const decoratorImports = ngImports.length ? `\n  imports: [${ngImports.join(', ')}],` : '';
  const members = [];
  if (fields.length) members.push(fields.join('\n'));
  if (S.needsOnInit) {
    members.push(
      `  ngOnInit(): void {\n${sh.indent(initBody.join('\n'), 4)}\n  }`
    );
  } else if (initBody.length) {
    ctx.todos.push('effect without ngOnInit slot — verify placement');
    members.push(
      `  // TODO(human): effect body — verify placement\n${initBody.map(l => '  ' + l).join('\n')}`
    );
  }
  if (methods.length) members.push(methods.join('\n\n'));

  const head = sh.headerLines(ctx, `function component ${comp.name || 'default'}`);
  const tsCode =
    head +
    importLines.join('\n') +
    '\n\n' +
    '@Component({\n' +
    `  selector: 'app-${kebabName}',\n` +
    '  standalone: true,' +
    decoratorImports +
    `\n  templateUrl: './${kebabName}.component.html',\n` +
    '})\n' +
    `export class ${className}${S.needsOnInit ? ' implements OnInit' : ''} {\n` +
    members.join('\n\n') +
    '\n}\n';

  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
  const prefix = dir ? dir + '/' : '';
  return {
    rel: ctx.rel,
    kind: 'component-angular',
    outputs: [
      { rel: `${prefix}${kebabName}.component.ts`, code: tsCode },
      { rel: `${prefix}${kebabName}.component.html`, code: template + '\n' },
    ],
    confidence: ctx.confidence,
    todos: ctx.todos,
  };
}

function methodFromFn(name, params, body) {
  const p = params.map(x => sh.exprCode(x)).join(', ');
  const b = t.isBlockStatement(body)
    ? body.body.map(s => sh.exprCode(s)).join('\n')
    : `return ${sh.exprCode(body)};`;
  return `  ${name}(${p}): void {\n${sh.indent(b, 4)}\n  }`;
}

function collectHooksAngular(stmts, S, ctx) {
  for (const stmt of stmts) {
    if (t.isVariableDeclaration(stmt) && stmt.declarations.length === 1) {
      const d = stmt.declarations[0];
      if (t.isCallExpression(d.init)) {
        const name = sh.hookName(d.init.callee);
        if (name && (sh.KNOWN_HOOKS.has(name) || /^use[A-Z]/.test(name))) {
          S.replacedDecls.add(d);
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
            S.hookCode.set(stmt, { kind: 'field', code: `  ${v} = signal(${initCode});` });
          } else if (name === 'useRef' && t.isIdentifier(d.id)) {
            S.hookCode.set(stmt, { kind: 'field', code: `  ${d.id.name} = signal(${initCode});` });
            ctx.todos.push(`useRef ${d.id.name} → signal() — verify template-ref vs value usage`);
            ctx.risky++;
          } else if (name === 'useMemo' && t.isIdentifier(d.id)) {
            S.hookCode.set(stmt, { kind: 'field', code: `  // TODO(human): useMemo → computed(); verify laziness\n  ${d.id.name} = signal(${initCode});` });
            ctx.todos.push(`useMemo ${d.id.name} → signal() — computed() may fit better; verify`);
            ctx.risky++;
          } else if (name === 'useCallback' && t.isIdentifier(d.id)) {
            S.hookCode.set(stmt, { kind: 'method', code: methodFromFn(d.id.name, d.init.arguments[0] ? d.init.arguments[0].params : [], d.init.arguments[0] ? d.init.arguments[0].body : t.blockStatement([])) });
            ctx.todos.push(`useCallback ${d.id.name} lost its memoization — verify it is not load-bearing`);
            ctx.risky++;
          } else if (name === 'useContext' && t.isIdentifier(d.id)) {
            S.hookCode.set(stmt, { kind: 'field', code: `  // TODO(human): useContext → inject an Angular service\n  ${d.id.name}: any;` });
            ctx.todos.push('useContext → inject an @Injectable service providing this state');
            ctx.risky++;
          } else {
            S.hookCode.set(stmt, { kind: 'field', code: `  // TODO(human): port ${name} manually — no direct Angular equivalent\n  // ${sh.exprCode(stmt)}` });
            ctx.todos.push(`${name} has no direct Angular equivalent — port manually`);
            ctx.risky += 2;
          }
          continue;
        }
      }
    }
    if (t.isExpressionStatement(stmt) && sh.isHookCall(stmt.expression, 'useEffect')) {
      S.effectStmts.add(stmt);
    }
  }
}

// Rewrite state/prop reads inside a detached subtree for Angular.
// Returns the current root — callers must use the return value.
function rewriteReadsOnlyAngular(node, S, paramNodes) {
  const makeCall = name =>
    t.callExpression(t.memberExpression(t.thisExpression(), t.identifier(name)), []);
  return sh.traverseSub(node, {
    Identifier(p) {
      const name = p.node.name;
      if (paramNodes.has(p.node)) return;
      if (!sh.isReadPosition(p)) return;
      if (S.states.has(name) || S.propNames.includes(name)) {
        p.replaceWith(makeCall(name));
        p.skip();
      }
    },
  });
}

// Rewrite this.state.x → this.x(), this.props.y → this.y() inside a subtree.
// Returns the current root — callers must use the return value.
function rewriteThisRefsAngular(node, stateNames) {
  const match = n =>
    t.isMemberExpression(n) &&
    t.isMemberExpression(n.object) &&
    t.isThisExpression(n.object.object) &&
    t.isIdentifier(n.object.property) &&
    ['state', 'props'].includes(n.object.property.name) &&
    t.isIdentifier(n.property) &&
    (n.object.property.name === 'props' || stateNames.has(n.property.name));
  const makeCall = n =>
    t.callExpression(
      t.memberExpression(t.thisExpression(), t.identifier(n.property.name)),
      []
    );
  return sh.traverseSub(node, {
    MemberExpression(p) {
      if (match(p.node)) {
        p.replaceWith(makeCall(p.node));
        p.skip();
      }
    },
  });
}

function rewriteAngularReads(fn, S) {
  const paramNodes = new Set();
  for (const p of fn.params) {
    sh.traverseSub(p, { Identifier(q) { paramNodes.add(q.node); } });
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
        // Parent-first: rewrite reads inside args before building set/update.
        for (let i = 0; i < args.length; i++)
          args[i] = rewriteReadsOnlyAngular(args[i], S, paramNodes);
        const target = t.memberExpression(t.thisExpression(), t.identifier(v));
        if (
          args.length === 1 &&
          (t.isArrowFunctionExpression(args[0]) || t.isFunctionExpression(args[0]))
        ) {
          p.replaceWith(
            t.callExpression(t.memberExpression(target, t.identifier('update')), [args[0]])
          );
        } else if (args.length === 1) {
          p.replaceWith(
            t.callExpression(t.memberExpression(target, t.identifier('set')), [args[0]])
          );
        }
        p.skip();
        return;
      }
    },
    Identifier(p) {
      const name = p.node.name;
      if (paramNodes.has(p.node)) return;
      // props.title → this.title()
      if (
        S.propsObj &&
        name === S.propsObj &&
        t.isMemberExpression(p.parent) &&
        p.parent.object === p.node &&
        t.isIdentifier(p.parent.property)
      ) {
        const prop = p.parent.property.name;
        p.parentPath.replaceWith(
          t.callExpression(t.memberExpression(t.thisExpression(), t.identifier(prop)), [])
        );
        p.skip();
        return;
      }
      if (!sh.isReadPosition(p)) return;
      if (sh.insideEffectDeps(p)) return;
      if (S.states.has(name)) {
        p.replaceWith(
          t.callExpression(t.memberExpression(t.thisExpression(), t.identifier(name)), [])
        );
        p.skip();
        return;
      }
      if (S.propNames.includes(name)) {
        p.replaceWith(
          t.callExpression(t.memberExpression(t.thisExpression(), t.identifier(name)), [])
        );
        p.skip();
      }
    },
  });
}

function convertEffectAngular(stmt, S, ctx) {
  const call = stmt.expression;
  const [cb, deps] = call.arguments;
  if (!cb || !(t.isArrowFunctionExpression(cb) || t.isFunctionExpression(cb))) {
    ctx.todos.push('non-inline useEffect callback — port manually');
    ctx.risky += 2;
    return null;
  }
  const bodyStmts = t.isBlockStatement(cb.body)
    ? [...cb.body.body]
    : [t.expressionStatement(t.cloneNode(cb.body, true))];
  // drop cleanup returns (flag them)
  const last = bodyStmts[bodyStmts.length - 1];
  let main = bodyStmts;
  if (
    last &&
    t.isReturnStatement(last) &&
    last.argument &&
    (t.isArrowFunctionExpression(last.argument) || t.isFunctionExpression(last.argument))
  ) {
    main = bodyStmts.slice(0, -1);
    ctx.todos.push('effect cleanup → ngOnDestroy — port manually');
  }
  const code = main.map(s => sh.exprCode(s)).join('\n');
  if (!deps) {
    ctx.todos.push('useEffect without deps runs after every render — no direct equivalent; review');
    ctx.risky += 2;
    return null;
  }
  if (t.isArrayExpression(deps) && deps.elements.length === 0) {
    S.needsOnInit = true;
    return code;
  }
  ctx.todos.push('useEffect with dependencies → consider effect() from @angular/core');
  ctx.risky++;
  return `// TODO(human): useEffect([deps]) → effect() — port manually\n// ${code.split('\n').join('\n// ')}`;
}

// ---------------------------------------------------------- class → Angular

function convertClassAngular(comp, ast, ctx) {
  const cls = comp.node;
  ctx.todos.push(`class component ${comp.name} — verify the signal/input mapping below`);
  ctx.forceLow = true;

  const stateKeys = []; // {key, init}
  let renderJSX = null;
  const methods = [];
  let didMount = null;
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
      } else if (el.key.name === 'componentDidMount') {
        didMount = el;
      } else if (
        ['componentDidUpdate', 'componentWillUnmount'].includes(el.key.name)
      ) {
        ctx.todos.push(`${el.key.name} → map to ngOnChanges/ngOnDestroy manually`);
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

  const stateNames = new Set(stateKeys.map(s => s.key));
  const fields = stateKeys.map(s => `  ${s.key} = signal(${sh.exprCode(s.init)});`);
  // props used via this.props.X → inputs (discovered from render + methods)
  const propNames = new Set();
  const scanTargets = methods.map(m => m.body);
  if (didMount) scanTargets.push(didMount);
  if (renderJSX) scanTargets.push(renderJSX);
  for (const n of scanTargets) {
    sh.traverseSub(n, {
      MemberExpression(p) {
        const m = p.node;
        if (
          t.isMemberExpression(m.object) &&
          t.isThisExpression(m.object.object) &&
          t.isIdentifier(m.object.property, { name: 'props' }) &&
          t.isIdentifier(m.property)
        ) {
          propNames.add(m.property.name);
        }
      },
    });
  }
  for (const pn of propNames) fields.push(`  ${pn} = input<any>();`);

  const sigNames = new Set([...stateNames, ...propNames]);
  // single AST pass — rewrites this.setState/this.state/this.props/this.m()
  rewriteClassMethodAngular(ast, stateNames, propNames);

  const memberCodes = [...fields];
  if (didMount) {
    const body = didMount.body.body.map(s => sh.exprCode(s)).join('\n');
    memberCodes.push(`  ngOnInit(): void {\n${sh.indent(body, 4)}\n  }`);
  }
  for (const m of methods) {
    const params = m.params.map(p => sh.exprCode(p)).join(', ');
    const body = m.body.body.map(s => sh.exprCode(s)).join('\n');
    memberCodes.push(`  ${m.name}(${params}): void {\n${sh.indent(body, 4)}\n  }`);
  }

  const cx = { todos: ctx.todos, riskyUp: () => ctx.risky++, usesRouterLink: false, vForKeys: new Set() };
  const template = renderJSX
    ? jsxToAngular(stripThisAngular(renderJSX), cx, sigNames)
    : '<!-- no render() JSX found -->';
  if (!renderJSX) ctx.todos.push('no render() JSX found');
  if (cx.usesRouterLink) ctx.todos.push('install @angular/router and register routes (see `rvo plan` scaffold)');

  const base = ctx.rel.replace(/\.[jt]sx?$/, '');
  const kebabName = sh.kebab(base.split('/').pop());
  const className = `${comp.name.replace(/[^A-Za-z0-9_$]/g, '')}Component`;
  const coreImports = ['Component'];
  if (stateKeys.length) coreImports.push('signal');
  if (propNames.size) coreImports.push('input');
  if (didMount) coreImports.push('OnInit');

  const importLines = [`import { ${coreImports.join(', ')} } from '@angular/core';`];
  if (cx.usesRouterLink) importLines.push(`import { RouterLink } from '@angular/router';`);
  const { kept: keptImps, dropped: droppedImps } = sh.keptImports(ast, ctx.blockedLibs);
  for (const d of droppedImps)
    ctx.todos.push(`import "${d}" dropped — blocked library, no ${ctx.to === 'vue' ? 'Vue' : 'Angular'} equivalent`);
  for (const imp of keptImps)
    importLines.push(sh.exprCode(imp).replace(/;$/, '') + ';');

  const decoratorImports = cx.usesRouterLink ? `\n  imports: [RouterLink],` : '';
  const head = sh.headerLines(ctx, `class component ${comp.name} — verify signal/input mapping`);
  const tsCode =
    head +
    importLines.join('\n') +
    '\n\n' +
    '@Component({\n' +
    `  selector: 'app-${kebabName}',\n` +
    '  standalone: true,' +
    decoratorImports +
    `\n  templateUrl: './${kebabName}.component.html',\n` +
    '})\n' +
    `export class ${className}${didMount ? ' implements OnInit' : ''} {\n` +
    memberCodes.join('\n\n') +
    '\n}\n';

  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
  const prefix = dir ? dir + '/' : '';
  return {
    rel: ctx.rel,
    kind: 'component-angular',
    outputs: [
      { rel: `${prefix}${kebabName}.component.ts`, code: tsCode },
      { rel: `${prefix}${kebabName}.component.html`, code: template + '\n' },
    ],
    confidence: ctx.confidence,
    todos: ctx.todos,
  };
}

// Rewrite class-method bodies in place across the whole AST — the
// setState/this.* transforms are idempotent, so render/constructor are safe.
function rewriteClassMethodAngular(ast, stateNames, propNames) {
  sh.traverseSub(ast, {
    ExpressionStatement(p) {
      // this.setState({x: 1}) → this.x.set(1)
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
            // values may reference this.state.* — rewrite before grafting
            pr.value = rewriteThisRefsAngular(pr.value, stateNames);
            assigns.push(
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(
                    t.memberExpression(t.thisExpression(), t.identifier(pr.key.name)),
                    t.identifier('set')
                  ),
                  [pr.value]
                )
              )
            );
          }
        }
        if (assigns.length) p.replaceWithMultiple(assigns);
      }
    },
    MemberExpression(p) {
      const n = p.node;
      // this.state.x → this.x()
      if (
        t.isMemberExpression(n.object) &&
        t.isThisExpression(n.object.object) &&
        t.isIdentifier(n.object.property, { name: 'state' }) &&
        t.isIdentifier(n.property) &&
        stateNames.has(n.property.name)
      ) {
        p.replaceWith(
          t.callExpression(
            t.memberExpression(t.thisExpression(), t.identifier(n.property.name)),
            []
          )
        );
        p.skip();
        return;
      }
      // this.props.y → this.y()
      if (
        t.isMemberExpression(n.object) &&
        t.isThisExpression(n.object.object) &&
        t.isIdentifier(n.object.property, { name: 'props' }) &&
        t.isIdentifier(n.property) &&
        propNames.has(n.property.name)
      ) {
        p.replaceWith(
          t.callExpression(
            t.memberExpression(t.thisExpression(), t.identifier(n.property.name)),
            []
          )
        );
        p.skip();
      }
    },
  });
}

function stripThisAngular(node) {
  return sh.traverseSub(node, {
    MemberExpression(p) {
      const n = p.node;
      if (
        t.isMemberExpression(n.object) &&
        t.isThisExpression(n.object.object) &&
        t.isIdentifier(n.object.property) &&
        t.isIdentifier(n.property) &&
        ['state', 'props'].includes(n.object.property.name)
      ) {
        p.replaceWith(t.identifier(n.property.name));
        p.skip();
        return;
      }
      if (t.isThisExpression(n.object) && t.isIdentifier(n.property)) {
        p.replaceWith(t.identifier(n.property.name));
        p.skip();
      }
    },
  });
  return node;
}

// Wrap signal/input reads in template expressions: x → x()
function anglicize(node, names) {
  const clone = t.cloneNode(node, true);
  return sh.traverseSub(clone, {
    Identifier(p) {
      if (!names.has(p.node.name)) return;
      if (!sh.isReadPosition(p)) return;
      p.replaceWith(t.callExpression(t.identifier(p.node.name), []));
      p.skip();
    },
  });
}

function angCode(node, names) {
  return sh.exprCode(anglicize(node, names));
}

// ------------------------------------------------------- JSX → Angular template

function jsxToAngular(node, cx, sigNames, extra) {
  extra = extra || [];
  if (t.isJSXFragment(node)) {
    const inner = node.children.map(c => childToAngular(c, cx, sigNames)).join('');
    if (!extra.length) return inner;
    return `<ng-container ${extra.join(' ')}>${inner}</ng-container>`;
  }
  if (!t.isJSXElement(node)) return '';
  const raw = sh.jsxName(node.openingElement.name);

  if (raw === 'Routes') {
    cx.todos.push('translate the <Routes> table into an Angular Routes array (see `rvo plan`)');
    return `<router-outlet />`;
  }
  if (raw === 'Route') return '';

  let tag = raw;
  let linkTo = null;
  if (raw === 'Link') {
    tag = 'a';
    cx.usesRouterLink = true;
    const toAttr = node.openingElement.attributes.find(
      a => t.isJSXAttribute(a) && a.name.name === 'to'
    );
    if (toAttr) linkTo = toAttr.value;
  } else if (/^[A-Z]/.test(raw)) {
    cx.todos.push(`custom component <${raw}> — ensure it is migrated and declared/imported`);
    cx.riskyUp();
    tag = 'app-' + sh.kebab(raw);
  } else {
    tag = raw.toLowerCase();
  }

  const attrs = node.openingElement.attributes
    .map(a => attrToAngular(a, cx, sigNames, tag, raw, linkTo))
    .filter(Boolean);
  if (linkTo) {
    if (t.isStringLiteral(linkTo)) attrs.unshift(`[routerLink]="['${linkTo.value}']"`);
    else if (t.isJSXExpressionContainer(linkTo))
      attrs.unshift(`[routerLink]="${angCode(linkTo.expression, sigNames)}"`);
  }
  const all = [...extra, ...attrs].filter(Boolean).join(' ');
  const children = node.children.map(c => childToAngular(c, cx, sigNames)).join('');
  if (node.openingElement.selfClosing && !children)
    return `<${tag}${all ? ' ' + all : ''} />`;
  return `<${tag}${all ? ' ' + all : ''}>${children}</${tag}>`;
}

function attrToAngular(attr, cx, sigNames, tag, raw, linkTo) {
  if (t.isJSXSpreadAttribute(attr)) {
    cx.todos.push('spread attributes have no direct equivalent — expand manually');
    cx.riskyUp();
    return '';
  }
  const rawName = attr.name.name;
  if (rawName === 'to' && raw === 'Link') return ''; // handled via [routerLink]
  const evt = /^on([A-Z])/.exec(rawName);
  const val = attr.value;
  const mapped =
    rawName === 'className' ? 'class' : rawName === 'htmlFor' ? 'for' : rawName;
  if (!val) return mapped;
  if (t.isStringLiteral(val)) return `${mapped}="${val.value}"`;
  if (!t.isJSXExpressionContainer(val)) return '';
  const expr = val.expression;
  if (t.isJSXEmptyExpression(expr)) return '';
  if (evt) {
    const evName = evt[1].toLowerCase() + rawName.slice(3);
    return `(${evName})="${angularHandler(expr, sigNames, cx)}"`;
  }
  if (rawName === 'dangerouslySetInnerHTML') {
    cx.todos.push('dangerouslySetInnerHTML → [innerHTML] — audit for XSS');
    cx.riskyUp();
    let inner = '""';
    if (t.isObjectExpression(expr)) {
      const p = expr.properties.find(
        pr => t.isObjectProperty(pr) && t.isIdentifier(pr.key, { name: '__html' })
      );
      if (p) inner = angCode(p.value, sigNames);
    }
    return `[innerHTML]="${inner}"`;
  }
  if (rawName === 'style' && t.isObjectExpression(expr))
    return `[ngStyle]="${angCode(expr, sigNames)}"`;
  if (rawName === 'key') {
    // consumed as the @for track expression by the map branch; drop silently
    return '';
  }
  if (rawName === 'ref') {
    cx.todos.push('ref object → verify as an Angular template reference variable');
    cx.riskyUp();
    return '';
  }
  if (mapped === 'class') return `[ngClass]="${angCode(expr, sigNames)}"`;
  return `[${mapped}]="${angCode(expr, sigNames)}"`;
}

function angularHandler(expr, sigNames, cx) {
  // a setter passed as the handler (onChange={setX}) needs the event value
  if (t.isIdentifier(expr) && cx && cx.setterNames && cx.setterNames.has(expr.name))
    return `${expr.name}($event)`;
  if (t.isIdentifier(expr)) return `${expr.name}()`;
  if (t.isMemberExpression(expr)) return `${angCode(expr, sigNames)}`;
  if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
    // () => doSomething(x) → doSomething(x): the wrapper adds nothing
    if (
      expr.params.length === 0 &&
      !t.isBlockStatement(expr.body) &&
      t.isCallExpression(expr.body)
    )
      return angCode(expr.body, sigNames);
    const params = expr.params.map(p => sh.exprCode(p)).join(', ');
    const body = t.isBlockStatement(expr.body)
      ? `{ ${expr.body.body.map(s => sh.exprCode(s)).join(' ')} }`
      : sh.exprCode(expr.body);
    return `(${params}) => ${body}`;
  }
  return angCode(expr, sigNames);
}

function childToAngular(child, cx, sigNames) {
  if (t.isJSXText(child)) {
    const v = child.value;
    if (/^\s*$/.test(v)) return /\n/.test(v) ? '' : ' ';
    return v.replace(/\s+/g, ' ');
  }
  if (t.isJSXElement(child) || t.isJSXFragment(child))
    return jsxToAngular(child, cx, sigNames);
  if (t.isJSXExpressionContainer(child)) {
    const expr = child.expression;
    if (t.isJSXEmptyExpression(expr)) return '';
    if (
      t.isLogicalExpression(expr, { operator: '&&' }) &&
      (t.isJSXElement(expr.right) || t.isJSXFragment(expr.right))
    ) {
      return `@if (${angCode(expr.left, sigNames)}) { ${jsxToAngular(expr.right, cx, sigNames)} }`;
    }
    if (
      t.isConditionalExpression(expr) &&
      (t.isJSXElement(expr.consequent) || t.isJSXFragment(expr.consequent)) &&
      (t.isJSXElement(expr.alternate) || t.isJSXFragment(expr.alternate))
    ) {
      const c = angCode(expr.test, sigNames);
      return (
        `@if (${c}) { ${jsxToAngular(expr.consequent, cx, sigNames)} } ` +
        `@else { ${jsxToAngular(expr.alternate, cx, sigNames)} }`
      );
    }
    const m = sh.asMapCall(expr);
    if (m) {
      const keyAttr =
        t.isJSXElement(m.jsx) &&
        m.jsx.openingElement.attributes.find(
          a => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: 'key' })
        );
      const track = keyAttr
        ? angCode(keyAttr.value.expression || keyAttr.value, sigNames)
        : '$index';
      const key = m.list + '|' + m.item;
      if (!keyAttr && !cx.vForKeys.has(key)) {
        cx.todos.push('@for loop — replace $index with a stable trackBy key');
        cx.vForKeys.add(key);
      }
      const iter = m.index
        ? `let ${m.item} of ${angCode(m.listNode, sigNames)}; let ${m.index} = $index`
        : `let ${m.item} of ${angCode(m.listNode, sigNames)}`;
      return `@for (${iter}; track ${track}) { ${jsxToAngular(m.jsx, cx, sigNames)} }`;
    }
    return `{{ ${angCode(expr, sigNames)} }}`;
  }
  return '';
}

module.exports = { convertFunctionAngular, convertClassAngular };
