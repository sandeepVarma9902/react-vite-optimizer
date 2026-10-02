// Project scanning: parse every source file, collect imports/exports/components,
// and build the import graph used by the lazy-loading rule.
const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const { parse, JS_EXTS } = require('./utils');
const { eachComponent, getPropsInfo, getHooks } = require('./ast');

function resolveImport(fromFile, source) {
  if (!source.startsWith('.')) return null; // external package
  const base = path.resolve(path.dirname(fromFile), source);
  const cands = [base, ...JS_EXTS.map(e => base + e)];
  for (const c of cands) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {}
  }
  for (const e of JS_EXTS) {
    const idx = path.join(base, 'index' + e);
    try {
      if (fs.statSync(idx).isFile()) return idx;
    } catch {}
  }
  return null;
}

function libName(source) {
  if (source.startsWith('@')) return source.split('/').slice(0, 2).join('/');
  return source.split('/')[0];
}

function collectFileInfo(file, code, ast, config) {
  const info = {
    file,
    lineCount: code.split('\n').length,
    imports: [], // { source, specs: [{ kind: default|named|namespace, imported, local }] }
    components: [], // { name, kind, line, hasProps, propNames, hooks, exported }
    defaultExportName: null,
    usesRouter: false,
    heavyImports: [],
  };
  const exportedNames = new Set();

  traverse(ast, {
    ImportDeclaration(p) {
      const source = p.node.source.value;
      const specs = p.node.specifiers.map(s => {
        if (t.isImportDefaultSpecifier(s))
          return { kind: 'default', imported: 'default', local: s.local.name };
        if (t.isImportNamespaceSpecifier(s))
          return { kind: 'namespace', imported: '*', local: s.local.name };
        return { kind: 'named', imported: s.imported.name, local: s.local.name };
      });
      info.imports.push({ source, specs });
      if (/react-router/.test(source)) info.usesRouter = true;
      if (!source.startsWith('.') && !source.startsWith('/')) {
        const lib = libName(source);
        if (config.heavyLibs.includes(lib) && !info.heavyImports.includes(lib))
          info.heavyImports.push(lib);
      }
    },
    ExportDefaultDeclaration(p) {
      let d = p.node.declaration;
      while (
        t.isCallExpression(d) &&
        t.isIdentifier(d.callee, { name: 'memo' }) &&
        d.arguments.length
      )
        d = d.arguments[0];
      if (t.isIdentifier(d)) info.defaultExportName = d.name;
      else if (
        (t.isFunctionDeclaration(d) ||
          t.isFunctionExpression(d) ||
          t.isClassDeclaration(d)) &&
        d.id
      )
        info.defaultExportName = d.id.name;
    },
    ExportNamedDeclaration(p) {
      const d = p.node.declaration;
      if (t.isFunctionDeclaration(d) && d.id) exportedNames.add(d.id.name);
      else if (t.isClassDeclaration(d) && d.id) exportedNames.add(d.id.name);
      else if (t.isVariableDeclaration(d))
        d.declarations.forEach(x => {
          if (t.isIdentifier(x.id)) exportedNames.add(x.id.name);
        });
      p.node.specifiers.forEach(s => {
        if (t.isIdentifier(s.exported)) exportedNames.add(s.exported.name);
      });
    },
  });

  eachComponent(ast, ({ name, kind, node, fnPath, alreadyMemo }) => {
    const { hasProps, names } = getPropsInfo(fnPath);
    info.components.push({
      name,
      kind,
      line: node.loc.start.line,
      hasProps,
      propNames: names,
      hooks: getHooks(fnPath),
      exported: exportedNames.has(name) || info.defaultExportName === name,
      alreadyMemo: !!alreadyMemo,
    });
  });

  return info;
}

function buildProject(root, config) {
  const srcDir = path.join(root, config.srcDir);
  const files = new Map();
  if (fs.existsSync(srcDir)) {
    const entries = fg.sync('**/*.{js,jsx,ts,tsx,mjs,cjs}', {
      cwd: srcDir,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.d.ts',
        '**/dist/**',
      ],
    });
    for (const f of entries) {
      const code = fs.readFileSync(f, 'utf8');
      try {
        const ast = parse(code, f);
        files.set(f, collectFileInfo(f, code, ast, config));
      } catch {
        continue; // unparseable or invalid scope (e.g. duplicate declarations) -> skip file
      }
    }
  }
  // importers: resolved target file -> [{ from, local, kind, imported, source }]
  const importers = new Map();
  for (const [f, info] of files) {
    for (const imp of info.imports) {
      const target = resolveImport(f, imp.source);
      if (!target || !files.has(target)) continue;
      if (!importers.has(target)) importers.set(target, []);
      for (const s of imp.specs)
        importers.get(target).push({
          from: f,
          local: s.local,
          kind: s.kind,
          imported: s.imported,
          source: imp.source,
        });
    }
  }
  return { root, files, importers };
}

module.exports = { buildProject, collectFileInfo, resolveImport };
