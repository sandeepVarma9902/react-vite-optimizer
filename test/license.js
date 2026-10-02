// Unit tests for src/license.js against the verified Lemon Squeezy License
// API contract (https://docs.lemonsqueezy.com/help/licensing/license-api).
// The HTTP layer is swapped via _setTransport; HOME is isolated per run.
// Run with: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const querystring = require('querystring');

// Isolate BEFORE requiring the module (paths are computed at load time).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rvo-lic-test-'));
process.env.HOME = HOME;
delete process.env.RVO_LICENSE_KEY;

const lic = require('../src/license');
const LIC_FILE = path.join(HOME, '.rvo', 'license.json');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('ok:', msg);
  }
}

function reset() {
  process.exitCode = 0;
  delete process.env.RVO_LICENSE_KEY;
  try {
    fs.unlinkSync(LIC_FILE);
  } catch (_) {}
  lic._setTransport(() => {
    throw new Error('transport not stubbed for this test');
  });
}

function seedStored(data) {
  fs.mkdirSync(path.join(HOME, '.rvo'), { recursive: true });
  fs.writeFileSync(
    LIC_FILE,
    JSON.stringify({
      key: 'key-123',
      valid: true,
      validatedAt: Date.now(),
      instanceId: 'inst-1',
      instanceName: 'test-instance',
      product: 'Solo',
      variant: 'Default',
      status: 'active',
      ...data,
    })
  );
}

function okActivate(overrides = {}) {
  return {
    ok: true,
    activated: true,
    error: null,
    license_key: {
      id: 1,
      status: 'active',
      key: 'key-123',
      activation_limit: 1,
      activation_usage: 1,
      created_at: '2026-01-01T00:00:00.000000Z',
      expires_at: null,
    },
    instance: { id: 'inst-1', name: "test-instance", created_at: '2026-01-01T00:00:00.000000Z' },
    meta: {
      store_id: 1,
      product_id: 10,
      product_name: 'Solo',
      variant_id: 11,
      variant_name: 'Default',
      customer_id: 5,
      customer_name: 'Jane',
      customer_email: 'jane@example.com',
    },
    ...overrides,
  };
}

function okValidate(overrides = {}) {
  const a = okActivate(overrides);
  return {
    ok: true,
    valid: true,
    error: null,
    license_key: a.license_key,
    instance: a.instance,
    meta: a.meta,
  };
}

// Transport stubs must return the raw HTTP shape postForm produces.
function httpOk(json) {
  return { ok: true, status: 200, body: json };
}
function netFail() {
  return { ok: false, networkError: true };
}

async function runAll() {
  // 1. activate hits the right endpoint with form params (no JSON anywhere)
  {
    reset();
    const calls = [];
    lic._setTransport(async (url, params) => {
      calls.push({ url, params });
      return httpOk(okActivate());
    });
    await lic.activate('key-123');
    assert(calls.length === 1, 'activate makes exactly one API call');
    assert(
      calls[0].url === 'https://api.lemonsqueezy.com/v1/licenses/activate',
      'activate posts to /v1/licenses/activate'
    );
    assert(calls[0].params.license_key === 'key-123', 'activate sends license_key');
    assert(
      typeof calls[0].params.instance_name === 'string' && calls[0].params.instance_name.length > 0,
      'activate sends instance_name'
    );
    const stored = JSON.parse(fs.readFileSync(LIC_FILE, 'utf8'));
    assert(stored.instanceId === 'inst-1', 'activate stores the instance id');
    assert(stored.product === 'Solo', 'activate stores the product name');
    assert(process.exitCode === 0, 'activate succeeds');
  }

  // 2. form-encoding is really form-urlencoded (the verified API contract)
  {
    reset();
    await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          try {
            assert(
              req.headers['content-type'] === 'application/x-www-form-urlencoded',
              'POST uses application/x-www-form-urlencoded'
            );
            assert(req.headers.accept === 'application/json', 'sends Accept: application/json');
            const parsed = querystring.parse(body);
            assert(parsed.license_key === 'key-123', 'body carries license_key');
            assert(typeof parsed.instance_name === 'string', 'body carries instance_name');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            server.close();
          }
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        await lic.postForm(`http://127.0.0.1:${port}/v1/licenses/validate`, {
          license_key: 'key-123',
          instance_name: 'x',
        });
      });
    });
  }

  // 3. activation-limit error surfaces cleanly, nothing cached
  {
    reset();
    lic._setTransport(async () => httpOk({
      activated: false,
      error: 'This license key has reached the activation limit.',
      license_key: null,
      instance: null,
      meta: null,
    }));
    await lic.activate('key-123');
    assert(process.exitCode === 1, 'activation-limit failure exits non-zero');
    assert(!fs.existsSync(LIC_FILE), 'failed activation caches nothing');
  }

  // 4. key for another product is rejected AND the slot is released again
  {
    reset();
    const calls = [];
    lic._setTransport(async (url, params) => {
      calls.push(url);
      if (url.endsWith('/activate')) return httpOk(okActivate({ meta: { product_name: 'Some Other Product' } }));
      return httpOk({ deactivated: true, error: null });
    });
    await lic.activate('key-123');
    assert(process.exitCode === 1, 'foreign-product key is rejected');
    assert(
      calls.some(u => u.endsWith('/deactivate')),
      'rejected activation is released via /deactivate'
    );
    assert(!fs.existsSync(LIC_FILE), 'rejected activation caches nothing');
  }

  // 5. re-activating the same key validates instead of burning a slot
  {
    reset();
    seedStored({ validatedAt: 0 });
    const calls = [];
    lic._setTransport(async (url, params) => {
      calls.push({ url, params });
      return httpOk(okValidate());
    });
    await lic.activate('key-123');
    assert(
      calls.length === 1 && calls[0].url.endsWith('/validate'),
      're-activate calls /validate, not /activate'
    );
    assert(calls[0].params.instance_id === 'inst-1', 'validate sends the stored instance_id');
    assert(process.exitCode === 0, 're-activation succeeds');
  }

  // 6. fresh cache → no network at all
  {
    reset();
    seedStored();
    let called = false;
    lic._setTransport(async () => {
      called = true;
      return { ok: false, networkError: true };
    });
    const res = await lic.checkLicense();
    assert(res.ok && res.via === 'cache', 'fresh cache is accepted without network');
    assert(!called, 'fresh cache makes no HTTP call');
  }

  // 7. stale cache → revalidates, refreshes timestamp
  {
    reset();
    seedStored({ validatedAt: Date.now() - 8 * 24 * 3600 * 1000 });
    lic._setTransport(async () => httpOk(okValidate()));
    const res = await lic.checkLicense();
    assert(res.ok && res.via === 'remote', 'stale cache revalidates remotely');
    const stored = JSON.parse(fs.readFileSync(LIC_FILE, 'utf8'));
    assert(Date.now() - stored.validatedAt < 60 * 1000, 'successful revalidation refreshes the cache');
  }

  // 8. offline within grace → still licensed
  {
    reset();
    seedStored({ validatedAt: Date.now() - 10 * 24 * 3600 * 1000 });
    lic._setTransport(async () => ({ ok: false, networkError: true }));
    const res = await lic.checkLicense();
    assert(res.ok && res.via === 'offline-grace', 'offline within 30d grace stays licensed');
  }

  // 9. offline beyond grace → blocked
  {
    reset();
    seedStored({ validatedAt: Date.now() - 40 * 24 * 3600 * 1000 });
    lic._setTransport(async () => ({ ok: false, networkError: true }));
    const res = await lic.checkLicense();
    assert(!res.ok && res.reason === 'network', 'offline beyond 30d grace is blocked');
  }

  // 10. expired / disabled keys are rejected
  for (const status of ['expired', 'disabled']) {
    reset();
    seedStored({ validatedAt: 0 });
    lic._setTransport(async () => {
      const v = okValidate();
      v.license_key.status = status;
      return httpOk(v);
    });
    const res = await lic.checkLicense();
    assert(!res.ok && res.reason === 'invalid', `${status} key is rejected (${res.detail || ''})`);
  }

  // 11. validate ok but our instance is gone → rejected (slot removed elsewhere)
  {
    reset();
    seedStored({ validatedAt: 0 });
    lic._setTransport(async () => {
      const v = okValidate();
      v.instance = null;
      return httpOk(v);
    });
    const res = await lic.checkLicense();
    assert(
      !res.ok && res.reason === 'invalid' && /no longer registered/.test(res.detail || ''),
      'missing instance is rejected with re-activation guidance'
    );
  }

  // 12. RVO_LICENSE_KEY works with no stored file
  {
    reset();
    process.env.RVO_LICENSE_KEY = 'env-key-9';
    lic._setTransport(async (url, params) => {
      assert(params.license_key === 'env-key-9', 'env key is sent for validation');
      assert(!('instance_id' in params), 'no instance_id without a stored activation');
      return httpOk(okValidate());
    });
    const res = await lic.checkLicense();
    assert(res.ok, 'RVO_LICENSE_KEY licenses the machine');
  }

  // 13. remove deactivates remotely, then deletes the cache
  {
    reset();
    seedStored();
    const calls = [];
    lic._setTransport(async (url, params) => {
      calls.push({ url, params });
      return httpOk({ deactivated: true, error: null });
    });
    await lic.remove();
    assert(calls.length === 1 && calls[0].url.endsWith('/deactivate'), 'remove calls /deactivate');
    assert(calls[0].params.instance_id === 'inst-1', 'deactivate sends the instance id');
    assert(!fs.existsSync(LIC_FILE), 'remove deletes the local cache');
    assert(process.exitCode === 0, 'remove succeeds');
  }

  // 14. remove with no network keeps the cache (slot still counted)
  {
    reset();
    seedStored();
    lic._setTransport(async () => ({ ok: false, networkError: true }));
    await lic.remove();
    assert(process.exitCode === 1, 'offline remove exits non-zero');
    assert(fs.existsSync(LIC_FILE), 'offline remove keeps the local cache');
  }

  fs.rmSync(HOME, { recursive: true, force: true });
  process.exitCode = failures ? 1 : 0;
  if (failures) {
    console.error(`\n${failures} license test(s) failed.`);
  } else {
    console.log('\nAll license tests passed.');
  }
}

runAll().catch(e => {
  console.error('FAIL: license tests crashed:', e);
  process.exitCode = 1;
});
