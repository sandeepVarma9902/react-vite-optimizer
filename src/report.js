const chalk = require('chalk');
const path = require('path');

const rel = (root, f) => path.relative(root, f) || f;

function section(icon, title, items, fmt) {
  console.log(chalk.bold(`\n${icon} ${title} (${items.length})`));
  if (!items.length) {
    console.log(chalk.dim('  none found'));
    return;
  }
  items.forEach(c => console.log('  • ' + fmt(c)));
}

function printReport(root, res, isVite) {
  console.log(chalk.bold.cyan('\nreact-vite-optimizer — analysis'));
  console.log(chalk.dim('  ' + root));
  console.log(
    isVite
      ? chalk.green('  ✓ Vite project detected')
      : chalk.yellow('  ! Not a Vite project — continuing anyway')
  );
  console.log(chalk.dim(`  Scanned ${res.scannedFiles} source file(s)`));

  section('⚡', 'Lazy-loading candidates', res.lazy, c =>
    `${chalk.cyan(rel(root, c.file))} → ${chalk.bold(c.component)} (from ${c.source}) — ${chalk.dim(c.reason)}`
  );
  section('🧠', 'React.memo candidates', res.memo, c =>
    `${chalk.cyan(rel(root, c.file))} — ${chalk.bold(c.name)} (line ${c.line}` +
    `${c.props.length ? ', props: ' + c.props.join(', ') : ', has props'})`
  );
  section('💾', 'useMemo candidates', res.usememo, c =>
    `${chalk.cyan(rel(root, c.file))} — ${chalk.bold(c.component)}: \`${c.name}\` ` +
    `(line ${c.line}, deps: [${c.deps.join(', ')}])`
  );
  section('📦', 'Bundle budget', res.bundle, c =>
    `${chalk.cyan(rel(root, c.file))} — ${chalk.bold(c.sizeKb + ' kB')}` +
    ` (budget ${c.budgetKb} kB${c.isEntry ? ', entry chunk' : ''}) — ${chalk.dim(c.hint)}`
  );
  section('🖼️', 'Image optimization hints', res.images, c =>
    `${chalk.cyan(rel(root, c.file))} — ${chalk.bold(c.sizeKb + ' kB ' + c.format.toUpperCase())} — ${chalk.dim(c.hint)}`
  );

  const total = res.lazy.length + res.memo.length + res.usememo.length;
  const advisory = (res.bundle || []).length + (res.images || []).length;
  console.log(
    total
      ? chalk.bold(`\n${total} optimization(s) found. Run ${chalk.cyan('rvo fix')} to apply them.`)
      : chalk.green('\nAlready optimized — nothing found.')
  );
  if (advisory)
    console.log(
      chalk.dim(
        `  + ${advisory} advisor${advisory === 1 ? 'y' : 'ies'} finding(s) (bundle/images) — hints above, no automatic fix.`
      )
    );
}

function printFixSummary(summary, dryRun) {
  console.log(
    chalk.bold.cyan(dryRun ? '\nDry run — no files were modified' : '\nFix summary')
  );
  const parts = [
    ['lazy-loading', summary.lazy],
    ['React.memo', summary.memo],
    ['useMemo', summary.usememo],
  ];
  for (const [label, s] of parts) {
    console.log(
      `  ${label}: ${chalk.green(s.applied + ' applied')}` +
        (s.skipped.length ? chalk.yellow(`, ${s.skipped.length} skipped`) : '')
    );
    s.skipped.forEach(x => {
      const name = x.cand ? x.cand.component || x.cand.name : '';
      console.log(chalk.dim(`    ↳ skipped ${name} in ${rel('', x.file)}: ${x.reason}`));
    });
  }
  if (summary.changedFiles.length) {
    console.log(chalk.bold('\nChanged files:'));
    summary.changedFiles.forEach(f => console.log('  • ' + f));
  }
  const appliedTotal =
    summary.lazy.applied + summary.memo.applied + summary.usememo.applied;
  const skippedTotal =
    summary.lazy.skipped.length +
    summary.memo.skipped.length +
    summary.usememo.skipped.length;
  if (!dryRun && !summary.changedFiles.length && !appliedTotal && skippedTotal)
    console.log(
      chalk.dim(
        '\nNothing applied — remaining candidates were skipped for safety (see reasons above).'
      )
    );
  if (!dryRun && summary.changedFiles.length)
    console.log(
      chalk.dim(
        '\nTip: run your tests or `vite build` to verify. Transforms are idempotent — running fix again is a no-op.'
      )
    );
}

function printUpdates(check) {
  const { results } = check;
  const updates = results.filter(r => r.status === 'update');
  const majors = results.filter(r => r.status === 'major-available');
  const errors = results.filter(r => r.status === 'error');
  const skipped = results.filter(r => r.status === 'skip');

  console.log(chalk.bold.cyan('\nDependency upgrade check'));
  if (updates.length) {
    console.log(chalk.bold(`\n⬆ Updates available (${updates.length})`));
    updates.forEach(u =>
      console.log(
        `  • ${chalk.bold(u.name)}  ${chalk.dim(u.current)} → ${chalk.green(u.latest)}` +
          chalk.dim(` (${u.group}${u.bump ? ', ' + u.bump : ''})`)
      )
    );
  } else {
    console.log(chalk.green('\n✓ No minor/patch updates available.'));
  }
  if (majors.length) {
    console.log(
      chalk.bold.yellow(
        `\n⚠ Major versions available (${majors.length}) — re-run with --include-major to apply`
      )
    );
    majors.forEach(u =>
      console.log(
        `  • ${chalk.bold(u.name)}  ${chalk.dim(u.current)} → ${chalk.yellow(u.latest)}`
      )
    );
  }
  skipped.forEach(s =>
    console.log(chalk.dim(`  · ${s.name}: skipped (${s.note})`))
  );
  errors.forEach(e => console.log(chalk.dim(`  ! ${e.name}: ${e.error}`)));
}

function countIssues(res) {
  return {
    lazy: res.lazy.length,
    memo: res.memo.length,
    usememo: res.usememo.length,
  };
}

const SEV_ORDER = { info: 0, warning: 1, error: 2 };
const ALL_GROUPS = ['lazy', 'memo', 'usememo', 'bundle', 'images'];

// Aggregate across all rule groups (fixable + advisory) for CI and reports.
function summarize(res) {
  const bySeverity = { info: 0, warning: 0, error: 0 };
  let total = 0;
  for (const g of ALL_GROUPS) {
    for (const f of res[g] || []) {
      total++;
      if (f.severity in bySeverity) bySeverity[f.severity]++;
    }
  }
  return { total, bySeverity };
}

// CI gate: fail when the issue count exceeds --max-issues, or when any
// finding is at/above --fail-on severity. Returns { pass, reasons }.
function ciVerdict(res, summary, opts) {
  const reasons = [];
  let maxIssues = 0;
  if (opts.maxIssues != null) {
    maxIssues = Number(opts.maxIssues);
    if (!Number.isFinite(maxIssues) || maxIssues < 0)
      return { pass: false, reasons: [`invalid --max-issues value: ${opts.maxIssues}`] };
  }
  if (summary.total > maxIssues)
    reasons.push(`${summary.total} issue(s) exceed --max-issues ${maxIssues}`);
  if (opts.failOn) {
    const lvl = String(opts.failOn).toLowerCase();
    if (!(lvl in SEV_ORDER))
      return {
        pass: false,
        reasons: [`invalid --fail-on severity: ${opts.failOn} (expected info|warning|error)`],
      };
    let hits = 0;
    for (const g of ALL_GROUPS)
      for (const f of res[g] || [])
        if (SEV_ORDER[f.severity] >= SEV_ORDER[lvl]) hits++;
    if (hits) reasons.push(`${hits} finding(s) at severity "${lvl}" or above`);
  }
  return { pass: reasons.length === 0, reasons };
}

function printCiVerdict(verdict, summary) {
  if (verdict.pass) {
    console.log(
      chalk.green(
        `\n✓ CI check passed — ${summary.total} issue(s) ` +
          `(info ${summary.bySeverity.info}, warning ${summary.bySeverity.warning}, error ${summary.bySeverity.error}).`
      )
    );
  } else {
    console.log(chalk.red('\n✗ CI check failed:'));
    verdict.reasons.forEach(r => console.log(chalk.red(`  • ${r}`)));
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlTable(title, rows, cols) {
  // cols: [header, key | accessorFn]
  if (!rows.length)
    return `<h2>${esc(title)} <span class="count">0</span></h2><p class="none">none found</p>`;
  const body = rows
    .map(
      r =>
        `<tr>${cols
          .map(([, c]) => `<td>${esc(typeof c === 'function' ? c(r) : r[c])}</td>`)
          .join('')}</tr>`
    )
    .join('\n');
  const head = cols.map(([h]) => `<th>${esc(h)}</th>`).join('');
  return `<h2>${esc(title)} <span class="count">${rows.length}</span></h2>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// Self-contained HTML report (no external assets) for CI artifacts / sharing.
function buildHtmlReport(root, res, isVite, summary) {
  const s = summary || summarize(res);
  const r = f => path.relative(root, f.file || f.targetFile || '') || f.file || '';
  const sevBadge = f =>
    `<span class="sev sev-${esc(f.severity || 'info')}">${esc(f.severity || 'info')}</span>`;
  const sections = [
    htmlTable('Lazy-loading candidates', res.lazy, [
      ['Finding', f => r(f) + ' → ' + f.component],
      ['Reason', 'reason'],
      ['Severity', sevBadge],
    ]),
    htmlTable('React.memo candidates', res.memo, [
      ['Finding', f => r(f) + ' — ' + f.name + ' (line ' + f.line + ')'],
      ['Props', f => (f.props && f.props.length ? f.props.join(', ') : 'has props')],
      ['Severity', sevBadge],
    ]),
    htmlTable('useMemo candidates', res.usememo, [
      ['Finding', f => r(f) + ' — ' + f.component + ': ' + f.name + ' (line ' + f.line + ')'],
      ['Deps', f => '[' + (f.deps || []).join(', ') + ']'],
      ['Severity', sevBadge],
    ]),
    htmlTable('Bundle budget', res.bundle, [
      ['Finding', f => r(f) + ' — ' + f.sizeKb + ' kB (budget ' + f.budgetKb + ' kB)'],
      ['Hint', 'hint'],
      ['Severity', sevBadge],
    ]),
    htmlTable('Image optimization hints', res.images, [
      ['Finding', f => r(f) + ' — ' + f.sizeKb + ' kB ' + String(f.format || '').toUpperCase()],
      ['Hint', 'hint'],
      ['Severity', sevBadge],
    ]),
  ].join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>rvo report — ${esc(path.basename(root))}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
h1{font-size:1.5rem} h2{font-size:1.15rem;margin-top:2rem}
.meta{color:#555} .badge{display:inline-block;padding:.15rem .6rem;border-radius:999px;font-size:.8rem}
.ok{background:#e6f7e6;color:#166534}.warn{background:#fef3c7;color:#92400e}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #e5e5e5;vertical-align:top}
th{background:#f8fafc} .count{background:#eef;color:#334155;border-radius:999px;padding:.1rem .55rem;font-size:.8rem}
.none{color:#888;font-style:italic}
.sev{border-radius:4px;padding:.1rem .45rem;font-size:.75rem;font-weight:600}
.sev-info{background:#e0f2fe;color:#075985}.sev-warning{background:#fef3c7;color:#92400e}.sev-error{background:#fee2e2;color:#991b1b}
.cards{display:flex;gap:.75rem;margin:1rem 0}.card{border:1px solid #e5e5e5;border-radius:8px;padding:.75rem 1rem;min-width:110px}
.card b{font-size:1.4rem;display:block}
footer{margin-top:2.5rem;color:#888;font-size:.8rem}
</style></head><body>
<h1>react-vite-optimizer — analysis report</h1>
<p class="meta">${esc(root)}<br>Scanned ${res.scannedFiles} source file(s) ·
<span class="badge ${isVite ? 'ok' : 'warn'}">${isVite ? 'Vite project' : 'not a Vite project'}</span></p>
<div class="cards">
<div class="card"><b>${s.total}</b>total findings</div>
<div class="card"><b>${s.bySeverity.error}</b>error</div>
<div class="card"><b>${s.bySeverity.warning}</b>warning</div>
<div class="card"><b>${s.bySeverity.info}</b>info</div>
</div>
${sections}
<footer>Generated by react-vite-optimizer</footer>
</body></html>`;
}

function totalIssues(c) {
  return c.lazy + c.memo + c.usememo;
}

// Before/after verification panel: re-scan results printed after `fix`.
// This is the tool's receipt — proof of exactly what was done.
function printVerification(before, after) {
  console.log(chalk.bold.cyan('\nVerification — re-scanned after fix'));
  const rows = [
    ['Lazy-loading issues', before.lazy, after.lazy],
    ['React.memo issues', before.memo, after.memo],
    ['useMemo issues', before.usememo, after.usememo],
  ];
  for (const [label, b, a] of rows) {
    const mark = a === 0 ? chalk.green('✓') : chalk.yellow('●');
    console.log(
      `  ${mark} ${label}: ${chalk.bold(b)} → ${chalk.bold(a)} remaining`
    );
  }
  const bTotal = totalIssues(before);
  const aTotal = totalIssues(after);
  if (bTotal === 0) {
    console.log(chalk.green('\n✓ Nothing to fix — the codebase was already optimized.'));
  } else if (aTotal === 0) {
    console.log(
      chalk.green(`\n✓ All ${bTotal} detected issue(s) resolved.`)
    );
  } else {
    console.log(
      chalk.yellow(
        `\n● ${bTotal - aTotal} of ${bTotal} resolved; ${aTotal} remain ` +
          `(skipped for safety — see reasons above).`
      )
    );
  }
  console.log(
    chalk.dim('  Tip: run your tests or `vite build` to confirm everything still passes.')
  );
}

module.exports = {
  printReport,
  printFixSummary,
  printUpdates,
  printVerification,
  countIssues,
  summarize,
  ciVerdict,
  printCiVerdict,
  buildHtmlReport,
  SEV_ORDER,
};
