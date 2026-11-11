/**
 * SweldoSync Express Server
 * REST API, Velo Wallet Config CORS Proxy, and Stellar Testnet Horizon Transfer
 * 0 Emojis rule strictly enforced.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Velo } from '@carts1024/velo-sdk';
import {
  VELO_PROJECT_KEY,
  VELO_API_KEY,
  CONTRACT_IDS,
  STELLAR_CONFIG,
  DEFAULT_EMPLOYEES,
  formatExplorerTxUrl,
  roundToDecimals,
} from '../../../packages/shared/src/index.js';
import { PayrollAgent } from '../../../packages/agent/src/payroll-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Hydrate environment variables from local .env files
 */
function hydrateEnv() {
  const candidates = [
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../../../../09_Private/velo_hackathon_env.local'),
    '/Users/kylexavier/.gemini/antigravity/scratch/awiten-pay/.env',
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[k]) {
        process.env[k] = v;
      }
    }
  }
}

hydrateEnv();

const PORT = process.env.PORT || 3001;
const app = express();
const agent = new PayrollAgent();

// In-memory data stores
let employees = JSON.parse(JSON.stringify(DEFAULT_EMPLOYEES));
let workLogs = [
  {
    id: 'LOG-INIT-1',
    employeeId: 'EMP-001',
    date: '2026-11-10',
    hoursLogged: 8,
    notes: 'Stellar smart contract audit',
    status: 'DISBURSED',
  },
  {
    id: 'LOG-INIT-2',
    employeeId: 'EMP-002',
    date: '2026-11-10',
    hoursLogged: 8,
    notes: 'Frontend UI layout development',
    status: 'DISBURSED',
  },
];

let auditLog = [
  {
    id: 'REC-INIT-1',
    workLogId: 'LOG-INIT-1',
    employeeId: 'EMP-001',
    employeeName: 'Juan Dela Cruz',
    walletAddress: 'GBZOFVJBXQADCCG2BOBC4DTBUSSSTA4OYJR3P4EZCZ75JHYHHQ6PLOLD',
    action: 'AUTONOMOUSLY_DISBURSED',
    status: 'DISBURSED',
    grossXlm: 20.0,
    withholdingXlm: 1.0,
    netXlm: 19.0,
    txHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    explorerUrl: 'https://stellar.expert/explorer/testnet/tx/a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    reasoning: 'Policy verified: 8h regular at 2.50 XLM/h. Gross: 20.0 XLM, 5% withholding: 1.0 XLM, Net: 19.0 XLM.',
    timestamp: '2026-11-10T14:30:00.000Z',
  },
  {
    id: 'REC-INIT-2',
    workLogId: 'LOG-INIT-2',
    employeeId: 'EMP-002',
    employeeName: 'Maria Santos',
    walletAddress: 'GATDP2GAYZZB6PONNZDUKDQCN5YEZUU6VF6M3KSZ7KRDPKPGXVBQVYTU',
    action: 'AUTONOMOUSLY_DISBURSED',
    status: 'DISBURSED',
    grossXlm: 16.0,
    withholdingXlm: 0.8,
    netXlm: 15.2,
    txHash: 'f6e5d4c3b2a10987654321fedcba0987654321abcdef0123456789abcdef0123',
    explorerUrl: 'https://stellar.expert/explorer/testnet/tx/f6e5d4c3b2a10987654321fedcba0987654321abcdef0123456789abcdef0123',
    reasoning: 'Policy verified: 8h regular at 2.00 XLM/h. Gross: 16.0 XLM, 5% withholding: 0.8 XLM, Net: 15.2 XLM.',
    timestamp: '2026-11-10T14:35:00.000Z',
  },
];

/**
 * Transfer live XLM on Stellar Testnet to a destination wallet.
 * Uses Friendbot auto-funding if destination does not exist yet.
 *
 * @param {string} destinationAddress
 * @param {number|string} amountXlm
 * @param {string} memoText
 * @returns {Promise<Object>}
 */
const VERIFIED_FALLBACK_SECRET = 'SCPKUIBMC6LNSWKWIDS6B4EXBSGPWDXX6YXNCY6PBSWY2AFQE7JVKMEK';

/**
 * Resolve a valid Ed25519 Secret Seed Keypair
 * Sanitizes input, strips outer quotes/spaces, validates checksum, and falls back gracefully.
 */
export function resolveSourceKeypair() {
  const candidates = [
    process.env.AGENT_SECRET_KEY,
    process.env.OWNER_SECRET_KEY,
    VERIFIED_FALLBACK_SECRET,
  ];

  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    const clean = raw.trim().replace(/^['"`]|['"`]$/g, '').trim();
    if (StellarSdk.StrKey.isValidEd25519SecretSeed(clean)) {
      try {
        return StellarSdk.Keypair.fromSecret(clean);
      } catch (e) {
        // Continue to next candidate
      }
    }
  }

  return StellarSdk.Keypair.fromSecret(VERIFIED_FALLBACK_SECRET);
}

/**
 * Transfer live XLM on Stellar Testnet to a destination wallet.
 * Uses Friendbot auto-funding if destination or source does not exist yet.
 *
 * @param {string} destinationAddress
 * @param {number|string} amountXlm
 * @param {string} memoText
 * @returns {Promise<Object>}
 */
export async function transferTestnetXlmToConnectedWallet(
  destinationAddress,
  amountXlm,
  memoText = 'SweldoSync'
) {
  const cleanDestination = String(destinationAddress || '').trim().replace(/^['"`]|['"`]$/g, '').trim();

  if (!cleanDestination || !StellarSdk.StrKey.isValidEd25519PublicKey(cleanDestination)) {
    throw new Error(`Invalid destination Stellar address: ${destinationAddress}`);
  }

  const server = new StellarSdk.Horizon.Server(STELLAR_CONFIG.HORIZON_URL);
  const sourceKeypair = resolveSourceKeypair();

  // 1. Ensure source account is funded
  let sourceAccount;
  try {
    sourceAccount = await server.loadAccount(sourceKeypair.publicKey());
  } catch (err) {
    const status = err?.response?.status || err?.status;
    if (status === 404) {
      console.log(`[Stellar Transfer] Source ${sourceKeypair.publicKey()} not found. Funding via Friendbot...`);
      try {
        await server.friendbot(sourceKeypair.publicKey()).call();
        await new Promise((r) => setTimeout(r, 1000));
        sourceAccount = await server.loadAccount(sourceKeypair.publicKey());
      } catch (fbErr) {
        console.warn('[Stellar Transfer] Friendbot funding warning for source:', fbErr?.message || fbErr);
        throw fbErr;
      }
    } else {
      throw err;
    }
  }

  // 2. Ensure destination account is funded if 404
  try {
    await server.loadAccount(cleanDestination);
  } catch (err) {
    const status = err?.response?.status || err?.status;
    if (status === 404) {
      console.log(`[Stellar Transfer] Destination ${cleanDestination} not found on testnet. Funding via Friendbot...`);
      try {
        await server.friendbot(cleanDestination).call();
        await new Promise((r) => setTimeout(r, 1000));
      } catch (fbErr) {
        console.warn('[Stellar Transfer] Friendbot funding warning:', fbErr?.message || fbErr);
      }
    }
  }

  // Re-load sourceAccount to get latest sequence number
  sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

  const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: cleanDestination,
        asset: StellarSdk.Asset.native(),
        amount: String(amountXlm),
      })
    )
    .setTimeout(30);

  if (memoText) {
    txBuilder.addMemo(StellarSdk.Memo.text(String(memoText).slice(0, 28)));
  }

  const tx = txBuilder.build();
  tx.sign(sourceKeypair);

  const txResult = await server.submitTransaction(tx);
  const liveTxHash = txResult.hash;
  const explorerUrl = formatExplorerTxUrl(liveTxHash);

  console.log(`[Stellar Transfer] Sent ${amountXlm} XLM to ${cleanDestination} (Tx: ${liveTxHash})`);

  return {
    liveTransfer: true,
    destination: cleanDestination,
    amountXlm: String(amountXlm),
    txHash: liveTxHash,
    explorerUrl,
  };
}

/**
 * Sign a Velo webhook payload with HMAC-SHA256 (t=<ts>,v1=<hex>)
 */
export function signVeloWebhookPayload(payloadString, secret = process.env.VELO_WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedMessage = `${timestamp}.${payloadString}`;
  const hmacHex = crypto
    .createHmac('sha256', secret || 'whsec_107eb34fa5d38e9206fb7e40b7ac8f95')
    .update(signedMessage)
    .digest('hex');
  return `t=${timestamp},v1=${hmacHex}`;
}

/**
 * Velo Webhook Handler
 */
export async function handleVeloWebhook(req, res) {
  const signature = req.headers['x-velo-signature'];
  const deliveryId = req.headers['x-velo-delivery'] || `del-${Date.now()}`;
  const rawBodyBuffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
  const rawBody = rawBodyBuffer.toString('utf8');
  const secret = process.env.VELO_WEBHOOK_SECRET || 'whsec_107eb34fa5d38e9206fb7e40b7ac8f95';

  console.log(`[VELO WEBHOOK INCOMING] Path: ${req.path} Delivery: ${deliveryId}`);

  let verifiedEvent = null;
  let signatureVerified = false;

  try {
    verifiedEvent = await Velo.webhooks.verify({
      payload: rawBody,
      signature: String(signature || ''),
      secret,
    });
    signatureVerified = true;
    console.log(`[VELO WEBHOOK] Verified event type: ${verifiedEvent.type}`);
  } catch (err) {
    console.warn(`[VELO WEBHOOK SDK WARN] ${err?.message}`);
    if (signature && secret) {
      try {
        const parts = String(signature).split(',');
        const tPart = parts.find((p) => p.startsWith('t='));
        const v1Part = parts.find((p) => p.startsWith('v1='));
        if (tPart && v1Part) {
          const timestamp = tPart.slice(2);
          const expectedHash = v1Part.slice(3);
          const computedHash = crypto
            .createHmac('sha256', secret)
            .update(`${timestamp}.${rawBody}`)
            .digest('hex');
          if (expectedHash === computedHash) {
            signatureVerified = true;
            try {
              verifiedEvent = JSON.parse(rawBody);
            } catch (e) {
              verifiedEvent = { type: 'custom' };
            }
          }
        }
      } catch (subErr) {
        // signature check failed
      }
    }
  }

  if (signatureVerified || !signature) {
    const eventType = verifiedEvent?.type || 'ping';
    return res.status(200).json({
      success: true,
      verified: signatureVerified,
      deliveryId,
      eventType,
      receivedAt: new Date().toISOString(),
    });
  }

  return res.status(400).json({
    success: false,
    error: 'Invalid signature',
  });
}

// Webhook raw endpoints (must precede express.json middleware)
app.post('/api/webhooks/velo', express.raw({ type: '*/*' }), handleVeloWebhook);
app.post('/api/webhook', express.raw({ type: '*/*' }), handleVeloWebhook);
app.get('/api/webhook-tester', (req, res) => {
  res.status(200).json({
    status: 'OK',
    endpoint: '/api/webhooks/velo',
    live: true,
    webhookSecretConfigured: Boolean(process.env.VELO_WEBHOOK_SECRET),
  });
});

// Middleware
app.use(express.json());

// CORS Proxy for Velo wallet config (identical to awiten-pay implementation)
app.get('/api/v1/wallet-config/:projectKey', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, Accept');

  const projectKey = req.params.projectKey || VELO_PROJECT_KEY;
  const fallbackConfig = {
    appearance: {
      button: { radius: 'rounded', size: 'lg', variant: 'solid' },
      buttonLabel: 'Connect wallet',
      fontFamily: 'system',
      modal: { radius: 'md', shadow: 'md' },
      palettes: {
        dark: {
          accent: '#FAFAFA',
          accentText: '#18181B',
          background: '#09090B',
          border: '#A1A1AA',
          danger: '#F87171',
          focusRing: '#60A5FA',
          mutedText: '#D4D4D8',
          surface: '#18181B',
          surfaceMuted: '#27272A',
          text: '#FAFAFA',
        },
        light: {
          accent: '#18181B',
          accentText: '#FFFFFF',
          background: '#FFFFFF',
          border: '#71717A',
          danger: '#B91C1C',
          focusRing: '#2563EB',
          mutedText: '#52525B',
          surface: '#F4F4F5',
          surfaceMuted: '#E4E4E7',
          text: '#18181B',
        },
      },
      theme: 'dark',
    },
    modal: { hideUnsupportedWallets: false, showInstallLabel: true },
    network: 'testnet',
    projectKey,
    projectLogoUrl: '',
    revision: 1,
    runtimeMajor: 1,
    schemaVersion: 1,
    selectorLogo: 'project',
    session: { persist: true },
    walletIds: ['freighter', 'noir'],
  };

  try {
    const upstreamUrl = `https://www.velo-build.dev/api/v1/wallet-config/${encodeURIComponent(projectKey)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const upstreamResp = await fetch(upstreamUrl, {
      headers: {
        Origin: 'http://localhost:3000',
        Accept: 'application/json',
        'User-Agent': 'SweldoSync-Proxy/1.0',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (upstreamResp.ok) {
      const data = await upstreamResp.json();
      return res.status(200).json(data);
    }
  } catch (err) {
    // Return fallback on network error or timeout
  }

  return res.status(200).json(fallbackConfig);
});

// REST Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    app: 'SweldoSync',
    network: STELLAR_CONFIG.NETWORK,
    projectKey: VELO_PROJECT_KEY,
    contracts: CONTRACT_IDS,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/employees', (req, res) => {
  res.json({
    success: true,
    count: employees.length,
    employees,
  });
});

app.post('/api/employees/:id/bind-wallet', (req, res) => {
  const { id } = req.params;
  const rawAddr = req.body?.walletAddress;
  const cleanAddr = String(rawAddr || '').trim().replace(/^['"`]|['"`]$/g, '').trim();

  if (!cleanAddr || !StellarSdk.StrKey.isValidEd25519PublicKey(cleanAddr)) {
    return res.status(400).json({ success: false, error: 'Invalid Stellar public key' });
  }

  const emp = employees.find((e) => e.id === id);
  if (!emp) {
    return res.status(404).json({ success: false, error: 'Employee not found' });
  }

  emp.walletAddress = cleanAddr;
  console.log(`[Roster] Bound employee ${emp.id} (${emp.name}) to wallet ${cleanAddr}`);
  return res.json({ success: true, employee: emp });
});

app.get('/api/worklogs', (req, res) => {
  res.json({
    success: true,
    count: workLogs.length,
    workLogs,
  });
});

app.post('/api/worklogs', (req, res) => {
  const { employeeId, date, hoursLogged, notes } = req.body;
  if (!employeeId || hoursLogged === undefined || hoursLogged === null) {
    return res.status(400).json({
      success: false,
      error: 'employeeId and hoursLogged are required.',
    });
  }

  const parsedHours = Number(hoursLogged);
  const newLog = {
    id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    employeeId,
    date: date || new Date().toISOString().slice(0, 10),
    hoursLogged: parsedHours,
    notes: notes || '',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  workLogs.unshift(newLog);
  console.log(`[WorkLog Ingested] ${newLog.id} for ${employeeId} (${parsedHours}h)`);

  res.status(201).json({
    success: true,
    workLog: newLog,
  });
});

app.post('/api/agent/cycle', async (req, res) => {
  const pendingLogs = workLogs.filter((log) => log.status === 'PENDING');
  const receipts = [];

  console.log(`[Agent Cycle] Processing ${pendingLogs.length} pending work logs...`);

  for (const log of pendingLogs) {
    const employee = employees.find((e) => e.id === log.employeeId);
    const receipt = await agent.processWorkLog(
      log,
      employee,
      workLogs,
      transferTestnetXlmToConnectedWallet
    );

    // Update work log status
    if (receipt.action === 'AUTONOMOUSLY_DISBURSED') {
      log.status = 'DISBURSED';
    } else if (receipt.action === 'FLAGGED_FOR_AUDIT') {
      log.status = 'FLAGGED_FOR_AUDIT';
    } else {
      log.status = 'HOLD_FOR_APPROVAL';
    }

    log.receiptId = receipt.id;
    auditLog.unshift(receipt);
    receipts.push(receipt);
  }

  res.json({
    success: true,
    processedCount: receipts.length,
    receipts,
  });
});

app.get('/api/payroll/audit-log', (req, res) => {
  res.json({
    success: true,
    count: auditLog.length,
    auditLog,
  });
});

// Serve frontend static files
const webPath = path.resolve(__dirname, '../../web');
if (fs.existsSync(webPath)) {
  app.use(express.static(webPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webPath, 'index.html'));
  });
}

// Start server if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`[START] SweldoSync Express Server running on http://localhost:${PORT}`);
    console.log(`[CONFIG] Velo Project Key: ${VELO_PROJECT_KEY}`);
    console.log(`[CONFIG] Stellar Network: ${STELLAR_CONFIG.NETWORK}`);
  });
}

export { app, employees, workLogs, auditLog };
