import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';

import { toStroops, fromStroopsToString } from '../../shared/src/index.js';
import {
  calculateTimesheetPay,
  evaluateGuardrails,
  computePayRunMemoHash,
  verifyPayRunMemoHash,
} from '../src/payroll-agent.js';

describe('SweldoSync 2.0 Stroop Math & Decimal Precision', () => {
  it('converts decimal strings and exact units to stroops BigInt', () => {
    assert.equal(toStroops('19.25'), 192500000n);
    assert.equal(toStroops('0.0000001'), 1n);
    assert.equal(toStroops('0'), 0n);
    assert.equal(toStroops('100'), 1000000000n);
  });

  it('applies HALF_UP rounding on the 8th decimal place', () => {
    assert.equal(toStroops('0.00000005'), 1n);
    assert.equal(toStroops('0.00000004'), 0n);
    assert.equal(toStroops('1.00000015'), 10000002n);
    assert.equal(toStroops('1.00000014'), 10000001n);
  });

  it('avoids IEEE-754 floating-point drift on 0.1 + 0.2', () => {
    const sum = toStroops('0.1') + toStroops('0.2');
    assert.equal(sum, 3000000n);
    assert.equal(sum, toStroops('0.3'));
    assert.equal(fromStroopsToString(sum), '0.3000000');
    assert.equal(toStroops(0.1 + 0.2), 3000000n);
  });

  it('formats stroops BigInt back to fixed 7-decimal Stellar strings', () => {
    assert.equal(fromStroopsToString(192500000n), '19.2500000');
    assert.equal(fromStroopsToString(1n), '0.0000001');
    assert.equal(fromStroopsToString(0n), '0.0000000');
  });
});

describe('SweldoSync 2.0 Timesheet Pay Calculation', () => {
  it('computes 8h regular shift at 25.00 rate with 5% withholding', () => {
    const res = calculateTimesheetPay({
      hoursLogged: 8,
      hourlyRate: '25.00',
      regularHoursCap: 8,
      overtimeMultiplier: 1.25,
      withholdingPct: 5,
    });

    assert.equal(res.regularHours, 8);
    assert.equal(res.overtimeHours, 0);
    assert.equal(res.regularAmount, '200.0000000');
    assert.equal(res.overtimeAmount, '0.0000000');
    assert.equal(res.grossAmount, '200.0000000');
    assert.equal(res.withholdingAmount, '10.0000000');
    assert.equal(res.netAmount, '190.0000000');
  });

  it('computes 10h shift (8h reg + 2h OT at 1.25x) at 2.50 rate with 5% withholding', () => {
    const res = calculateTimesheetPay({
      hoursLogged: 10,
      hourlyRate: '2.50',
      regularHoursCap: 8,
      overtimeMultiplier: 1.25,
      withholdingPct: 5,
    });

    assert.equal(res.regularHours, 8);
    assert.equal(res.overtimeHours, 2);
    assert.equal(res.regularAmount, '20.0000000');
    assert.equal(res.overtimeAmount, '6.2500000');
    assert.equal(res.grossAmount, '26.2500000');
    assert.equal(res.withholdingAmount, '1.3125000');
    assert.equal(res.netAmount, '24.9375000');
  });

  it('applies deterministic HALF_UP rounding in order: regular -> OT -> gross -> withholding -> net', () => {
    // 8h * 5 stroops = 40 stroops; 1h * 5 stroops * 1.5 = 7.5 -> 8 stroops (HALF_UP)
    // gross = 40 + 8 = 48 stroops; withholding = 48 * 10% = 4.8 -> 5 stroops; net = 43 stroops
    const resWithOt = calculateTimesheetPay({
      hoursLogged: 9,
      hourlyRate: '0.0000005',
      regularHoursCap: 8,
      overtimeMultiplier: 1.5,
      withholdingPct: 10,
    });

    assert.equal(resWithOt.regularAmount, '0.0000040');
    assert.equal(resWithOt.overtimeAmount, '0.0000008');
    assert.equal(resWithOt.grossAmount, '0.0000048');
    assert.equal(resWithOt.withholdingAmount, '0.0000005');
    assert.equal(resWithOt.netAmount, '0.0000043');

    // Exact 0.5 stroop withholding boundary: gross 5 stroops * 10% = 0.5 -> 1 stroop; net = 4 stroops
    const resHalfWithholding = calculateTimesheetPay({
      hoursLogged: 1,
      hourlyRate: '0.0000005',
      regularHoursCap: 8,
      overtimeMultiplier: 1.25,
      withholdingPct: 10,
    });

    assert.equal(resHalfWithholding.grossAmount, '0.0000005');
    assert.equal(resHalfWithholding.withholdingAmount, '0.0000001');
    assert.equal(resHalfWithholding.netAmount, '0.0000004');
  });
});

describe('SweldoSync 2.0 Guardrail Evaluation', () => {
  const treasuryPublicKey = Keypair.random().publicKey();
  const employeePublicKey = Keypair.random().publicKey();

  const baseEmployee = {
    id: 'EMP-001',
    name: 'Juan Dela Cruz',
    hourlyRate: '25.00',
    rateCurrency: 'USDC',
    walletAddress: employeePublicKey,
    maxAutoPayout: '250.00',
    withholdingPct: 5,
    isActive: true,
  };

  const basePolicy = {
    regularHoursCap: 8,
    overtimeMultiplier: 1.25,
    maxShiftHours: 16,
    defaultWithholdingPct: 5,
    maxAutoCap: '500.00',
  };

  const baseLog = {
    id: 'LOG-100',
    employeeId: 'EMP-001',
    date: '2026-11-24',
    hoursLogged: 8,
  };

  it('returns READY for a compliant shift', () => {
    const res = evaluateGuardrails({
      log: baseLog,
      employee: baseEmployee,
      existingLogs: [],
      policy: basePolicy,
      treasuryPublicKey,
    });

    assert.equal(res.status, 'READY');
    assert.equal(res.flags.length, 0);
  });

  it('returns FLAGGED (WARN) for DUPLICATE_SHIFT on the same employee and date', () => {
    const existingLogs = [
      { id: 'LOG-099', employeeId: 'EMP-001', date: '2026-11-24', hoursLogged: 8, status: 'PAID' },
    ];
    const res = evaluateGuardrails({
      log: baseLog,
      employee: baseEmployee,
      existingLogs,
      policy: basePolicy,
      treasuryPublicKey,
    });

    assert.equal(res.status, 'FLAGGED');
    assert.ok(res.flags.some((f) => f.code === 'DUPLICATE_SHIFT' && f.severity === 'WARN'));
  });

  it('returns FLAGGED (WARN) for MAX_SHIFT_EXCEEDED (>16h)', () => {
    const res = evaluateGuardrails({
      log: { ...baseLog, hoursLogged: 17 },
      employee: baseEmployee,
      existingLogs: [],
      policy: basePolicy,
      treasuryPublicKey,
    });

    assert.equal(res.status, 'FLAGGED');
    assert.ok(res.flags.some((f) => f.code === 'MAX_SHIFT_EXCEEDED' && f.severity === 'WARN'));
  });

  it('returns FLAGGED (WARN) for CAP_EXCEEDED when net payout exceeds auto cap', () => {
    const res = evaluateGuardrails({
      log: { ...baseLog, hoursLogged: 12 },
      employee: { ...baseEmployee, maxAutoPayout: '200.00' },
      existingLogs: [],
      policy: basePolicy,
      treasuryPublicKey,
    });

    assert.equal(res.status, 'FLAGGED');
    assert.ok(res.flags.some((f) => f.code === 'CAP_EXCEEDED' && f.severity === 'WARN'));
  });

  it('returns BLOCKED (BLOCK) for INVALID_HOURS (<=0)', () => {
    for (const badHours of [0, -4]) {
      const res = evaluateGuardrails({
        log: { ...baseLog, hoursLogged: badHours },
        employee: baseEmployee,
        existingLogs: [],
        policy: basePolicy,
        treasuryPublicKey,
      });

      assert.equal(res.status, 'BLOCKED');
      assert.ok(res.flags.some((f) => f.code === 'INVALID_HOURS' && f.severity === 'BLOCK'));
    }
  });

  it('returns BLOCKED (BLOCK) for INVALID_WALLET (malformed StrKey)', () => {
    const res = evaluateGuardrails({
      log: baseLog,
      employee: { ...baseEmployee, walletAddress: 'NOT_A_VALID_STELLAR_KEY' },
      existingLogs: [],
      policy: basePolicy,
      treasuryPublicKey,
    });

    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.flags.some((f) => f.code === 'INVALID_WALLET' && f.severity === 'BLOCK'));
  });

  it('returns BLOCKED (BLOCK) for SELF_PAYMENT when employee wallet matches treasury', () => {
    const res = evaluateGuardrails({
      log: baseLog,
      employee: { ...baseEmployee, walletAddress: treasuryPublicKey },
      existingLogs: [],
      policy: basePolicy,
      treasuryPublicKey,
    });

    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.flags.some((f) => f.code === 'SELF_PAYMENT' && f.severity === 'BLOCK'));
  });
});

describe('SweldoSync 2.0 RFC-8785 Salted Pay-Run Memo Hash', () => {
  const pub1 = Keypair.random().publicKey();
  const pub2 = Keypair.random().publicKey();

  const canonicalManifest = {
    payRunId: 'RUN-20261124-01',
    network: 'testnet',
    assetCode: 'XLM',
    saltHex: '00112233445566778899aabbccddeeff',
    chunkIndex: 0,
    items: [
      { employeeId: 'EMP-001', walletAddress: pub1, netAmount: '190.0000000' },
      { employeeId: 'EMP-002', walletAddress: pub2, netAmount: '152.0000000' },
    ],
  };

  const shuffledManifest = {
    chunkIndex: 0,
    items: [
      { netAmount: '190.0000000', employeeId: 'EMP-001', walletAddress: pub1 },
      { walletAddress: pub2, netAmount: '152.0000000', employeeId: 'EMP-002' },
    ],
    saltHex: '00112233445566778899aabbccddeeff',
    assetCode: 'XLM',
    payRunId: 'RUN-20261124-01',
    network: 'testnet',
  };

  it('produces identical 32-byte sha256Buffer and 64-char sha256Hex regardless of key order', () => {
    const h1 = computePayRunMemoHash(canonicalManifest);
    const h2 = computePayRunMemoHash(shuffledManifest);

    assert.ok(Buffer.isBuffer(h1.sha256Buffer));
    assert.equal(h1.sha256Buffer.length, 32);
    assert.match(h1.sha256Hex, /^[0-9a-f]{64}$/);
    assert.equal(h1.sha256Buffer.toString('hex'), h1.sha256Hex);

    assert.deepEqual(h1.sha256Buffer, h2.sha256Buffer);
    assert.equal(h1.sha256Hex, h2.sha256Hex);
  });

  it('verifies matching manifests and rejects saltHex, chunkIndex, or amount tampering', () => {
    const { sha256Hex, sha256Buffer } = computePayRunMemoHash(canonicalManifest);

    assert.equal(verifyPayRunMemoHash(shuffledManifest, sha256Hex), true);
    assert.equal(verifyPayRunMemoHash(shuffledManifest, sha256Buffer), true);

    assert.equal(
      verifyPayRunMemoHash(
        { ...canonicalManifest, saltHex: 'ffeeddccbbaa99887766554433221100' },
        sha256Hex
      ),
      false
    );

    assert.equal(
      verifyPayRunMemoHash({ ...canonicalManifest, chunkIndex: 1 }, sha256Hex),
      false
    );

    assert.equal(
      verifyPayRunMemoHash(
        {
          ...canonicalManifest,
          items: [
            { employeeId: 'EMP-001', walletAddress: pub1, netAmount: '190.0000001' },
            canonicalManifest.items[1],
          ],
        },
        sha256Hex
      ),
      false
    );
  });
});
