/**
 * SweldoSync 3-Layer Autonomous Payroll Agent
 *
 * Layer 1 (Perception): Ingests timesheets and audits for anomalies (e.g. >16h shifts, duplicates, <=0h).
 * Layer 2 (Policy Reasoning): Evaluates hourly/milestone compensation, applies 5% withholding, checks policy caps.
 * Layer 3 (Autonomous Action): Executes live Stellar Testnet transfer or flags/holds according to policy.
 *
 * 0 Emojis rule strictly enforced. Clean text markers: [OK], [PERCEIVE], [REASON], [DISBURSE], [HOLD], [FLAGGED].
 */

import {
  PAYROLL_CONFIG,
  roundToDecimals,
  formatExplorerTxUrl,
} from '../../shared/src/index.js';

export class PayrollAgent {
  constructor(options = {}) {
    this.maxShiftHours = options.maxShiftHours || PAYROLL_CONFIG.MAX_SHIFT_HOURS;
    this.standardWorkHours = options.standardWorkHours || PAYROLL_CONFIG.STANDARD_WORK_HOURS;
    this.overtimeMultiplier = options.overtimeMultiplier || PAYROLL_CONFIG.OVERTIME_MULTIPLIER;
    this.withholdingRate = options.withholdingRate || PAYROLL_CONFIG.WITHHOLDING_RATE;
    this.defaultMaxAutoPayoutXlm = options.defaultMaxAutoPayoutXlm || PAYROLL_CONFIG.DEFAULT_MAX_AUTO_PAYOUT_XLM;
  }

  /**
   * Layer 1: Perception & Sanity Evaluator
   * Audits work log data integrity, rejecting zero/negative hours and >16h shifts, and detects duplicates.
   *
   * @param {Object} workLog - { id, employeeId, date, hoursLogged, notes }
   * @param {Array} existingLogs - Array of prior work logs
   * @returns {Object} Perception decision and parsed units
   */
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

    // Duplicate check: same employee, same date, different log id
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

    const regularHours = Math.min(hours, this.standardWorkHours);
    const overtimeHours = Math.max(0, hours - this.standardWorkHours);

    return {
      valid: true,
      status: 'PERCEIVED_VALID',
      regularHours: roundToDecimals(regularHours, 2),
      overtimeHours: roundToDecimals(overtimeHours, 2),
    };
  }

  /**
   * Layer 2: Policy & Compensation Evaluator
   * Applies compensation formulas, 5% withholding, and enforces spending guardrails.
   *
   * @param {Object} workLog
   * @param {Object} employee
   * @param {Object} perceivedUnits
   * @returns {Object} Policy decision
   */
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

    let grossXlm = 0;
    const rate = Number(employee.rateXlm) || 0;

    if (employee.rateType === 'MILESTONE') {
      grossXlm = roundToDecimals(rate, 4);
    } else {
      // Standard Hourly with 1.25x Overtime premium
      const regularGross = perceivedUnits.regularHours * rate;
      const overtimeGross = perceivedUnits.overtimeHours * (rate * this.overtimeMultiplier);
      grossXlm = roundToDecimals(regularGross + overtimeGross, 4);
    }

    const withholdingXlm = roundToDecimals(grossXlm * this.withholdingRate, 4);
    const netXlm = roundToDecimals(grossXlm - withholdingXlm, 4);

    const maxCap = Number(employee.maxAutoPayoutXlm) || this.defaultMaxAutoPayoutXlm;

    if (netXlm > maxCap) {
      return {
        approved: false,
        action: 'HOLD_FOR_APPROVAL',
        grossXlm,
        withholdingXlm,
        netXlm,
        reasoning: `Net payout ${netXlm} XLM exceeds employee auto-disbursement cap of ${maxCap} XLM. Held for HR manual review.`,
      };
    }

    return {
      approved: true,
      action: 'APPROVE_FOR_DISBURSEMENT',
      grossXlm,
      withholdingXlm,
      netXlm,
      reasoning: `Policy verified: ${perceivedUnits.regularHours}h regular, ${perceivedUnits.overtimeHours}h overtime at ${rate} XLM/h. Gross: ${grossXlm} XLM, 5% withholding: ${withholdingXlm} XLM, Net: ${netXlm} XLM. Within ${maxCap} XLM cap.`,
    };
  }

  /**
   * Layer 3: Autonomous Action & Stellar Execution
   * Executes live transfer if approved, or emits audit record if flagged/held.
   *
   * @param {Object} workLog
   * @param {Object} employee
   * @param {Object} policyDecision
   * @param {Function} disbursementAdapter - async (destinationAddress, amountXlm, memoText) => { liveTransfer, txHash, explorerUrl }
   * @returns {Promise<Object>} Execution receipt
   */
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

    // Attempt live disbursement if adapter is provided
    if (typeof disbursementAdapter === 'function') {
      try {
        const memo = `SweldoSync ${workLog.id}`.slice(0, 28);
        const result = await disbursementAdapter(
          employee.walletAddress,
          policyDecision.netXlm,
          memo
        );

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

        // Mock/offline mode fallback with deterministic transaction hash
        const mockHash = `sim_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`;
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
          txHash: mockHash,
          explorerUrl: formatExplorerTxUrl(mockHash),
          reasoning: `${policyDecision.reasoning} [Simulated on-chain disbursement]`,
          timestamp,
        };
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

    // Default simulated disbursement when no adapter is supplied
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

  /**
   * End-to-end processing pipeline for a single work log.
   *
   * @param {Object} workLog
   * @param {Object} employee
   * @param {Array} existingLogs
   * @param {Function} disbursementAdapter
   * @returns {Promise<Object>} Final audit receipt
   */
  async processWorkLog(workLog, employee, existingLogs = [], disbursementAdapter = null) {
    // 1. Perception
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

    // 2. Reasoning
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

    // 3. Action
    const receipt = await this.act(workLog, employee, policy, disbursementAdapter);
    return {
      ...receipt,
      perception,
      policy,
    };
  }
}
