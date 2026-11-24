import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

import { routeRecipientOperation, assertDemoSignAllowed } from '../src/stellar-service.js';
import { createApp } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sweldosyncRoot = path.resolve(__dirname, '../../../');

const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const MAINNET_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function collectScannableFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'data', 'test', 'dist'].includes(entry.name)) {
        continue;
      }
      results.push(...collectScannableFiles(fullPath));
    } else if (entry.isFile()) {
      if (entry.name === '.env' || entry.name.startsWith('.env.local')) {
        continue;
      }
      if (
        entry.name === '.env.template' ||
        /\.(js|jsx|ts|tsx|json|html|md)$/i.test(entry.name)
      ) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

describe('Zero Hardcoded Secret Seed Gate', () => {
  it('contains zero Stellar Ed25519 secret seeds or live Velo keys in sweldosync sources', () => {
    const stellarSeedRegex = /\bS[A-Z2-7]{55}\b/g;
    const veloLiveKeyRegex = /tk_live_/g;
    const files = collectScannableFiles(sweldosyncRoot);
    const hits = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (stellarSeedRegex.test(content)) {
        hits.push(`${path.relative(sweldosyncRoot, filePath)}: matched Stellar secret seed pattern`);
      }
      if (veloLiveKeyRegex.test(content)) {
        hits.push(`${path.relative(sweldosyncRoot, filePath)}: matched tk_live_ key`);
      }
    }

    assert.deepEqual(hits, []);
  });
});

describe('Stellar Smart Recipient Operation Routing', () => {
  const treasuryAddress = Keypair.random().publicKey();
  const employeeAddress = Keypair.random().publicKey();

  const makeMockServer = (accountOrNull) => ({
    async loadAccount(accountId) {
      if (accountId !== employeeAddress || !accountOrNull) {
        const err = new Error('Not Found');
        err.response = { status: 404 };
        err.status = 404;
        throw err;
      }
      return accountOrNull;
    },
  });

  it('routes funded XLM recipient to payment', async () => {
    const server = makeMockServer({
      id: employeeAddress,
      balances: [{ asset_type: 'native', balance: '10.0000000' }],
    });

    const routed = await routeRecipientOperation({
      destination: employeeAddress,
      assetCode: 'XLM',
      amount: '5.0000000',
      treasuryAddress,
      server,
    });

    assert.equal(routed.kind, 'payment');
    assert.equal(routed.operation.body().switch().name, 'payment');
  });

  it('routes unfunded (404) XLM recipient with amount >= 1.0000000 to createAccount', async () => {
    const server = makeMockServer(null);

    const routed = await routeRecipientOperation({
      destination: employeeAddress,
      assetCode: 'XLM',
      amount: '1.0000000',
      treasuryAddress,
      server,
    });

    assert.equal(routed.kind, 'createAccount');
    assert.equal(routed.operation.body().switch().name, 'createAccount');
  });

  it('routes unfunded (404) XLM recipient with amount < 1.0000000 to createClaimableBalance with 2 claimants', async () => {
    const server = makeMockServer(null);

    const routed = await routeRecipientOperation({
      destination: employeeAddress,
      assetCode: 'XLM',
      amount: '0.5000000',
      treasuryAddress,
      server,
    });

    assert.equal(routed.kind, 'createClaimableBalance');
    assert.equal(routed.operation.body().switch().name, 'createClaimableBalance');
    assert.equal(routed.claimants.length, 2);
    const claimantDestinations = routed.claimants.map((c) => c.destination);
    assert.ok(claimantDestinations.includes(employeeAddress));
    assert.ok(claimantDestinations.includes(treasuryAddress));
  });

  it('routes USDC recipient without trustline to createClaimableBalance with 2 claimants', async () => {
    const server = makeMockServer({
      id: employeeAddress,
      balances: [{ asset_type: 'native', balance: '10.0000000' }],
    });

    const routed = await routeRecipientOperation({
      destination: employeeAddress,
      assetCode: 'USDC',
      assetIssuer: TESTNET_USDC_ISSUER,
      amount: '25.0000000',
      treasuryAddress,
      server,
    });

    assert.equal(routed.kind, 'createClaimableBalance');
    assert.equal(routed.operation.body().switch().name, 'createClaimableBalance');
    assert.equal(routed.claimants.length, 2);
  });

  it('throws on self-payment when destination equals treasuryAddress', async () => {
    const server = makeMockServer({
      id: treasuryAddress,
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
    });

    await assert.rejects(
      () =>
        routeRecipientOperation({
          destination: treasuryAddress,
          assetCode: 'XLM',
          amount: '5.0000000',
          treasuryAddress,
          server,
        }),
      /self-payment|treasury|same/i
    );
  });
});

describe('XDR-Level Demo-Sign Mainnet Block', () => {
  const sourcePub = Keypair.random().publicKey();
  const destPub = Keypair.random().publicKey();

  function buildDummyTx(networkPassphrase, asset = Asset.native()) {
    const account = new Account(sourcePub, '100');
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: destPub,
          asset,
          amount: '5.0000000',
        })
      )
      .setTimeout(180)
      .build();
  }

  it('throws 403 when assertDemoSignAllowed receives a Mainnet Transaction or Mainnet context', () => {
    const mainnetTx = buildDummyTx(Networks.PUBLIC);
    const mainnetXdr = mainnetTx.toXDR();

    // 1. Transaction object carrying Networks.PUBLIC passphrase
    assert.throws(
      () => assertDemoSignAllowed(mainnetTx),
      (err) => err && err.status === 403
    );

    // 2. XDR string with explicit Mainnet networkPassphrase
    assert.throws(
      () => assertDemoSignAllowed(mainnetXdr, { networkPassphrase: Networks.PUBLIC }),
      (err) => err && err.status === 403
    );

    // 3. Raw XDR containing Mainnet Circle USDC issuer (detectable from XDR bytes alone)
    const mainnetUsdcXdr = buildDummyTx(
      Networks.PUBLIC,
      new Asset('USDC', MAINNET_USDC_ISSUER)
    ).toXDR();
    assert.throws(
      () => assertDemoSignAllowed(mainnetUsdcXdr),
      (err) => err && err.status === 403
    );
  });

  it('allows Testnet Transaction and XDR', () => {
    const testnetTx = buildDummyTx(Networks.TESTNET);
    const testnetXdr = testnetTx.toXDR();

    assert.doesNotThrow(() => assertDemoSignAllowed(testnetTx));
    assert.doesNotThrow(() =>
      assertDemoSignAllowed(testnetXdr, { networkPassphrase: Networks.TESTNET })
    );
  });
});

describe('Express API Integration (createApp)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweldosync-test-'));
  const dbPath = path.join(tmpDir, 'sweldosync.sqlite');
  let server;
  let appHandle;
  let baseUrl;
  const prevAdminToken = process.env.ADMIN_TOKEN;

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (typeof appHandle?.close === 'function') {
      await appHandle.close();
    }
    if (prevAdminToken === undefined) {
      delete process.env.ADMIN_TOKEN;
    } else {
      process.env.ADMIN_TOKEN = prevAdminToken;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function ensureServer() {
    if (baseUrl) return baseUrl;
    process.env.ADMIN_TOKEN = 'test-secret-token';
    appHandle = await createApp({ dbPath, adminToken: 'test-secret-token' });
    const expressApp = appHandle?.app || appHandle;
    server = expressApp.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
    return baseUrl;
  }

  function findSensitiveKeys(node, pathPrefix = '') {
    const badKeys = [];
    if (Array.isArray(node)) {
      node.forEach((item, idx) => {
        badKeys.push(...findSensitiveKeys(item, `${pathPrefix}[${idx}]`));
      });
    } else if (node && typeof node === 'object') {
      for (const [key, val] of Object.entries(node)) {
        const keyPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        if (/secret|seed/i.test(key)) {
          badKeys.push(keyPath);
        }
        badKeys.push(...findSensitiveKeys(val, keyPath));
      }
    }
    return badKeys;
  }

  it('GET /healthz returns 200 and { ok: true }', async () => {
    const url = await ensureServer();
    const res = await fetch(`${url}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it('GET /api/bootstrap returns seeded employees, timesheets, policy, and storageNotice', async () => {
    const url = await ensureServer();
    const res = await fetch(`${url}/api/bootstrap`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.ok(Array.isArray(body.employees) && body.employees.length > 0);
    assert.ok(Array.isArray(body.timesheets) && body.timesheets.length > 0);
    assert.ok(body.policy && typeof body.policy === 'object');
    assert.equal(typeof body.storageNotice, 'string');
    assert.ok(body.storageNotice.length > 0);
  });

  it('GET /api/workspace/export never leaks secret seeds, secret keys, or AGENT_SECRET_KEY', async () => {
    const url = await ensureServer();
    const res = await fetch(`${url}/api/workspace/export`, {
      headers: { Authorization: 'Bearer test-secret-token' },
    });
    assert.equal(res.status, 200);
    const raw = await res.text();

    assert.equal(/\bS[A-Z2-7]{55}\b/.test(raw), false);
    assert.equal(raw.includes('AGENT_SECRET_KEY'), false);
    assert.equal(raw.includes('tk_live_'), false);

    const parsed = JSON.parse(raw);
    assert.deepEqual(findSensitiveKeys(parsed), []);
  });

  it('POST /api/payruns/:id/chunks/0/build-xdr on mainnet returns 403 without Authorization bearer token', async () => {
    const url = await ensureServer();
    const res = await fetch(`${url}/api/payruns/RUN-TEST-001/chunks/0/build-xdr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        network: 'mainnet',
        treasuryAddress: Keypair.random().publicKey(),
      }),
    });

    assert.equal(res.status, 403);
  });
});
