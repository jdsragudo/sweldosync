/**
 * SweldoSync 2.0 Shared Configuration, Constants, and Exact Stroop Math
 * Zero hardcoded secrets. Zero emojis.
 */

const env = typeof process !== 'undefined' && process?.env ? process.env : {};

export const STROOPS_PER_UNIT = 10_000_000n;

export const CONTRACT_IDS = {
  DEVICE_REGISTRY:
    env.NOIR_DEVICE_REGISTRY_CONTRACT_ID ||
    'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5',
  AGENT_REGISTRY:
    env.NOIR_AGENT_REGISTRY_CONTRACT_ID ||
    'CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV',
  PAYMENT_ESCROW:
    env.NOIR_PAYMENT_ESCROW_CONTRACT_ID ||
    'CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS',
  NATIVE_SAC:
    env.NOIR_NATIVE_SAC_CONTRACT_ID ||
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
};

export const NETWORKS_CONFIG = {
  testnet: {
    id: 'testnet',
    name: 'Stellar Testnet',
    horizonUrl: env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    rpcUrl: env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    friendbotUrl: 'https://friendbot.stellar.org',
    explorerBaseUrl: 'https://stellar.expert/explorer/testnet',
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
  mainnet: {
    id: 'mainnet',
    name: 'Stellar Mainnet',
    horizonUrl: env.STELLAR_MAINNET_HORIZON_URL || 'https://horizon.stellar.org',
    rpcUrl: env.STELLAR_MAINNET_RPC_URL || 'https://soroban-rpc.mainnet.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    friendbotUrl: null,
    explorerBaseUrl: 'https://stellar.expert/explorer/public',
    usdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
};

export const STELLAR_CONFIG = {
  NETWORK: env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
  HORIZON_URL: NETWORKS_CONFIG.testnet.horizonUrl,
  RPC_URL: NETWORKS_CONFIG.testnet.rpcUrl,
  NETWORK_PASSPHRASE: NETWORKS_CONFIG.testnet.networkPassphrase,
  FRIENDBOT_URL: NETWORKS_CONFIG.testnet.friendbotUrl,
};

export const PAYROLL_CONFIG = {
  STANDARD_WORK_HOURS: 8,
  MAX_SHIFT_HOURS: 16,
  OVERTIME_MULTIPLIER: 1.25,
  DEFAULT_WITHHOLDING_PCT: 5,
  WITHHOLDING_RATE: 0.05,
  DEFAULT_MAX_AUTO_PAYOUT: 1000,
  DEFAULT_FX_USD_PER_XLM: '0.2400000',
  FX_MAX_AGE_MS: 10 * 60 * 1000,
  MAX_OPS_PER_CHUNK: 100,
};

export const DEFAULT_EMPLOYEES = [
  {
    id: 'EMP-001',
    name: 'Juan Dela Cruz',
    role: 'Lead Systems Engineer',
    department: 'Protocol Engineering',
    hourlyRate: '28.00',
    currency: 'USD',
    settlementAsset: 'XLM',
    regularHoursCap: 8,
    overtimeMultiplier: 1.25,
    withholdingPct: 5,
    maxAutoPayout: '500.00',
    walletAddress: 'GDXRSQMQ4FL3XD4YQ3U6FC2ZYGDYEPOPEUF2BFBJFV2FRQAK2V63L67R',
    isActive: true,
  },
  {
    id: 'EMP-002',
    name: 'Maria Santos',
    role: 'Frontend Architect',
    department: 'Product & Design',
    hourlyRate: '24.00',
    currency: 'USDC',
    settlementAsset: 'XLM',
    regularHoursCap: 8,
    overtimeMultiplier: 1.25,
    withholdingPct: 5,
    maxAutoPayout: '450.00',
    walletAddress: 'GDAS4D7DKNXV7EYQMHRLWVMURN3CPPAIF2HHRPEMSUT2TNR54RY25JPP',
    isActive: true,
  },
  {
    id: 'EMP-003',
    name: 'Ramon Valderama',
    role: 'Field Operations Lead',
    department: 'Logistics',
    hourlyRate: '20.00',
    currency: 'XLM',
    settlementAsset: 'XLM',
    regularHoursCap: 8,
    overtimeMultiplier: 1.25,
    withholdingPct: 5,
    maxAutoPayout: '1200.00',
    walletAddress: 'GD2RAHK4BX6ZGNX5TPFJBWDWMGAQPQDI6US64T6IKHMQ5K4BLJLC77G2',
    isActive: true,
  },
  {
    id: 'EMP-004',
    name: 'Elena Navarro',
    role: 'QA & Compliance Analyst',
    department: 'Finance Ops',
    hourlyRate: '22.00',
    currency: 'USD',
    settlementAsset: 'XLM',
    regularHoursCap: 8,
    overtimeMultiplier: 1.25,
    withholdingPct: 8,
    maxAutoPayout: '600.00',
    walletAddress: 'GB63CJ3XU5PNZRRYH5SKIZZZ7ST3CRLXKZPA5GMW5CZYSPG6TNMKTK7Q',
    isActive: true,
  },
];

export function formatExplorerTxUrl(txHash, network = 'testnet') {
  if (!txHash) return '';
  const cfg = NETWORKS_CONFIG[network] || NETWORKS_CONFIG.testnet;
  return `${cfg.explorerBaseUrl}/tx/${txHash}`;
}

export function truncateStellarAddress(addr, head = 4, tail = 4) {
  if (!addr || typeof addr !== 'string') return '';
  const trimmed = addr.trim();
  if (trimmed.length <= head + tail + 3) return trimmed;
  return `${trimmed.slice(0, head)}...${trimmed.slice(-tail)}`;
}

export function roundToDecimals(val, decimals = 4) {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(val) + Number.EPSILON) * factor) / factor;
}

function normalizeNumberToDecimalString(num) {
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid numeric amount: ${num}`);
  }
  if (num === 0) return '0';
  // Use 12 decimal places when magnitude fits safely, neutralizing IEEE-754 noise like 0.30000000000000004
  const abs = Math.abs(num);
  if (abs < 1e12 && abs >= 1e-12) {
    return num.toFixed(12).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  }
  return num.toString();
}

function expandScientificNotation(rawStr) {
  const match = rawStr.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) {
    const leadingDot = rawStr.match(/^([+-]?)\.(\d+)(?:[eE]([+-]?\d+))?$/);
    if (!leadingDot) {
      throw new Error(`Invalid decimal string: "${rawStr}"`);
    }
    const [, sign, frac, expStr] = leadingDot;
    return expandParts(sign, '0', frac, expStr ? parseInt(expStr, 10) : 0);
  }
  const [, sign, intPart, fracPart = '', expStr] = match;
  return expandParts(sign, intPart, fracPart, expStr ? parseInt(expStr, 10) : 0);
}

function expandParts(sign, intPart, fracPart, exp) {
  const digits = `${intPart}${fracPart}`;
  const decimalPos = intPart.length + exp;
  let intStr = '0';
  let fracStr = '';
  if (decimalPos <= 0) {
    intStr = '0';
    fracStr = '0'.repeat(-decimalPos) + digits;
  } else if (decimalPos >= digits.length) {
    intStr = digits + '0'.repeat(decimalPos - digits.length);
    fracStr = '';
  } else {
    intStr = digits.slice(0, decimalPos);
    fracStr = digits.slice(decimalPos);
  }
  intStr = intStr.replace(/^0+/, '') || '0';
  return { negative: sign === '-', intStr, fracStr };
}

/**
 * Deterministically convert decimal string or number into BigInt stroops (1 unit = 10,000,000 stroops).
 * Applies HALF_UP rounding on the 8th decimal digit without IEEE-754 float drift.
 *
 * @param {string|number|bigint} amount
 * @returns {bigint}
 */
export function toStroops(amount) {
  if (typeof amount === 'bigint') {
    return amount * STROOPS_PER_UNIT;
  }

  let rawStr;
  if (typeof amount === 'number') {
    rawStr = normalizeNumberToDecimalString(amount);
  } else if (typeof amount === 'string') {
    rawStr = amount.trim();
    if (!rawStr) {
      throw new Error('Amount string cannot be empty');
    }
  } else {
    throw new Error(`Unsupported amount type: ${typeof amount}`);
  }

  const { negative, intStr, fracStr } = expandScientificNotation(rawStr);
  const fracPadded = (fracStr + '00000000').slice(0, 8);
  const sevenDigits = fracPadded.slice(0, 7);
  const eighthDigit = Number(fracPadded[7] || '0');

  let stroops = BigInt(intStr) * STROOPS_PER_UNIT + BigInt(sevenDigits);
  if (eighthDigit >= 5) {
    stroops += 1n;
  }

  return negative && stroops !== 0n ? -stroops : stroops;
}

/**
 * Format BigInt/integer stroops back into a fixed 7-decimal Stellar amount string.
 *
 * @param {bigint|number|string} stroops
 * @returns {string}
 */
export function fromStroopsToString(stroops) {
  const val = typeof stroops === 'bigint' ? stroops : BigInt(stroops);
  const negative = val < 0n;
  const abs = negative ? -val : val;
  const intPart = abs / STROOPS_PER_UNIT;
  const fracPart = (abs % STROOPS_PER_UNIT).toString().padStart(7, '0');
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

export function fromStroops(stroops) {
  return Number(fromStroopsToString(stroops));
}
