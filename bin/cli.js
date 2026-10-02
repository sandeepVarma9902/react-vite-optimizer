#!/usr/bin/env node
const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const {
  findProjectRoot,
  isViteProject,
  loadConfig,
  parseOnly,
  confirm,
  FIXABLE_RULES,
} = require('../src/utils');
const { buildProject } = require('../src/analyzer');
const { detectAll } = require('../src/rules');
const {
  printReport,
  printFixSummary,
  printUpdates,
  printVerification,
  countIssues,
  summarize,
  ciVerdict,
  printCiVerdict,
  buildHtmlReport,
} = require('../src/report');
const { checkDoctor } = require('../src/doctor');
const { applyFixes } = require('../src/transforms');
const { checkUpdates, applyUpdates } = require('../src/upgrade');
const { requireLicense, activate, activatePrompt, showStatus, remove } = require('../src/license');
const { listMigrations, runMigration, suggestMigrations } = require('../src/migrate');

program
  .name('rvo')
  .description(
    'Analyze, optimize, and modernize a React codebase: dependency upgrades, React.lazy code-splitting, React.memo and useMemo codemods, CRA → Vite and React 19 migrations.\n' +
    '  rvo analyze and rvo doctor are free forever. fix / upgrade / migrate / all require a license key.'
  )
  .version('1.1.0');

program.addHelpText('after', `
Examples:
  $ rvo analyze ./my-app        scan and report (free, no changes)
  $ rvo analyze --ci --max-issues 10   fail CI when more than 10 issues
  $ rvo analyze --html          write a shareable HTML report
  $ rvo doctor                  environment + project health check (free)
  $ rvo fix ./my-app             apply safe codemods (license required)
  $ rvo fix --dry-run            preview changes without writing files
  $ rvo upgrade                  bump deps to latest stable (license required)
  $ rvo migrate cra-to-vite --dry-run   preview a CRA → Vite migration (license required)
  $ rvo license <key>            activate your commercial license key

Get a license key (one-time payment, 14-day money-back guarantee):
  https://rvo-tools.lemonsqueezy.com`);

function getCtx(dir) {
  const root = findProjectRoot(dir || process.cwd());
  return { root, config: loadConfig(root), vite: isViteProject(root) };
}

function handleError(e) {
  console.error(chalk.red('\nError: ' + (e && e.message ? e.message : e)));
  process.exitCode = 1;
}

// ---------------------------------------------------------------- analyze
program
  .command('analyze [dir]')
  .description('Scan the codebase and report optimization opportunities (no changes)')
  .option('--only <rules>', 'comma-separated subset: lazy,memo,usememo,bundle,images')
  .option('--json', 'machine-readable output (stdout, or --output file)')
  .option('--html', 'write a self-contained HTML report file')
  .option('--output <file>', 'write --json/--html report to this file instead of defaults')
  .option('--ci', 'CI mode: exit non-zero when quality gates fail')
  .option('--max-issues <n>', 'CI: fail if total issue count exceeds N (default 0 with --ci; combine with --fail-on to gate on severity only, e.g. --max-issues 99999)')
  .option('--fail-on <severity>', 'CI: fail if any finding is at/above severity (info|warning|error)')
  .action((dir, opts) => {
    try {
      runAnalyze(dir, opts);
    } catch (e) {
      handleError(e);
    }
  });

function runAnalyze(dir, opts) {
  const fs = require('fs');
  const path = require('path');
  const { root, config, vite } = getCtx(dir);
  const project = buildProject(root, config);
  const res = detectAll(project, config, parseOnly(opts.only));
  const summary = summarize(res);

  if (opts.json) {
    const payload = JSON.stringify({ root, vite, summary, ...res }, null, 2);
    if (opts.output) {
      fs.writeFileSync(opts.output, payload + '\n');
      console.log(chalk.green(`JSON report written to ${opts.output}`));
    } else {
      console.log(payload);
    }
  } else if (opts.html) {
    const out = opts.output || path.join(process.cwd(), 'rvo-report.html');
    fs.writeFileSync(out, buildHtmlReport(root, res, vite, summary));
    console.log(chalk.green(`HTML report written to ${out}`));
  } else {
    printReport(root, res, vite);
  }

  // CI gate: --ci, or implied when gate options are passed on their own.
  const ciMode = opts.ci || opts.maxIssues != null || opts.failOn;
  if (ciMode) {
    const verdict = ciVerdict(res, summary, opts);
    if (opts.json && !opts.output) {
      // keep stdout pure JSON for pipelines — verdict goes to stderr
      const msg = verdict.pass
        ? `\n✓ CI check passed — ${summary.total} issue(s).`
        : `\n✗ CI check failed: ${verdict.reasons.join('; ')}`;
      console.error(verdict.pass ? chalk.green(msg) : chalk.red(msg));
    } else {
      printCiVerdict(verdict, summary);
    }
    if (!verdict.pass) process.exitCode = 1;
  }
}

// ------------------------------------------------------------------- doctor
program
  .command('doctor [dir]')
  .description('Check Node/npm versions and project health (no changes, free)')
  .action((dir) => {
    try {
      const root = findProjectRoot(dir || process.cwd());
      const { checks, failed, warned } = checkDoctor(root);
      console.log(chalk.bold.cyan('\nrvo doctor'));
      console.log(chalk.dim('  ' + root));
      for (const c of checks) {
        const mark =
          c.status === 'pass'
            ? chalk.green('✓')
            : c.status === 'warn'
              ? chalk.yellow('!')
              : chalk.red('✗');
        console.log(`  ${mark} ${c.name} — ${c.status === 'pass' ? chalk.dim(c.detail) : c.status === 'warn' ? chalk.yellow(c.detail) : chalk.red(c.detail)}`);
      }
      const passed = checks.length - failed - warned;
      console.log(
        failed
          ? chalk.red(`\n✗ ${failed} check(s) failed, ${warned} warning(s), ${passed} passed.`)
          : chalk.green(`\n✓ All good — ${passed} passed${warned ? `, ${warned} warning(s)` : ''}.`)
      );
      if (failed) process.exitCode = 1;
    } catch (e) {
      handleError(e);
    }
  });

// --------------------------------------------------------------------- fix
async function runFix(dir, opts) {
  if (!(await requireLicense())) return;
  const { root, config, vite } = getCtx(dir);
  // bundle/images are analyze-only — fix applies codemods for the rest.
  const requested = opts.only ? parseOnly(opts.only) : null;
  const only = (requested || FIXABLE_RULES).filter(r => FIXABLE_RULES.includes(r));
  if (requested && !only.length) {
    console.log(
      chalk.yellow('No fixable rules selected — bundle/images are analyze-only hints.')
    );
    return;
  }
  const project = buildProject(root, config);
  const res = detectAll(project, config, only);
  const before = countIssues(res);
  printReport(root, res, vite);
  const total = res.lazy.length + res.memo.length + res.usememo.length;
  if (!total) return;
  const groups = { lazy: res.lazy, memo: res.memo, usememo: res.usememo };
  if (!opts.yes && !opts.dryRun) {
    const labels = { lazy: 'lazy-loading', memo: 'React.memo', usememo: 'useMemo' };
    for (const key of only) {
      if (!groups[key].length) continue;
      const ok = await confirm(`Apply ${groups[key].length} ${labels[key]} transform(s)?`);
      if (!ok) groups[key] = [];
    }
  }
  const summary = applyFixes(groups, { dryRun: !!opts.dryRun });
  printFixSummary(summary, !!opts.dryRun);
  if (!opts.dryRun && summary.changedFiles.length) {
    // Verification pass: re-scan and show before → after. This is the
    // tool's receipt — proof of exactly what was done.
    const after = countIssues(detectAll(buildProject(root, config), config, only));
    printVerification(before, after);
  }
}

program
  .command('fix [dir]')
  .description('Apply codemods: React.lazy code-splitting, React.memo, useMemo (license required)')
  .option('--only <rules>', 'comma-separated subset: lazy,memo,usememo')
  .option('--dry-run', 'show what would change without writing files')
  .option('-y, --yes', 'apply without prompting')
  .action((dir, opts) => runFix(dir, opts).catch(handleError));

// ----------------------------------------------------------------- upgrade
async function runUpgrade(dir, opts) {
  if (!(await requireLicense())) return;
  const { root } = getCtx(dir);
  const spinner = ora('Checking npm registry for latest stable versions…').start();
  let check;
  try {
    check = await checkUpdates(root, { includeMajor: !!opts.includeMajor });
  } catch (e) {
    spinner.fail('Could not reach the npm registry: ' + (e.message || e));
    return;
  }
  spinner.stop();
  printUpdates(check);
  const updates = check.results.filter(r => r.status === 'update');
  if (!updates.length) {
    console.log(chalk.green('\nEverything is up to date.'));
    return;
  }
  if (opts.dryRun) {
    console.log(chalk.yellow('\nDry run — package.json not modified.'));
    return;
  }
  const doApply =
    opts.yes ||
    (await confirm(
      `Update ${updates.length} package(s)${opts.install === false ? '' : ' and run npm install'}?`
    ));
  if (!doApply) return;
  const res = applyUpdates(root, check, {
    install: opts.install !== false,
    verify: !!opts.verify,
  });
  console.log(chalk.green(`\nUpdated ${res.applied.length} package(s) in package.json.`));
}

program
  .command('upgrade [dir]')
  .description('Upgrade dependencies to their latest stable versions (license required)')
  .option('--include-major', 'include major version bumps (off by default)')
  .option('--dry-run', 'show available updates without changing anything')
  .option('-y, --yes', 'apply without prompting')
  .option('--no-install', 'update package.json but skip npm install')
  .option('--verify', 'run `npm run build` after installing')
  .action((dir, opts) => runUpgrade(dir, opts).catch(handleError));

program
  .command('license [key]')
  .description('Activate, check, or remove your commercial license key')
  .option('--check', 're-validate the stored key with the license server')
  .option('--remove', 'remove the license key from this machine')
  .action(async (key, opts) => {
    try {
      if (opts.remove) return await remove();
      if (opts.check) return await showStatus();
      if (key) return await activate(key);
      return await activatePrompt();
    } catch (e) {
      handleError(e);
    }
  });

program
  .command('feedback [message...]')
  .description('Send feedback: saves locally and shows where to reach us')
  .action(message => {
    try {
      runFeedback((message || []).join(' '));
    } catch (e) {
      handleError(e);
    }
  });

function runFeedback(message) {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const pkg = require('../package.json');
  if (message && message.trim()) {
    const dir = path.join(os.homedir(), '.rvo');
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      at: new Date().toISOString(),
      version: pkg.version,
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
      message: message.trim().slice(0, 2000),
    };
    fs.appendFileSync(path.join(dir, 'feedback-outbox.jsonl'), JSON.stringify(entry) + '\n');
    console.log(chalk.green('\n✓ Feedback saved locally. Thank you — we read everything.'));
  } else {
    console.log(chalk.bold.cyan('\nrvo feedback'));
  }
  console.log('\nWhere to reach us:');
  console.log(`  • GitHub issues:  ${chalk.underline('https://github.com/rvo-dev/react-vite-optimizer/issues')}`);
  console.log(`  • Email:          ${chalk.underline('support@rvo-tools.lemonsqueezy.com')}`);
  console.log(chalk.dim('\nTip: `rvo feedback "your message here"` saves it with your version/platform info.'));
  console.log(chalk.dim('Bug reports are most useful with the output of `rvo analyze --json` attached.'));
}

// ----------------------------------------------------------------- migrate
async function runMigrate(migration, dir, opts) {
  if (!(await requireLicense())) return;
  // Disambiguate `rvo migrate <dir>` from `rvo migrate <id> [dir]`: a bare
  // word that isn't a migration id is a typo (error); anything path-like or
  // an existing directory is the target dir.
  const path = require('path');
  const fs = require('fs');
  const known = listMigrations().map(m => m.id);
  let id = null;
  let target = dir;
  if (migration && known.includes(migration)) {
    id = migration;
  } else if (migration) {
    const looksLikePath = /[/\\]/.test(migration) || migration.startsWith('.');
    let isDir = false;
    try {
      isDir = fs.statSync(path.resolve(migration)).isDirectory();
    } catch {
      /* not a directory */
    }
    if (looksLikePath || isDir) target = migration;
    else id = migration; // unknown id → runMigration reports it
  }
  const root = findProjectRoot(target || process.cwd());
  if (!id) {
    await suggestMigrations(root);
    return;
  }
  await runMigration(id, root, {
    dryRun: !!opts.dryRun,
    yes: !!opts.yes,
    install: opts.install !== false,
  });
}

program
  .command('migrate [migration] [dir]')
  .description('Migrate a codebase — cra-to-vite, react-19 — via detect → plan → transform → verify (license required)')
  .option('--dry-run', 'print the migration plan without changing anything')
  .option('-y, --yes', 'apply without prompting')
  .option('--no-install', 'skip npm install after dependency changes')
  .action((migration, dir, opts) => runMigrate(migration, dir, opts).catch(handleError));

// --------------------------------------------------------------------- all
program
  .command('all [dir]')
  .description('Run fix, then upgrade (license required)')
  .option('--only <rules>', 'comma-separated subset for the fix step: lazy,memo,usememo')
  .option('--dry-run', 'show what would change without writing files')
  .option('-y, --yes', 'apply without prompting')
  .option('--include-major', 'include major version bumps in the upgrade step')
  .option('--no-install', 'update package.json but skip npm install')
  .action(async (dir, opts) => {
    try {
      await runFix(dir, opts);
      await runUpgrade(dir, opts);
    } catch (e) {
      handleError(e);
    }
  });

program.parse();
