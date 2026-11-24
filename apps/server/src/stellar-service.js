/**
 * SweldoSync 2.0 Stellar Horizon & XDR Service
 *
 * - Ephemeral Testnet Demo Treasury keypair persistence in DATA_DIR (0 hardcoded secrets)
 * - Smart recipient operation routing (payment, createAccount, createClaimableBalance)
 * - XDR-level Demo Signer Mainnet guard (HTTP 403)
 * - Live Horizon balance & FX quote with graceful fallback
 * - Sequential chunk XDR builder (<=100 ops/tx, Memo.hash, setTimeout(180)) and idempotent submitter
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  Asset,
  Claimant,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  NETWORKS_CONFIG,
  PAYROLL_CONFIG,
  STROOPS_PER_UNIT,
  formatExplorerTxUrl,
  fromStroopsToString,
  toStroops,
} from '../../../packages/shared/src/index.js';

const MAINNET_USDC_ISSUER = NETWORKS_CONFIG.mainnet.usdcIssuer;
const ONE_XLM_STROOPS = 10_000_000n;
const RESERVE_PER_ENTRY_STROOPS = 5_000_000n; // 0.5 XLM
const RECLAIM_DELAY_SECONDS = '2592000'; // 30 days

let cachedFxQuote = {
  usdPerXlm: PAYROLL_CONFIG.DEFAULT_FX_USD_PER_XLM,
  source: 'cached_fallback',
  timestamp: new Date().toISOString(),
  fetchedAtMs: 0,
};

function cleanKeyString(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/^['"`]|['"`]$/g, '').trim();
}

export function getNetworkConfig(network = 'testnet') {
  return network === 'mainnet' ? NETWORKS_CONFIG.mainnet : NETWORKS_CONFIG.testnet;
}

export function getHorizonServer(network = 'testnet') {
  const cfg = getNetworkConfig(network);
  return new Horizon.Server(cfg.horizonUrl);
}

/**
 * Resolve Testnet Demo Treasury keypair:
 * 1) process.env.AGENT_SECRET_KEY || process.env.OWNER_SECRET_KEY
 * 2) DATA_DIR/demo-treasury.json (mode 0600)
 * 3) Generate Keypair.random() and persist to DATA_DIR/demo-treasury.json (0600)
 * Never hardcoded. Never returned in public exports.
 */
export function resolveDemoTreasuryKeypair(dataDir, env = process.env) {
  const envCandidates = [env.AGENT_SECRET_KEY, env.OWNER_SECRET_KEY];
  for (const raw of envCandidates) {
    const clean = cleanKeyString(raw);
    if (clean && StrKey.isValidEd25519SecretSeed(clean)) {
      try {
        return Keypair.fromSecret(clean);
      } catch {
        // try next
      }
    }
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, 'demo-treasury.json');
  if (fs.existsSync(keyFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      const clean = cleanKeyString(parsed?.secretKey);
      if (clean && StrKey.isValidEd25519SecretSeed(clean)) {
        return Keypair.fromSecret(clean);
      }
    } catch {
      // regenerate below if corrupted
    }
  }

  const kp = Keypair.random();
  const payload = JSON.stringify(
    {
      publicKey: kp.publicKey(),
      secretKey: kp.secret(),
      createdAt: new Date().toISOString(),
    },
    null,
    2
  );
  fs.writeFileSync(keyFile, payload, { mode: 0o600 });
  try {
    fs.chmodSync(keyFile, 0o600);
  } catch {
    // ignore chmod failures on non-POSIX filesystems
  }
  return kp;
}

/**
 * Route a single recipient payout to the safest Stellar operation:
 * - Self-payment (destination === treasuryAddress) -> throws error
 * - Native XLM + existing account -> Operation.payment
 * - Native XLM + unfunded account + amount >= 1 XLM -> Operation.createAccount
 * - Native XLM + unfunded account + amount < 1 XLM -> Operation.createClaimableBalance (2 claimants)
 * - Issued asset (USDC) + existing account + active authorized trustline with room -> Operation.payment
 * - Issued asset (USDC) missing account/trustline/limit -> Operation.createClaimableBalance (2 claimants)
 */
export async function routeRecipientOperation({
  destination,
  assetCode = 'XLM',
  assetIssuer = null,
  amount,
  accountExists,
  hasTrustline,
  trustlineLimitStroops,
  trustlineBalanceStroops = 0n,
  isAuthorized = true,
  treasuryAddress,
  server,
}) {
  const cleanDest = cleanKeyString(destination);
  const cleanTreasury = cleanKeyString(treasuryAddress);

  if (!cleanDest || !StrKey.isValidEd25519PublicKey(cleanDest)) {
    throw Object.assign(new Error(`Invalid destination Stellar public key: ${destination}`), {
      status: 400,
    });
  }

  if (cleanTreasury && cleanDest === cleanTreasury) {
    throw Object.assign(new Error('Self-payment blocked: destination matches treasuryAddress'), {
      status: 400,
    });
  }

  const amountStroops = toStroops(amount);
  if (amountStroops <= 0n) {
    throw Object.assign(new Error('Recipient payout amount must be positive'), { status: 400 });
  }
  const amountStr = fromStroopsToString(amountStroops);
  const normalizedAsset = String(assetCode || 'XLM').toUpperCase();
  const stellarAsset =
    normalizedAsset === 'XLM' ? Asset.native() : new Asset(normalizedAsset, assetIssuer);

  let resolvedExists = accountExists;
  let resolvedTrustline = hasTrustline;
  let resolvedLimit = trustlineLimitStroops !== undefined ? BigInt(trustlineLimitStroops) : undefined;
  let resolvedBalance = BigInt(trustlineBalanceStroops || 0n);
  let resolvedAuth = isAuthorized;

  if (resolvedExists === undefined && server) {
    try {
      const account = await server.loadAccount(cleanDest);
      resolvedExists = true;
      if (normalizedAsset !== 'XLM') {
        const line = (account.balances || []).find(
          (b) => b.asset_code === normalizedAsset && b.asset_issuer === assetIssuer
        );
        if (line) {
          resolvedTrustline = true;
          resolvedAuth = line.is_authorized !== false;
          if (line.limit !== undefined) {
            resolvedLimit = toStroops(line.limit);
          }
          if (line.balance !== undefined) {
            resolvedBalance = toStroops(line.balance);
          }
        } else {
          resolvedTrustline = false;
        }
      }
    } catch (err) {
      const status = err?.response?.status || err?.status;
      if (status === 404) {
        resolvedExists = false;
        resolvedTrustline = false;
      } else {
        throw err;
      }
    }
  }

  if (normalizedAsset === 'XLM') {
    if (resolvedExists) {
      return {
        kind: 'payment',
        operation: Operation.payment({
          destination: cleanDest,
          asset: Asset.native(),
          amount: amountStr,
        }),
      };
    }

    if (amountStroops >= ONE_XLM_STROOPS) {
      return {
        kind: 'createAccount',
        operation: Operation.createAccount({
          destination: cleanDest,
          startingBalance: amountStr,
        }),
      };
    }
  } else {
    const hasRoom =
      resolvedLimit === undefined || resolvedLimit - resolvedBalance >= amountStroops;
    if (resolvedExists && resolvedTrustline && resolvedAuth && hasRoom) {
      return {
        kind: 'payment',
        operation: Operation.payment({
          destination: cleanDest,
          asset: stellarAsset,
          amount: amountStr,
        }),
      };
    }
  }

  const reclaimAddress = cleanTreasury || cleanDest;
  const claimants = [
    new Claimant(cleanDest, Claimant.predicateUnconditional()),
    new Claimant(
      reclaimAddress,
      Claimant.predicateNot(Claimant.predicateBeforeRelativeTime(RECLAIM_DELAY_SECONDS))
    ),
  ];

  return {
    kind: 'createClaimableBalance',
    claimants,
    operation: Operation.createClaimableBalance({
      asset: stellarAsset,
      amount: amountStr,
      claimants,
    }),
  };
}

/**
 * XDR-level guard: Demo Treasury signer is strictly forbidden on Mainnet.
 * Throws Error with status=403 on any Mainnet transaction, context, USDC issuer, or hash mismatch.
 */
export function assertDemoSignAllowed(txOrXdr, opts = {}) {
  const forbid = (reason) => {
    const err = new Error(`Demo signer forbidden on Mainnet: ${reason}`);
    err.status = 403;
    throw err;
  };

  if (opts.network === 'mainnet') {
    forbid('network is mainnet');
  }
  if (opts.networkPassphrase === Networks.PUBLIC) {
    forbid('networkPassphrase is Mainnet');
  }
  if (!txOrXdr) {
    forbid('missing transaction or XDR');
  }

  let tx = null;
  if (typeof txOrXdr === 'object') {
    if (txOrXdr.networkPassphrase === Networks.PUBLIC) {
      forbid('transaction carries Mainnet networkPassphrase');
    }
    tx = txOrXdr;
  } else if (typeof txOrXdr === 'string') {
    const passphrase = opts.networkPassphrase || Networks.TESTNET;
    try {
      tx = TransactionBuilder.fromXDR(txOrXdr, passphrase);
    } catch (err) {
      forbid(`unparseable XDR (${err.message})`);
    }
  } else {
    forbid('invalid transaction payload');
  }

  const ops = tx?.operations || [];
  for (const op of ops) {
    if (op?.asset?.issuer === MAINNET_USDC_ISSUER) {
      forbid('XDR references Circle Mainnet USDC issuer');
    }
    if (Array.isArray(op?.path)) {
      for (const p of op.path) {
        if (p?.issuer === MAINNET_USDC_ISSUER) {
          forbid('XDR path references Mainnet USDC issuer');
        }
      }
    }
  }

  if (opts.expectedTestnetHash) {
    const testnetTx =
      typeof txOrXdr === 'string'
        ? TransactionBuilder.fromXDR(txOrXdr, Networks.TESTNET)
        : txOrXdr;
    const actualHash = testnetTx.hash().toString('hex');
    if (actualHash !== opts.expectedTestnetHash) {
      forbid('XDR hash does not match stored Testnet chunk hash');
    }
  }

  return true;
}

/**
 * Fetch treasury account balances & reserve headroom from Horizon.
 */
export async function getTreasuryStatus({ publicKey, network = 'testnet' }) {
  const cfg = getNetworkConfig(network);
  if (!publicKey || !StrKey.isValidEd25519PublicKey(publicKey)) {
    return {
      publicKey: publicKey || null,
      network,
      exists: false,
      xlmBalance: '0.0000000',
      usdcBalance: '0.0000000',
      availableXlm: '0.0000000',
      subentryCount: 0,
      reserveXlm: '1.0000000',
    };
  }

  const server = getHorizonServer(network);
  try {
    const acc = await server.loadAccount(publicKey);
    const nativeLine = (acc.balances || []).find((b) => b.asset_type === 'native');
    const usdcLine = (acc.balances || []).find(
      (b) => b.asset_code === 'USDC' && b.asset_issuer === cfg.usdcIssuer
    );
    const xlmStroops = nativeLine ? toStroops(nativeLine.balance) : 0n;
    const usdcStroops = usdcLine ? toStroops(usdcLine.balance) : 0n;
    const subentryCount = Number(acc.subentry_count || 0);
    const reserveStroops = BigInt(2 + subentryCount) * RESERVE_PER_ENTRY_STROOPS;
    const availableStroops = xlmStroops > reserveStroops ? xlmStroops - reserveStroops : 0n;

    return {
      publicKey,
      network,
      exists: true,
      xlmBalance: fromStroopsToString(xlmStroops),
      usdcBalance: fromStroopsToString(usdcStroops),
      availableXlm: fromStroopsToString(availableStroops),
      subentryCount,
      reserveXlm: fromStroopsToString(reserveStroops),
      sequenceNumber: acc.sequenceNumber(),
    };
  } catch (err) {
    const status = err?.response?.status || err?.status;
    if (status === 404) {
      return {
        publicKey,
        network,
        exists: false,
        xlmBalance: '0.0000000',
        usdcBalance: '0.0000000',
        availableXlm: '0.0000000',
        subentryCount: 0,
        reserveXlm: '1.0000000',
      };
    }
    return {
      publicKey,
      network,
      exists: false,
      xlmBalance: '0.0000000',
      usdcBalance: '0.0000000',
      availableXlm: '0.0000000',
      subentryCount: 0,
      reserveXlm: '1.0000000',
      horizonError: err?.message || 'Horizon unreachable',
    };
  }
}

/**
 * Fetch live XLM/USD spot FX quote with 5s timeout and cached fallback.
 */
export async function getFxQuote({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedFxQuote.fetchedAtMs > 0 && now - cachedFxQuote.fetchedAtMs < 60_000) {
    return { ...cachedFxQuote };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch('https://api.coinbase.com/v2/prices/XLM-USD/spot', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (resp.ok) {
      const json = await resp.json();
      const amount = json?.data?.amount;
      if (amount && Number(amount) > 0) {
        const formatted = fromStroopsToString(toStroops(amount));
        cachedFxQuote = {
          usdPerXlm: formatted,
          source: 'coinbase_spot',
          timestamp: new Date().toISOString(),
          fetchedAtMs: Date.now(),
        };
        return { ...cachedFxQuote };
      }
    }
  } catch {
    // try fallback source or cached
  } finally {
    clearTimeout(timer);
  }

  return {
    ...cachedFxQuote,
    timestamp: cachedFxQuote.fetchedAtMs > 0 ? cachedFxQuote.timestamp : new Date().toISOString(),
  };
}

export function isFxQuoteStale(fxTimestamp, maxAgeMs = PAYROLL_CONFIG.FX_MAX_AGE_MS) {
  if (!fxTimestamp) return true;
  const ts = Date.parse(fxTimestamp);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > maxAgeMs;
}

/**
 * Fund a Stellar Testnet account via Friendbot.
 */
export async function fundTestnetAccount(publicKey) {
  const cleanKey = cleanKeyString(publicKey);
  if (!cleanKey || !StrKey.isValidEd25519PublicKey(cleanKey)) {
    throw Object.assign(new Error('Invalid Stellar public key'), { status: 400 });
  }

  const server = getHorizonServer('testnet');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(
      `${NETWORKS_CONFIG.testnet.friendbotUrl}?addr=${encodeURIComponent(cleanKey)}`,
      { signal: controller.signal }
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw Object.assign(new Error(`Friendbot returned HTTP ${resp.status}: ${txt}`), {
        status: 502,
      });
    }
    await resp.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }

  const status = await getTreasuryStatus({ publicKey: cleanKey, network: 'testnet' });
  return { funded: true, server: server.serverURL.toString(), ...status };
}

/**
 * Build an unsigned Stellar transaction for a pay-run chunk (<=100 operations).
 * Includes Memo.hash(sha256Buffer), bounded setTimeout(180), and reserve preflight check.
 */
export async function buildChunkTransaction({
  network = 'testnet',
  treasuryAddress,
  chunkItems,
  memoHashHex,
  assetCode = 'XLM',
  assetIssuer = null,
}) {
  const cfg = getNetworkConfig(network);
  const cleanTreasury = cleanKeyString(treasuryAddress);
  if (!cleanTreasury || !StrKey.isValidEd25519PublicKey(cleanTreasury)) {
    throw Object.assign(new Error('Valid treasuryAddress is required to build XDR'), {
      status: 400,
    });
  }
  if (!Array.isArray(chunkItems) || chunkItems.length === 0) {
    throw Object.assign(new Error('Chunk has no payout items'), { status: 400 });
  }
  if (chunkItems.length > PAYROLL_CONFIG.MAX_OPS_PER_CHUNK) {
    throw Object.assign(
      new Error(`Chunk exceeds ${PAYROLL_CONFIG.MAX_OPS_PER_CHUNK} Stellar operations limit`),
      { status: 400 }
    );
  }

  const server = getHorizonServer(network);
  let sourceAccount;
  try {
    sourceAccount = await server.loadAccount(cleanTreasury);
  } catch (err) {
    const status = err?.response?.status || err?.status;
    if (status === 404) {
      throw Object.assign(
        new Error(
          `Treasury account ${cleanTreasury} is not funded on ${cfg.name}. Fund it first before building transactions.`
        ),
        { status: 400 }
      );
    }
    throw err;
  }

  let baseFee = 100;
  try {
    const fetchedFee = await server.fetchBaseFee();
    baseFee = Math.min(Math.max(Number(fetchedFee) || 100, 100), 10_000);
  } catch {
    baseFee = 200;
  }

  const routingSummary = {
    payment: 0,
    createAccount: 0,
    createClaimableBalance: 0,
  };
  const itemRoutings = [];
  const builder = new TransactionBuilder(sourceAccount, {
    fee: String(baseFee),
    networkPassphrase: cfg.networkPassphrase,
  });

  let totalOutflowStroops = 0n;
  for (const item of chunkItems) {
    const routed = await routeRecipientOperation({
      destination: item.walletAddress,
      assetCode,
      assetIssuer: assetCode === 'USDC' ? assetIssuer || cfg.usdcIssuer : null,
      amount: item.settlementAmount,
      treasuryAddress: cleanTreasury,
      server,
    });
    routingSummary[routed.kind] = (routingSummary[routed.kind] || 0) + 1;
    itemRoutings.push({
      id: item.id,
      employeeId: item.employeeId,
      routingKind: routed.kind,
    });
    builder.addOperation(routed.operation);
    totalOutflowStroops += toStroops(item.settlementAmount);
  }

  // Preflight treasury balance & Stellar reserve check
  const newClaimableBalances = routingSummary.createClaimableBalance || 0;
  const subentryCount = Number(sourceAccount.subentry_count || 0);
  const requiredReserveStroops =
    BigInt(2 + subentryCount + newClaimableBalances) * RESERVE_PER_ENTRY_STROOPS;
  const totalFeeStroops = BigInt(baseFee) * BigInt(chunkItems.length);

  const nativeLine = (sourceAccount.balances || []).find((b) => b.asset_type === 'native');
  const treasuryXlmStroops = nativeLine ? toStroops(nativeLine.balance) : 0n;
  const usdcLine = (sourceAccount.balances || []).find(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === (assetIssuer || cfg.usdcIssuer)
  );
  const treasuryUsdcStroops = usdcLine ? toStroops(usdcLine.balance) : 0n;

  const requiredXlmStroops =
    assetCode === 'XLM'
      ? totalOutflowStroops + totalFeeStroops + requiredReserveStroops
      : totalFeeStroops + requiredReserveStroops;

  const preflightWarnings = [];
  let preflightOk = true;
  if (treasuryXlmStroops < requiredXlmStroops) {
    preflightOk = false;
    preflightWarnings.push(
      `Treasury XLM balance (${fromStroopsToString(treasuryXlmStroops)}) is below required ${fromStroopsToString(requiredXlmStroops)} XLM (includes fees + ${fromStroopsToString(requiredReserveStroops)} reserve).`
    );
  }
  if (assetCode === 'USDC' && treasuryUsdcStroops < totalOutflowStroops) {
    preflightOk = false;
    preflightWarnings.push(
      `Treasury USDC balance (${fromStroopsToString(treasuryUsdcStroops)}) is below required ${fromStroopsToString(totalOutflowStroops)} USDC.`
    );
  }

  if (memoHashHex && /^[0-9a-f]{64}$/i.test(memoHashHex)) {
    builder.addMemo(Memo.hash(Buffer.from(memoHashHex, 'hex')));
  }

  const tx = builder.setTimeout(180).build();
  return {
    unsignedXdr: tx.toXDR(),
    txHash: tx.hash().toString('hex'),
    sequenceNumber: sourceAccount.sequenceNumber(),
    networkPassphrase: cfg.networkPassphrase,
    opCount: chunkItems.length,
    feeStroopsPerOp: baseFee,
    totalFeeXlm: fromStroopsToString(totalFeeStroops),
    requiredReserveXlm: fromStroopsToString(requiredReserveStroops),
    routingSummary,
    itemRoutings,
    preflight: {
      ok: preflightOk,
      warnings: preflightWarnings,
      treasuryXlmBalance: fromStroopsToString(treasuryXlmStroops),
      treasuryUsdcBalance: fromStroopsToString(treasuryUsdcStroops),
      requiredXlm: fromStroopsToString(requiredXlmStroops),
      requiredOutflow: fromStroopsToString(totalOutflowStroops),
    },
  };
}

/**
 * Submit a signed Stellar transaction XDR with hash verification and 504 idempotency check.
 */
export async function submitSignedChunkXdr({
  network = 'testnet',
  signedXdr,
  expectedTxHash,
  expectedSourceAccount,
}) {
  const cfg = getNetworkConfig(network);
  if (!signedXdr || typeof signedXdr !== 'string') {
    throw Object.assign(new Error('signedXdr is required'), { status: 400 });
  }

  let tx;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, cfg.networkPassphrase);
  } catch (err) {
    throw Object.assign(new Error(`Invalid signed XDR for ${cfg.name}: ${err.message}`), {
      status: 400,
    });
  }

  const actualHash = tx.hash().toString('hex');
  if (expectedTxHash && actualHash !== expectedTxHash) {
    throw Object.assign(
      new Error('Signed transaction hash does not match the server-built chunk txHash'),
      { status: 400 }
    );
  }
  if (expectedSourceAccount && tx.source !== expectedSourceAccount) {
    throw Object.assign(
      new Error('Signed transaction source account mismatch'),
      { status: 400 }
    );
  }

  const server = getHorizonServer(network);

  const attemptSubmit = async () => {
    const result = await server.submitTransaction(tx);
    return {
      txHash: result.hash || actualHash,
      ledger: result.ledger || null,
      explorerUrl: formatExplorerTxUrl(result.hash || actualHash, network),
      alreadySubmitted: false,
    };
  };

  try {
    return await attemptSubmit();
  } catch (err) {
    const status = err?.response?.status || err?.status;
    // On Horizon 504/5xx timeout, query /transactions/:hash before retrying same signedXdr
    if (status === 504 || status >= 500 || !status) {
      try {
        const existing = await server.transactions().transaction(actualHash).call();
        return {
          txHash: existing.hash || actualHash,
          ledger: existing.ledger || null,
          explorerUrl: formatExplorerTxUrl(existing.hash || actualHash, network),
          alreadySubmitted: true,
        };
      } catch (lookupErr) {
        const lookupStatus = lookupErr?.response?.status || lookupErr?.status;
        if (lookupStatus === 404) {
          const maxTime = Number(tx?.timeBounds?.maxTime || 0);
          const nowSec = Math.floor(Date.now() / 1000);
          if (!maxTime || nowSec < maxTime) {
            return await attemptSubmit();
          }
        }
      }
    }

    const resultCodes = err?.response?.data?.extras?.result_codes;
    const detail = resultCodes ? JSON.stringify(resultCodes) : err?.message || 'Submission failed';
    throw Object.assign(new Error(`Stellar Horizon submission failed: ${detail}`), {
      status: status && status >= 400 && status < 500 ? 400 : 502,
      resultCodes,
    });
  }
}
