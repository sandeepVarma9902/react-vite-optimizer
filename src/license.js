// License management for rvo.
//
// Model: `rvo analyze` is free forever. `rvo fix`, `rvo upgrade` and `rvo all`
// require a commercial license key purchased from the Lemon Squeezy store.
//
// Activation uses the public Lemon Squeezy License API
// (https://docs.lemonsqueezy.com/help/licensing/license-api):
//   POST /v1/licenses/activate   { license_key, instance_name }  -> consumes one activation
//   POST /v1/licenses/validate   { license_key, instance_id? }   -> checks validity
//   POST /v1/licenses/deactivate { license_key, instance_id }    -> frees one activation
// Requests are form-urlencoded with `Accept: application/json` per the docs.
// The API is public (no store API key needed) and safe to ship in the CLI.
//
// The activated instance id is cached locally (~/.rvo/license.json, mode 0600).
// The cache is re-validated against the API at most once a week; if the
// machine is offline, a previously validated key keeps working for up to
// 30 days from its last successful validation (offline grace).
//
// Key delivery: `rvo license` (interactive hidden prompt), `rvo license <key>`
// (argument — convenient but visible in shell history), or RVO_LICENSE_KEY
// (best for CI).
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const chalk = require('chalk');

const LICENSE_DIR = path.join(os.homedir(), '.rvo');
const LICENSE_FILE = path.join(LICENSE_DIR, 'license.json');
const API_BASE = 'https://api.lemonsqueezy.com/v1/licenses';
// Re-validate against the API at most once a week; cached result in between.
const REVALIDATE_MS = 7 * 24 * 60 * 60 * 1000;
// Offline grace: a previously validated key keeps working this long without
// reaching the license server. After that, connectivity is required.
const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;

// Only keys issued for these products are accepted. Matched case-insensitively
// against the `product_name` returned by the License API. This rejects keys
// bought for unrelated products (the License API is public and validates any
// store's keys). Tighten to product IDs once they are known.
const ALLOWED_PRODUCTS = ['solo', 'team'];

const STORE_URL = 'https://rvo-tools.lemonsqueezy.com';

// ---------------------------------------------------------------- transport
// Test-only seam: unit tests swap the HTTP layer via _setTransport().
// Production always uses postForm below.
let transport = postForm;
function _setTransport(fn) {
  transport = fn;
}

function postForm(url, params) {
  return new Promise(resolve => {
    const payload = querystring.stringify(params);
    const lib = url.startsWith('http://') ? require('http') : https;
    let settled = false;
    const done = result => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            done({ ok: true, status: res.statusCode, body: JSON.parse(data) });
          } catch (_) {
            done({ ok: true, status: res.statusCode, body: null, raw: data });
          }
        });
      }
    );
    req.on('error', () => done({ ok: false, networkError: true }));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      done({ ok: false, networkError: true });
    });
    req.write(payload);
    req.end();
  });
}

// ------------------------------------------------------------------ storage
function instanceName() {
  let user = 'unknown';
  try {
    user = os.userInfo().username;
  } catch (_) {
    /* ignore */
  }
  return `rvo-cli:${os.hostname()}:${user}`.slice(0, 120);
}

function loadStored() {
  try {
    const raw = fs.readFileSync(LICENSE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data.key === 'string' ? data : null;
  } catch (_) {
    return null;
  }
}

function saveStored(data) {
  fs.mkdirSync(LICENSE_DIR, { recursive: true });
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function removeStored() {
  try {
    fs.unlinkSync(LICENSE_FILE);
    return true;
  } catch (_) {
    return false;
  }
}

// ------------------------------------------------------------- API wrappers
// Each returns { ok, networkError?, ...parsed } where `ok` means the HTTP
// request completed (not that the license was accepted).

async function apiActivate(key) {
  const res = await transport(`${API_BASE}/activate`, {
    license_key: key,
    instance_name: instanceName(),
  });
  if (!res.ok) return { ok: false, networkError: true };
  const body = res.body;
  if (!body || typeof body !== 'object')
    return { ok: false, error: 'Unexpected response from the license server.' };
  return {
    ok: true,
    activated: body.activated === true,
    error: typeof body.error === 'string' ? body.error : null,
    licenseKey: body.license_key || null,
    instance: body.instance || null,
    meta: body.meta || null,
  };
}

async function apiValidate(key, instanceId) {
  const params = { license_key: key };
  if (instanceId) params.instance_id = instanceId;
  const res = await transport(`${API_BASE}/validate`, params);
  if (!res.ok) return { ok: false, networkError: true };
  const body = res.body;
  if (!body || typeof body !== 'object')
    return { ok: false, error: 'Unexpected response from the license server.' };
  return {
    ok: true,
    valid: body.valid === true,
    error: typeof body.error === 'string' ? body.error : null,
    licenseKey: body.license_key || null,
    instance: body.instance || null,
    meta: body.meta || null,
  };
}

async function apiDeactivate(key, instanceId) {
  const res = await transport(`${API_BASE}/deactivate`, {
    license_key: key,
    instance_id: instanceId,
  });
  if (!res.ok) return { ok: false, networkError: true };
  const body = res.body;
  if (!body || typeof body !== 'object')
    return { ok: false, error: 'Unexpected response from the license server.' };
  return {
    ok: true,
    deactivated: body.deactivated === true,
    error: typeof body.error === 'string' ? body.error : null,
  };
}

// ------------------------------------------------------------ policy checks
// Decide whether an API response describes a usable rvo license.
// Returns null when acceptable, or a human-readable rejection reason.
function policyCheck({ licenseKey, meta }) {
  const lk = licenseKey || {};
  const status = (lk.status || '').toLowerCase();
  if (status === 'expired') return 'This license key has expired.';
  if (status === 'disabled') return 'This license key has been disabled.';
  if (lk.expires_at) {
    const exp = new Date(lk.expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now())
      return 'This license key has expired.';
  }
  const productName = String((meta && meta.product_name) || '').toLowerCase();
  const allowed = ALLOWED_PRODUCTS.some(p => productName.includes(p));
  if (!allowed)
    return 'This license key is not for react-vite-optimizer.';
  return null;
}

// ------------------------------------------------------------------ checks
// Check whether the current machine is licensed.
// Returns { ok: true, via } or { ok: false, reason, detail? }
// Reasons: 'no-key' | 'invalid' | 'network'
// via: 'cache' | 'remote' | 'offline-grace' | 'env-cache'
async function checkLicense() {
  const envKey = (process.env.RVO_LICENSE_KEY || '').trim();
  const stored = loadStored();
  const key = envKey || (stored && stored.key);
  if (!key) return { ok: false, reason: 'no-key' };
  const sameAsStored = !!(stored && stored.key === key);

  // Fresh cache hit — no network needed.
  if (
    sameAsStored &&
    stored.valid &&
    stored.validatedAt &&
    Date.now() - stored.validatedAt < REVALIDATE_MS
  ) {
    return {
      ok: true,
      via: envKey ? 'env-cache' : 'cache',
      product: stored.product,
      variant: stored.variant,
    };
  }

  const remote = await apiValidate(key, sameAsStored ? stored.instanceId : null);
  if (!remote.ok) {
    if (remote.networkError) {
      // Offline grace: a key that validated before keeps working for a while.
      if (
        sameAsStored &&
        stored.valid &&
        stored.validatedAt &&
        Date.now() - stored.validatedAt < OFFLINE_GRACE_MS
      ) {
        return {
          ok: true,
          via: 'offline-grace',
          product: stored.product,
          variant: stored.variant,
        };
      }
      return { ok: false, reason: 'network' };
    }
    return { ok: false, reason: 'invalid', detail: remote.error };
  }
  if (!remote.valid) {
    return {
      ok: false,
      reason: 'invalid',
      detail: remote.error || 'The license server rejected this key.',
    };
  }
  // The key itself is valid — but is this machine's activation still live?
  // If we validated a specific instance and the API no longer knows it
  // (or the key has no activations at all), the slot was removed elsewhere.
  if (sameAsStored && stored.instanceId && !remote.instance) {
    return {
      ok: false,
      reason: 'invalid',
      detail:
        "This machine's activation is no longer registered. " +
        'Re-activate with `rvo license` to claim a new activation.',
    };
  }
  const rejected = policyCheck(remote);
  if (rejected) return { ok: false, reason: 'invalid', detail: rejected };

  saveStored({
    key,
    valid: true,
    validatedAt: Date.now(),
    instanceId: (remote.instance && remote.instance.id) || (sameAsStored ? stored.instanceId : null),
    instanceName: (remote.instance && remote.instance.name) || null,
    product: (remote.meta && remote.meta.product_name) || null,
    variant: (remote.meta && remote.meta.variant_name) || null,
    productId: (remote.meta && remote.meta.product_id) || null,
    variantId: (remote.meta && remote.meta.variant_id) || null,
    status: (remote.licenseKey && remote.licenseKey.status) || null,
  });
  return {
    ok: true,
    via: 'remote',
    product: remote.meta && remote.meta.product_name,
    variant: remote.meta && remote.meta.variant_name,
  };
}

function licenseRequiredMessage(reason, detail) {
  const lines = [];
  if (reason === 'no-key') {
    lines.push(chalk.bold.red('\nA license key is required for this command.'));
    lines.push(`\n${chalk.bold('Good news:')} ${chalk.cyan('rvo analyze')} is free forever — run it`);
    lines.push('to see exactly what rvo would fix, before you pay anything.');
    lines.push(`\nTo unlock ${chalk.cyan('fix')}, ${chalk.cyan('upgrade')} and ${chalk.cyan('all')}:`);
    lines.push(`  1. Get a key at ${chalk.underline(STORE_URL)} (one-time payment, 14-day money-back guarantee)`);
    lines.push(`  2. Activate it:  ${chalk.cyan('rvo license')}  (prompts securely, no shell history)`);
  } else if (reason === 'invalid') {
    lines.push(chalk.bold.red('\nThis license key is not valid.'));
    if (detail) lines.push(chalk.dim('  ' + detail));
    lines.push(`\nActivate a valid key with ${chalk.cyan('rvo license')},`);
    lines.push(`or get one at ${chalk.underline(STORE_URL)}`);
  } else if (reason === 'network') {
    lines.push(chalk.bold.red('\nCould not reach the license server.'));
    lines.push('Check your connection and retry. A previously activated key keeps');
    lines.push('working offline for up to 30 days from its last validation —');
    lines.push('this machine has no recent validation cached.');
  }
  return lines.join('\n');
}

// Gate for commercial commands. Returns true when licensed, false otherwise
// (message already printed).
async function requireLicense() {
  const res = await checkLicense();
  if (res.ok) {
    if (res.via === 'offline-grace') {
      console.error(
        chalk.dim('Note: offline — using cached license (re-validation pending).')
      );
    }
    return true;
  }
  console.error(licenseRequiredMessage(res.reason, res.detail));
  process.exitCode = 1;
  return false;
}

// ---------------------------------------------------------------- activate
async function activate(key) {
  const clean = (key || '').trim();
  if (!clean) {
    console.error(chalk.red('\nProvide a license key: rvo license <your-key>'));
    console.error(chalk.dim('Tip: run bare `rvo license` for a secure hidden prompt.'));
    process.exitCode = 1;
    return;
  }
  const stored = loadStored();

  // Already active on this machine? Don't burn another activation slot —
  // just re-validate the existing instance.
  if (stored && stored.key === clean && stored.instanceId) {
    console.log(chalk.dim('Key already active on this machine — re-validating…'));
    const res = await checkLicense();
    if (res.ok) {
      console.log(chalk.green('\n✓ License confirmed active on this machine.'));
      if (res.product)
        console.log(chalk.dim(`  Product: ${res.product}${res.variant ? ' — ' + res.variant : ''}`));
      return;
    }
    console.error(licenseRequiredMessage(res.reason, res.detail));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.dim('Activating license key…'));
  const remote = await apiActivate(clean);
  if (!remote.ok) {
    if (remote.networkError) {
      console.error(
        chalk.red('\nCould not reach the license server. Check your connection and retry.')
      );
    } else {
      console.error(chalk.red('\n' + (remote.error || 'Activation failed.')));
    }
    process.exitCode = 1;
    return;
  }
  if (!remote.activated) {
    console.error(chalk.red('\nActivation failed.'));
    if (remote.error) console.error(chalk.dim('  ' + remote.error));
    if (/activation limit/i.test(remote.error || '')) {
      console.error(
        chalk.dim('\n  This key has no free activation slots left.') +
        chalk.dim('\n  Free one up by running `rvo license --remove` on an old machine.')
      );
    } else {
      console.error(`\nGet a key at ${chalk.underline(STORE_URL)}`);
    }
    process.exitCode = 1;
    return;
  }
  const rejected = policyCheck(remote);
  if (rejected) {
    // Activated remotely but not usable for rvo — free the slot immediately.
    if (remote.instance && remote.instance.id) {
      await apiDeactivate(clean, remote.instance.id).catch(() => {});
    }
    console.error(chalk.red('\n' + rejected));
    console.error(chalk.dim('The remote activation was released again.'));
    process.exitCode = 1;
    return;
  }
  saveStored({
    key: clean,
    valid: true,
    validatedAt: Date.now(),
    instanceId: remote.instance && remote.instance.id,
    instanceName: remote.instance && remote.instance.name,
    product: remote.meta && remote.meta.product_name,
    variant: remote.meta && remote.meta.variant_name,
    productId: remote.meta && remote.meta.product_id,
    variantId: remote.meta && remote.meta.variant_id,
    status: remote.licenseKey && remote.licenseKey.status,
  });
  console.log(chalk.green('\n✓ License activated on this machine.'));
  if (remote.meta && remote.meta.product_name)
    console.log(
      chalk.dim(
        `  Product: ${remote.meta.product_name}` +
          (remote.meta.variant_name ? ' — ' + remote.meta.variant_name : '')
      )
    );
  console.log(chalk.dim('  Commercial commands unlocked: fix, upgrade, all.'));
  console.log(
    chalk.dim('  Next step: ') +
      chalk.cyan('rvo fix ./my-app') +
      chalk.dim(' — applies every safe optimization, then prints a before → after report.')
  );
}

// ------------------------------------------------------------------ status
async function showStatus() {
  const stored = loadStored();
  const envKey = (process.env.RVO_LICENSE_KEY || '').trim();
  if (!stored && !envKey) {
    console.log(chalk.yellow('No license key on this machine.'));
    console.log(`Run ${chalk.cyan('rvo license')} to activate one.`);
    return;
  }
  console.log(chalk.dim('Re-validating with the license server…'));
  const res = await checkLicense();
  if (res.ok) {
    console.log(chalk.green('✓ Licensed') + chalk.dim(` (via ${res.via})`));
    if (res.product)
      console.log(chalk.dim(`  Product: ${res.product}${res.variant ? ' — ' + res.variant : ''}`));
    if (stored && stored.instanceName)
      console.log(chalk.dim(`  Instance: ${stored.instanceName}`));
  } else {
    console.error(licenseRequiredMessage(res.reason, res.detail));
    process.exitCode = 1;
  }
}

// ------------------------------------------------------------------ remove
// Frees the activation on Lemon Squeezy's side, then deletes the local cache.
async function remove() {
  const stored = loadStored();
  if (!stored) {
    console.log(chalk.dim('No license stored on this machine.'));
    return;
  }
  if (stored.instanceId) {
    console.log(chalk.dim('Deactivating this machine with the license server…'));
    const remote = await apiDeactivate(stored.key, stored.instanceId);
    if (!remote.ok) {
      if (remote.networkError) {
        console.error(
          chalk.red('\nCould not reach the license server, so the activation slot is') +
          chalk.red(' still counted against your key.')
        );
        console.error(
          chalk.dim('Your local key was kept. Re-run `rvo license --remove` when online')
        );
        console.error(chalk.dim('to free the slot for another machine.'));
        process.exitCode = 1;
        return;
      }
      // Server answered but did not deactivate (e.g. instance already gone):
      // the slot is effectively free — drop the local cache anyway.
      console.error(chalk.dim('Note: ' + (remote.error || 'server did not confirm deactivation.')));
    } else if (!remote.deactivated) {
      console.error(chalk.dim('Note: ' + (remote.error || 'server did not confirm deactivation.')));
    } else {
      console.log(chalk.green('✓ Activation released on the license server.'));
    }
  }
  removeStored();
  console.log(chalk.green('✓ License removed from this machine.'));
}

// ------------------------------------------------------------ hidden prompt
// Reads a line from the terminal without echoing it. Used by `rvo license`
// so the key never lands in shell history or the process list.
function promptHidden(query) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve(null);
      return;
    }
    process.stdout.write(query);
    stdin.setRawMode(true);
    stdin.resume();
    let input = '';
    const done = value => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(value);
    };
    const onData = chunk => {
      const s = chunk.toString('utf8');
      if (s === '\r' || s === '\n' || s === '\u0004') done(input);
      else if (s === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (s === '\u007f' || s === '\b') input = input.slice(0, -1);
      else if (s >= ' ' && s !== '\u007f') input += s;
    };
    stdin.on('data', onData);
  });
}

async function activatePrompt() {
  const key = await promptHidden('Enter your license key: ');
  if (key === null) {
    console.error(chalk.red('\nNo terminal available for secure input.'));
    console.error(`Use ${chalk.cyan('rvo license <your-key>')} or set ${chalk.cyan('RVO_LICENSE_KEY')}.`);
    process.exitCode = 1;
    return;
  }
  await activate(key);
}

module.exports = {
  checkLicense,
  requireLicense,
  activate,
  activatePrompt,
  showStatus,
  remove,
  licenseRequiredMessage,
  policyCheck,
  STORE_URL,
  // Test-only seams (not part of the public CLI surface).
  _setTransport,
  postForm,
};
