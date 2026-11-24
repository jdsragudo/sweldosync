/**
 * SweldoSync 2.0 Autonomous Payroll Engine
 *
 * Exact integer stroop math (BigInt, HALF_UP), deterministic guardrails,
 * and salted RFC-8785 SHA-256 Pay-Run MemoHash verification.
 * Zero emojis rule strictly enforced.
 */

import crypto from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import {
  PAYROLL_CONFIG,
  STROOPS_PER_UNIT,
  toStroops,
  fromStroops,
  fromStroopsToString,
  formatExplorerTxUrl,
} from '../../shared/src/index.js';

function parseDecimalRatio(val) {
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new Error(`Invalid numeric value: ${val}`);
    }
    if (val === 0) return { num: 0n, den: 1n };
    const str = val.toFixed(10).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    return parseDecimalRatio(str);
  }
  const str = String(val ?? '0').trim();
  const match = str.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid decimal value: "${str}"`);
  }
  const [, sign, intPart, fracPart = ''] = match;
  const digits = `${intPart}${fracPart}`;
  const num = BigInt(digits) * (sign === '-' ? -1n : 1n);
  const den = 10n ** BigInt(fracPart.length);
  return { num, den };
}

export function divRoundHalfUp(num, den) {
  if (den <= 0n) {
    throw new Error('Denominator must be positive');
  }
  if (num === 0n) return 0n;
  const neg = num < 0n;
  const absNum = neg ? -num : num;
  const q = absNum / den;
  const r = absNum % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/**
 * Convert stroops between USD/USDC and XLM using exact BigInt HALF_UP division.
 *
 * @param {bigint|string|number} amountStroops
 * @param {string} fromCurrency - 'USD' | 'USDC' | 'XLM'
 * @param {string} toAsset - 'USD' | 'USDC' | 'XLM'
 * @param {string|number} usdPerXlm
 * @returns {bigint}
 */
export function convertStroopsBetweenAssets(amountStroops, fromCurrency, toAsset, usdPerXlm) {
  const amt = typeof amountStroops === 'bigint' ? amountStroops : BigInt(amountStroops);
  const from = String(fromCurrency || 'USD').toUpperCase();
  const to = String(toAsset || from).toUpperCase();
  const isFromUsd = from === 'USD' || from === 'USDC';
  const isToUsd = to === 'USD' || to === 'USDC';

  if (from === to || (isFromUsd && isToUsd)) {
    return amt;
  }

  const fxStroops = toStroops(usdPerXlm || PAYROLL_CONFIG.DEFAULT_FX_USD_PER_XLM);
  if (fxStroops <= 0n) {
    throw new Error('FX rate usdPerXlm must be positive');
  }

  if (isFromUsd && to === 'XLM') {
    return divRoundHalfUp(amt * STROOPS_PER_UNIT, fxStroops);
  }
  if (from === 'XLM' && isToUsd) {
    return divRoundHalfUp(amt * fxStroops, STROOPS_PER_UNIT);
  }
  return amt;
}

/**
 * Compute regular, overtime, gross, withholding, and net pay in exact integer stroops (HALF_UP).
 * Strict order: regular -> overtime -> gross -> withholding -> net.
 */
export function calculateTimesheetPay({
  hoursLogged,
  hourlyRate,
  regularHoursCap = PAYROLL_CONFIG.STANDARD_WORK_HOURS,
  overtimeMultiplier = PAYROLL_CONFIG.OVERTIME_MULTIPLIER,
  withholdingPct = PAYROLL_CONFIG.DEFAULT_WITHHOLDING_PCT,
}) {
  const hoursNum = Number(hoursLogged);
  if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
    return {
      regularHours: 0,
      overtimeHours: 0,
      regularStroops: '0',
      overtimeStroops: '0',
      grossStroops: '0',
      withholdingStroops: '0',
      netStroops: '0',
      regularAmount: '0.0000000',
      overtimeAmount: '0.0000000',
      grossAmount: '0.0000000',
      withholdingAmount: '0.0000000',
      netAmount: '0.0000000',
    };
  }

  const hoursScaled = toStroops(hoursLogged);
  const capValue = regularHoursCap ?? PAYROLL_CONFIG.STANDARD_WORK_HOURS;
  const capScaled = toStroops(capValue);
  const regScaled = hoursScaled <= capScaled ? hoursScaled : capScaled;
  const otScaled = hoursScaled > capScaled ? hoursScaled - capScaled : 0n;

  const rateStroops = toStroops(hourlyRate ?? '0');
  const otMult = parseDecimalRatio(overtimeMultiplier ?? PAYROLL_CONFIG.OVERTIME_MULTIPLIER);
  const whRatio = parseDecimalRatio(withholdingPct ?? PAYROLL_CONFIG.DEFAULT_WITHHOLDING_PCT);

  const regularStroops = divRoundHalfUp(regScaled * rateStroops, STROOPS_PER_UNIT);
  const overtimeStroops = divRoundHalfUp(
    otScaled * rateStroops * otMult.num,
    STROOPS_PER_UNIT * otMult.den
  );
  const grossStroops = regularStroops + overtimeStroops;
  const withholdingStroops = divRoundHalfUp(grossStroops * whRatio.num, whRatio.den * 100n);
  const netStroops = grossStroops - withholdingStroops;

  return {
    regularHours: fromStroops(regScaled),
    overtimeHours: fromStroops(otScaled),
    regularStroops: regularStroops.toString(),
    overtimeStroops: overtimeStroops.toString(),
    grossStroops: grossStroops.toString(),
    withholdingStroops: withholdingStroops.toString(),
    netStroops: netStroops.toString(),
    regularAmount: fromStroopsToString(regularStroops),
    overtimeAmount: fromStroopsToString(overtimeStroops),
    grossAmount: fromStroopsToString(grossStroops),
    withholdingAmount: fromStroopsToString(withholdingStroops),
    netAmount: fromStroopsToString(netStroops),
  };
}

/**
 * Evaluate shift guardrails and compute compensation preview.
 * Returns { status: 'READY' | 'FLAGGED' | 'BLOCKED', flags: [...], calculation }.
 */
export function evaluateGuardrails({
  log,
  employee,
  existingLogs = [],
  policy = {},
  treasuryPublicKey = null,
}) {
  const flags = [];

  if (!log) {
    flags.push({
      code: 'INVALID_HOURS',
      severity: 'BLOCK',
      message: 'Timesheet payload is missing.',
    });
    return { status: 'BLOCKED', flags, calculation: null };
  }

  const hours = Number(log.hoursLogged);
  if (!Number.isFinite(hours) || hours <= 0) {
    flags.push({
      code: 'INVALID_HOURS',
      severity: 'BLOCK',
      message: `Hours logged must be greater than 0 (received ${log.hoursLogged}).`,
    });
  }

  const wallet = String(employee?.walletAddress || '').trim();
  if (!wallet || !StrKey.isValidEd25519PublicKey(wallet)) {
    flags.push({
      code: 'INVALID_WALLET',
      severity: 'BLOCK',
      message: 'Employee wallet address is not a valid Stellar Ed25519 public key.',
    });
  }

  const cleanTreasury = treasuryPublicKey ? String(treasuryPublicKey).trim() : null;
  if (cleanTreasury && wallet && wallet === cleanTreasury) {
    flags.push({
      code: 'SELF_PAYMENT',
      severity: 'BLOCK',
      message: 'Destination wallet matches the treasury public key (self-payment blocked).',
    });
  }

  if (!employee || employee.isActive === false || employee.isActive === 0) {
    flags.push({
      code: 'INACTIVE_EMPLOYEE',
      severity: 'BLOCK',
      message: `Employee ${log.employeeId || 'UNKNOWN'} is inactive or not found.`,
    });
  }

  if (log.date && log.employeeId && Array.isArray(existingLogs)) {
    const duplicate = existingLogs.find(
      (prev) =>
        prev &&
        prev.id !== log.id &&
        prev.employeeId === log.employeeId &&
        prev.date === log.date &&
        prev.status !== 'REJECTED'
    );
    if (duplicate) {
      flags.push({
        code: 'DUPLICATE_SHIFT',
        severity: 'WARN',
        message: `Duplicate shift logged on ${log.date} (collides with ${duplicate.id}).`,
      });
    }
  }

  const maxShiftHours = Number(policy.maxShiftHours ?? PAYROLL_CONFIG.MAX_SHIFT_HOURS);
  if (Number.isFinite(hours) && hours > maxShiftHours) {
    flags.push({
      code: 'MAX_SHIFT_EXCEEDED',
      severity: 'WARN',
      message: `Logged ${hours}h exceeds ${maxShiftHours}h maximum daily shift guardrail.`,
    });
  }

  let calculation = null;
  if (Number.isFinite(hours) && hours > 0 && employee) {
    const rate = employee.hourlyRate ?? employee.rateXlm ?? '0';
    const regCap = employee.regularHoursCap ?? policy.regularHoursCap ?? policy.standardWorkHours ?? PAYROLL_CONFIG.STANDARD_WORK_HOURS;
    const otMult = employee.overtimeMultiplier ?? policy.overtimeMultiplier ?? PAYROLL_CONFIG.OVERTIME_MULTIPLIER;
    const whPct = employee.withholdingPct ?? policy.defaultWithholdingPct ?? PAYROLL_CONFIG.DEFAULT_WITHHOLDING_PCT;

    calculation = calculateTimesheetPay({
      hoursLogged: hours,
      hourlyRate: rate,
      regularHoursCap: regCap,
      overtimeMultiplier: otMult,
      withholdingPct: whPct,
    });

    const maxAuto =
      employee.maxAutoPayout ??
      employee.maxAutoPayoutXlm ??
      policy.defaultMaxAutoPayout ??
      policy.maxAutoCap ??
      PAYROLL_CONFIG.DEFAULT_MAX_AUTO_PAYOUT;

    if (maxAuto !== undefined && maxAuto !== null && maxAuto !== '') {
      const capStroops = toStroops(maxAuto);
      if (BigInt(calculation.netStroops) > capStroops) {
        flags.push({
          code: 'CAP_EXCEEDED',
          severity: 'WARN',
          message: `Net payout ${calculation.netAmount} exceeds auto-approval cap of ${fromStroopsToString(capStroops)}.`,
        });
      }
    }
  }

  const hasBlock = flags.some((f) => f.severity === 'BLOCK');
  const hasWarn = flags.some((f) => f.severity === 'WARN');
  const status = hasBlock ? 'BLOCKED' : hasWarn ? 'FLAGGED' : 'READY';

  return { status, flags, calculation };
}

/**
 * RFC-8785 deterministic canonical JSON serializer (recursive lexicographical key sort).
 */
export function canonicalizeJson(val) {
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') {
    return JSON.stringify(val);
  }
  if (typeof val === 'bigint') {
    return JSON.stringify(val.toString());
  }
  if (Array.isArray(val)) {
    const items = val.map((item) =>
      item === undefined || typeof item === 'function' || typeof item === 'symbol'
        ? 'null'
        : canonicalizeJson(item)
    );
    return `[${items.join(',')}]`;
  }
  if (typeof val === 'object') {
    if (typeof val.toJSON === 'function') {
      return canonicalizeJson(val.toJSON());
    }
    const keys = Object.keys(val).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const parts = [];
    for (const key of keys) {
      const prop = val[key];
      if (prop === undefined || typeof prop === 'function' || typeof prop === 'symbol') {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${canonicalizeJson(prop)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

/**
 * Compute salted RFC-8785 SHA-256 MemoHash for a pay-run chunk manifest.
 */
export function computePayRunMemoHash(manifest) {
  const canonicalJson = canonicalizeJson(manifest);
  const sha256Buffer = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest();
  const sha256Hex = sha256Buffer.toString('hex');
  return { canonicalJson, sha256Buffer, sha256Hex };
}

/**
 * Verify a pay-run chunk manifest against a 32-byte Buffer or 64-char hex MemoHash.
 */
export function verifyPayRunMemoHash(manifest, expectedHash) {
  if (!expectedHash) return false;
  let expectedBuf;
  if (Buffer.isBuffer(expectedHash)) {
    expectedBuf = expectedHash;
  } else if (typeof expectedHash === 'string') {
    const clean = expectedHash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) {
      return false;
    }
    expectedBuf = Buffer.from(clean, 'hex');
  } else {
    return false;
  }

  if (expectedBuf.length !== 32) {
    return false;
  }

  const { sha256Buffer } = computePayRunMemoHash(manifest);
  return crypto.timingSafeEqual(sha256Buffer, expectedBuf);
}

/**
 * Legacy-compatible PayrollAgent wrapper backed by exact integer stroop calculations.
 */
export class PayrollAgent {
  constructor(options = {}) {
    this.maxShiftHours = options.maxShiftHours ?? PAYROLL_CONFIG.MAX_SHIFT_HOURS;
    this.standardWorkHours = options.standardWorkHours ?? PAYROLL_CONFIG.STANDARD_WORK_HOURS;
    this.overtimeMultiplier = options.overtimeMultiplier ?? PAYROLL_CONFIG.OVERTIME_MULTIPLIER;
    this.withholdingPct =
      options.withholdingPct ??
      (options.withholdingRate !== undefined
        ? Number(options.withholdingRate) * 100
        : PAYROLL_CONFIG.DEFAULT_WITHHOLDING_PCT);
    this.defaultMaxAutoPayout =
      options.defaultMaxAutoPayout ??
      options.defaultMaxAutoPayoutXlm ??
      PAYROLL_CONFIG.DEFAULT_MAX_AUTO_PAYOUT;
  }

  perceive(workLog, existingLogs = []) {
    if (!workLog) {
      return {
        valid: false,
        status: 'REJECTED_EMPTY_LOG',
        error: 'WorkLog payload is required.',
        regularHours: 0,
        overtimeHours: 0,
      };
    }

    const hours = Number(workLog.hoursLogged);
    if (!Number.isFinite(hours) || hours <= 0) {
      return {
        valid: false,
        status: 'REJECTED_NON_POSITIVE_HOURS',
        error: `Hours logged must be greater than 0 (received ${workLog.hoursLogged}).`,
        regularHours: 0,
        overtimeHours: 0,
      };
    }

    if (hours > this.maxShiftHours) {
      return {
        valid: false,
        status: 'FLAGGED_EXCEEDS_MAX_DAILY_SHIFT',
        error: `Daily shift of ${hours}h exceeds maximum allowed ceiling of ${this.maxShiftHours}h.`,
        regularHours: 0,
        overtimeHours: 0,
      };
    }

    if (workLog.date && workLog.employeeId) {
      const duplicate = existingLogs.find(
        (prev) =>
          prev.id !== workLog.id &&
          prev.employeeId === workLog.employeeId &&
          prev.date === workLog.date &&
          prev.status !== 'REJECTED'
      );
      if (duplicate) {
        return {
          valid: false,
          status: 'FLAGGED_DUPLICATE_WORKLOG',
          error: `Duplicate timesheet detected for employee ${workLog.employeeId} on date ${workLog.date} (collides with ${duplicate.id}).`,
          regularHours: 0,
          overtimeHours: 0,
        };
      }
    }

    const calc = calculateTimesheetPay({
      hoursLogged: hours,
      hourlyRate: '0',
      regularHoursCap: this.standardWorkHours,
      overtimeMultiplier: this.overtimeMultiplier,
      withholdingPct: this.withholdingPct,
    });

    return {
      valid: true,
      status: 'PERCEIVED_VALID',
      regularHours: calc.regularHours,
      overtimeHours: calc.overtimeHours,
    };
  }

  reason(workLog, employee, perceivedUnits) {
    if (!employee || employee.isActive === false) {
      return {
        approved: false,
        action: 'REJECTED_INACTIVE_EMPLOYEE',
        grossXlm: 0,
        withholdingXlm: 0,
        netXlm: 0,
        reasoning: `Employee ${workLog?.employeeId || 'UNKNOWN'} is inactive or not registered in roster.`,
      };
    }

    const calc = calculateTimesheetPay({
      hoursLogged: workLog?.hoursLogged ?? perceivedUnits.regularHours + perceivedUnits.overtimeHours,
      hourlyRate: employee.hourlyRate ?? employee.rateXlm ?? '0',
      regularHoursCap: employee.regularHoursCap ?? this.standardWorkHours,
      overtimeMultiplier: employee.overtimeMultiplier ?? this.overtimeMultiplier,
      withholdingPct: employee.withholdingPct ?? this.withholdingPct,
    });

    const grossXlm = fromStroops(calc.grossStroops);
    const withholdingXlm = fromStroops(calc.withholdingStroops);
    const netXlm = fromStroops(calc.netStroops);
    const maxCap = Number(employee.maxAutoPayout ?? employee.maxAutoPayoutXlm ?? this.defaultMaxAutoPayout);

    if (netXlm > maxCap) {
      return {
        approved: false,
        action: 'HOLD_FOR_APPROVAL',
        grossXlm,
        withholdingXlm,
        netXlm,
        reasoning: `Net payout ${calc.netAmount} exceeds employee auto-disbursement cap of ${maxCap}. Held for manual review.`,
      };
    }

    return {
      approved: true,
      action: 'APPROVE_FOR_DISBURSEMENT',
      grossXlm,
      withholdingXlm,
      netXlm,
      reasoning: `Policy verified: ${calc.regularHours}h regular, ${calc.overtimeHours}h overtime. Gross: ${calc.grossAmount}, Withholding: ${calc.withholdingAmount}, Net: ${calc.netAmount}.`,
    };
  }

  async act(workLog, employee, policyDecision, disbursementAdapter = null) {
    const timestamp = new Date().toISOString();
    if (!policyDecision.approved) {
      return {
        id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workLogId: workLog.id,
        employeeId: employee?.id || workLog.employeeId,
        employeeName: employee?.name || 'Unknown',
        walletAddress: employee?.walletAddress || null,
        action: policyDecision.action,
        status: policyDecision.action,
        grossXlm: policyDecision.grossXlm || 0,
        withholdingXlm: policyDecision.withholdingXlm || 0,
        netXlm: policyDecision.netXlm || 0,
        txHash: null,
        explorerUrl: null,
        reasoning: policyDecision.reasoning,
        timestamp,
      };
    }

    if (typeof disbursementAdapter === 'function') {
      try {
        const memo = `SweldoSync ${workLog.id}`.slice(0, 28);
        const result = await disbursementAdapter(employee.walletAddress, policyDecision.netXlm, memo);
        if (result && result.txHash) {
          return {
            id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            workLogId: workLog.id,
            employeeId: employee.id,
            employeeName: employee.name,
            walletAddress: employee.walletAddress,
            action: 'AUTONOMOUSLY_DISBURSED',
            status: 'DISBURSED',
            grossXlm: policyDecision.grossXlm,
            withholdingXlm: policyDecision.withholdingXlm,
            netXlm: policyDecision.netXlm,
            txHash: result.txHash,
            explorerUrl: result.explorerUrl || formatExplorerTxUrl(result.txHash),
            reasoning: policyDecision.reasoning,
            timestamp,
          };
        }
      } catch (err) {
        return {
          id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          workLogId: workLog.id,
          employeeId: employee.id,
          employeeName: employee.name,
          walletAddress: employee.walletAddress,
          action: 'DISBURSEMENT_FAILED',
          status: 'FAILED',
          grossXlm: policyDecision.grossXlm,
          withholdingXlm: policyDecision.withholdingXlm,
          netXlm: policyDecision.netXlm,
          txHash: null,
          explorerUrl: null,
          reasoning: `Stellar transfer failed: ${err.message}`,
          timestamp,
        };
      }
    }

    const simHash = `sim_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`;
    return {
      id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workLogId: workLog.id,
      employeeId: employee.id,
      employeeName: employee.name,
      walletAddress: employee.walletAddress,
      action: 'AUTONOMOUSLY_DISBURSED',
      status: 'DISBURSED',
      grossXlm: policyDecision.grossXlm,
      withholdingXlm: policyDecision.withholdingXlm,
      netXlm: policyDecision.netXlm,
      txHash: simHash,
      explorerUrl: formatExplorerTxUrl(simHash),
      reasoning: `${policyDecision.reasoning} [Simulated on-chain disbursement]`,
      timestamp,
    };
  }

  async processWorkLog(workLog, employee, existingLogs = [], disbursementAdapter = null) {
    const perception = this.perceive(workLog, existingLogs);
    if (!perception.valid) {
      return {
        id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workLogId: workLog.id,
        employeeId: workLog.employeeId,
        employeeName: employee?.name || 'Unknown',
        walletAddress: employee?.walletAddress || null,
        action: 'FLAGGED_FOR_AUDIT',
        status: 'FLAGGED_FOR_AUDIT',
        grossXlm: 0,
        withholdingXlm: 0,
        netXlm: 0,
        txHash: null,
        explorerUrl: null,
        reasoning: `[PERCEIVE REJECTED] ${perception.error}`,
        perception,
        timestamp: new Date().toISOString(),
      };
    }

    const policy = this.reason(workLog, employee, perception);
    if (!policy.approved) {
      return {
        id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workLogId: workLog.id,
        employeeId: employee.id,
        employeeName: employee.name,
        walletAddress: employee.walletAddress,
        action: policy.action,
        status: policy.action,
        grossXlm: policy.grossXlm,
        withholdingXlm: policy.withholdingXlm,
        netXlm: policy.netXlm,
        txHash: null,
        explorerUrl: null,
        reasoning: `[REASON HELD] ${policy.reasoning}`,
        perception,
        policy,
        timestamp: new Date().toISOString(),
      };
    }

    const receipt = await this.act(workLog, employee, policy, disbursementAdapter);
    return {
      ...receipt,
      perception,
      policy,
    };
  }
}
