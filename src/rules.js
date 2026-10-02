// Detection rules: which components are good candidates for lazy-loading,
// React.memo and useMemo. Detection is pure — it never modifies files.
const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const { parse, ALL_RULES } = require('./utils');
const { findUseMemoOps } = require('./ast');

// A component is a lazy candidate when it has a default export, is imported
// somewhere, and looks "heavy": lives in a pages/routes-style directory,
// pulls in a heavy library, or is a large file.
function detectLazy(project, config) {
  const out = [];
  for (const [file, info] of project.files) {
    const segs = file.split(path.sep);
    const reasons = [];
    const lazyDir = config.lazyDirs.find(d => segs.includes(d));
    if (lazyDir) reasons.push(`lives in "${lazyDir}/"`);
    if (info.heavyImports.length)
      reasons.push(`imports heavy library (${info.heavyImports.join(', ')})`);
    if (info.lineCount >= config.minLinesForLazy)
      reasons.push(`large file (${info.lineCount} lines)`);
    if (!reasons.length) continue;
    for (const imp of project.importers.get(file) || []) {
      if (imp.from === file || imp.kind === 'namespace') continue;
      // The imported binding must be a component (default or named export).
      let isComponent = false;
      if (imp.kind === 'default' && info.defaultExportName)
        isComponent = info.components.some(c => c.name === info.defaultExportName);
      else if (imp.kind === 'named')
        isComponent = info.components.some(c => c.name === imp.imported);
      if (!isComponent) continue;
      const importerInfo = project.files.get(imp.from);
      const r = [...reasons];
      if (importerInfo && importerInfo.usesRouter) r.push('used with react-router');
      out.push({
        file: imp.from,
        targetFile: file,
        component: imp.local,
        importedName: imp.imported,
        source: imp.source,
        kind: imp.kind,
        reason: r.join('; '),
        severity: 'warning',
      });
    }
  }
  return out;
}

// Any top-level component that receives props and isn't already memoized.
function detectMemo(project) {
  const out = [];
  for (const [file, info] of project.files) {
    for (const c of info.components) {
      if (!c.hasProps || c.alreadyMemo) continue;
      out.push({
        file,
        name: c.name,
        kind: c.kind,
        line: c.line,
        props: c.propNames,
        exported: c.exported,
        severity: 'warning',
      });
    }
  }
  return out;
}

function detectUseMemo(project) {
  const out = [];
  for (const [file] of project.files) {
    try {
      const code = fs.readFileSync(file, 'utf8');
      const ast = parse(code, file);
      for (const op of findUseMemoOps(ast)) out.push({ file, severity: 'warning', ...op });
    } catch {
      continue; // unreadable file -> skip
    }
  }
  return out;
}

// Bundle-budget check (analyze-only): flag oversized JS chunks in dist/assets.
// Needs a prior `vite build`; silently skipped when there is no build output.
function detectBundle(root, config) {
  const out = [];
  const budget = config.bundleBudgetKb;
  if (!budget || budget <= 0) return out;
  const assetsDir = path.join(root, 'dist', 'assets');
  let entries;
  try {
    entries = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  } catch {
    return out; // no build output -> nothing to check
  }
  for (const chunk of entries) {
    const file = path.join(assetsDir, chunk);
    let sizeKb;
    try {
      sizeKb = fs.statSync(file).size / 1024;
    } catch {
      continue;
    }
    sizeKb = Math.round(sizeKb);
    const isEntry = /^(index|main|app)[.-]/i.test(chunk);
    if (sizeKb > budget) {
      out.push({
        file,
        chunk,
        sizeKb,
        budgetKb: budget,
        isEntry,
        severity: 'error',
        hint:
          `chunk is ${sizeKb} kB, over the ${budget} kB budget — ` +
          'consider code-splitting (React.lazy), tree-shaking, or trimming heavy dependencies',
      });
    } else if (sizeKb > budget * 0.8) {
      out.push({
        file,
        chunk,
        sizeKb,
        budgetKb: budget,
        isEntry,
        severity: 'warning',
        hint: `chunk is ${sizeKb} kB, over 80% of the ${budget} kB budget`,
      });
    }
  }
  return out;
}

// Image-optimization hints (analyze-only): flag large or legacy-format images.
function detectImages(root, config) {
  const out = [];
  const budget = config.imageBudgetKb;
  if (!budget || budget <= 0) return out;
  let files;
  try {
    files = fg.sync('**/*.{png,jpg,jpeg,bmp,tiff,webp,avif,gif}', {
      cwd: root,
      absolute: true,
      ignore: ['**/node_modules/**', '**/dist/**'],
    });
  } catch {
    return out;
  }
  for (const file of files) {
    let sizeKb;
    try {
      sizeKb = fs.statSync(file).size / 1024;
    } catch {
      continue;
    }
    sizeKb = Math.round(sizeKb);
    const format = path.extname(file).toLowerCase().slice(1);
    const hints = [];
    if (['bmp', 'tiff'].includes(format))
      hints.push('legacy format — convert to WebP or AVIF');
    if (sizeKb > budget && ['png', 'jpg', 'jpeg'].includes(format))
      hints.push(
        `large ${format.toUpperCase()} (${sizeKb} kB) — compress or convert to WebP/AVIF`
      );
    else if (sizeKb > budget)
      hints.push(`large image (${sizeKb} kB) — consider compressing`);
    if (!hints.length) continue;
    out.push({ file, sizeKb, format, severity: 'info', hint: hints.join('; ') });
  }
  return out;
}

function detectAll(project, config, only) {
  const rules = only && only.length ? only : ALL_RULES;
  const res = {
    lazy: [],
    memo: [],
    usememo: [],
    bundle: [],
    images: [],
    scannedFiles: project.files.size,
  };
  if (rules.includes('lazy') && config.lazy) res.lazy = detectLazy(project, config);
  if (rules.includes('memo') && config.memo) res.memo = detectMemo(project);
  if (rules.includes('usememo') && config.useMemo) res.usememo = detectUseMemo(project);
  if (rules.includes('bundle') && config.bundle)
    res.bundle = detectBundle(project.root, config);
  if (rules.includes('images') && config.images)
    res.images = detectImages(project.root, config);
  return res;
}

module.exports = {
  detectLazy,
  detectMemo,
  detectUseMemo,
  detectBundle,
  detectImages,
  detectAll,
};
