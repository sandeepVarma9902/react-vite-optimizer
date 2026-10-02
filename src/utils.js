const fs = require('fs');
const path = require('path');
const readline = require('readline');
const parser = require('@babel/parser');

const JS_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

function parse(code, filename) {
  return parser.parse(code, {
    sourceType: 'module',
    errorRecovery: true,
    plugins: [
      'jsx',
      'typescript',
      'decorators-legacy',
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'dynamicImport',
      'optionalChaining',
      'nullishCoalescingOperator',
      'objectRestSpread',
      'topLevelAwait',
    ],
  });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findProjectRoot(dir) {
  let cur = path.resolve(dir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(cur, 'package.json'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(dir || process.cwd());
    cur = parent;
  }
}

function isViteProject(root) {
  let deps = {};
  try {
    const pkg = readJson(path.join(root, 'package.json'));
    deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  } catch {}
  return Boolean(
    deps.vite ||
      fs.existsSync(path.join(root, 'vite.config.js')) ||
      fs.existsSync(path.join(root, 'vite.config.ts')) ||
      fs.existsSync(path.join(root, 'vite.config.mjs'))
  );
}

function loadConfig(root) {
  const defaults = {
    srcDir: 'src',
    lazyDirs: ['pages', 'routes', 'views', 'screens'],
    heavyLibs: [
      'recharts', 'chart.js', 'three', 'd3', 'monaco-editor', '@monaco-editor/react',
      'pdfjs-dist', 'react-pdf', 'lodash', 'moment', 'antd', '@mui/material',
      '@mui/x-data-grid', 'framer-motion', 'react-leaflet', 'fabric', 'konva',
    ],
    minLinesForLazy: 150,
    lazy: true,
    memo: true,
    useMemo: true,
    // v1.2: advisory checks (analyze-only, never transformed by fix)
    bundle: true,
    images: true,
    bundleBudgetKb: 500, // flag dist chunks larger than this
    imageBudgetKb: 250, // hint for images larger than this
  };
  const p = path.join(root, '.rvorc.json');
  if (fs.existsSync(p)) {
    try {
      return { ...defaults, ...readJson(p) };
    } catch {}
  }
  return defaults;
}

const ALL_RULES = ['lazy', 'memo', 'usememo', 'bundle', 'images'];
// Rules that `rvo fix` can apply codemods for. bundle/images are analyze-only.
const FIXABLE_RULES = ['lazy', 'memo', 'usememo'];

function parseOnly(str) {
  if (!str) return ALL_RULES;
  const set = new Set(
    String(str).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  );
  return ALL_RULES.filter(r => set.has(r));
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} (y/N) `, ans => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

module.exports = {
  parse,
  readJson,
  findProjectRoot,
  isViteProject,
  loadConfig,
  parseOnly,
  confirm,
  JS_EXTS,
  ALL_RULES,
  FIXABLE_RULES,
};
