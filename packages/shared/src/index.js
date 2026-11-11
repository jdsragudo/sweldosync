/**
 * SweldoSync Shared Configuration and Utilities
 * 0 Emojis rule enforced.
 */

export const VELO_PROJECT_KEY = 'vw_pk_JfssyvlfNeu7dYgW4dXuGccU8s2m5f-X';
export const VELO_API_KEY = 'tk_live_3d5e9d72414374917173f784cc446e28';

export const CONTRACT_IDS = {
  DEVICE_REGISTRY: 'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5',
  AGENT_REGISTRY: 'CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV',
  PAYMENT_ESCROW: 'CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS',
  NATIVE_SAC: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
};

export const STELLAR_CONFIG = {
  NETWORK: 'testnet',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  FRIENDBOT_URL: 'https://friendbot.stellar.org',
};

export const PAYROLL_CONFIG = {
  MAX_SHIFT_HOURS: 16,
  STANDARD_WORK_HOURS: 8,
  OVERTIME_MULTIPLIER: 1.25,
  WITHHOLDING_RATE: 0.05,
  DEFAULT_MAX_AUTO_PAYOUT_XLM: 200.0,
};

export const DEFAULT_EMPLOYEES = [
  {
    id: 'EMP-001',
    name: 'Juan Dela Cruz',
    role: 'Lead Systems Engineer',
    rateType: 'HOURLY',
    rateXlm: 2.50,
    walletAddress: 'GBZOFVJBXQADCCG2BOBC4DTBUSSSTA4OYJR3P4EZCZ75JHYHHQ6PLOLD',
    maxAutoPayoutXlm: 100.0,
    isActive: true,
  },
  {
    id: 'EMP-002',
    name: 'Maria Santos',
    role: 'Frontend Architect',
    rateType: 'HOURLY',
    rateXlm: 2.00,
    walletAddress: 'GATDP2GAYZZB6PONNZDUKDQCN5YEZUU6VF6M3KSZ7KRDPKPGXVBQVYTU',
    maxAutoPayoutXlm: 80.0,
    isActive: true,
  },
  {
    id: 'EMP-003',
    name: 'Ramon Valderama',
    role: 'Field Logistics Lead',
    rateType: 'HOURLY',
    rateXlm: 1.75,
    walletAddress: 'GCIOXLXP636L6FZUARPXNHFPTXU3WDTGX2UJFZUP2LOGTG32OSDMJHWL',
    maxAutoPayoutXlm: 70.0,
    isActive: true,
  },
];

/**
 * Format explorer transaction URL on stellar.expert
 * @param {string} txHash
 * @returns {string}
 */
export function formatExplorerTxUrl(txHash) {
  if (!txHash) return '';
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}

/**
 * Safely round float to fixed decimal places to avoid floating point imprecision
 * @param {number} val
 * @param {number} decimals
 * @returns {number}
 */
export function roundToDecimals(val, decimals = 4) {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(val) + Number.EPSILON) * factor) / factor;
}

/**
 * Convert XLM amount to integer micro-units (stroops, 1 XLM = 10^7 stroops)
 * @param {number|string} amountXlm
 * @returns {bigint}
 */
export function toStroops(amountXlm) {
  const val = Number(amountXlm);
  return BigInt(Math.round(val * 1e7));
}

/**
 * Convert stroops back to floating point XLM rounded to 7 decimal places
 * @param {bigint|number} stroops
 * @returns {number}
 */
export function fromStroops(stroops) {
  return Number(stroops) / 1e7;
}
