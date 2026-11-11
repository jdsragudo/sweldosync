/**
 * SweldoSync Automated Test and Verification Suite
 * Verifies 3-layer agent logic, anomaly detection, policy guardrails,
 * Express server endpoints, and zero emojis compliance.
 *
 * Execution: node packages/agent/scripts/verify-all.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PayrollAgent } from '../src/payroll-agent.js';
import {
  DEFAULT_EMPLOYEES,
  PAYROLL_CONFIG,
  CONTRACT_IDS,
  VELO_PROJECT_KEY,
  roundToDecimals,
} from '../../shared/src/index.js';
import { app } from '../../../apps/server/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../');

console.log('[START] SweldoSync Verification Suite running...');

let testsPassed = 0;
function pass(label) {
  testsPassed += 1;
  console.log(`[OK] Test ${testsPassed}: ${label}`);
}

const agent = new PayrollAgent();
const testEmp = DEFAULT_EMPLOYEES[0]; // EMP-001: 2.50 XLM/h, maxAuto: 100.0

// =========================================================================
// Suite 1: Layer 1 Perception & Sanity Checks
// =========================================================================

// Test 1: Normal 8h shift passes perception
const normalLog = {
  id: 'LOG-001',
  employeeId: testEmp.id,
  date: '2026-11-11',
  hoursLogged: 8,
  notes: 'Standard shift',
};
const p1 = agent.perceive(normalLog, []);
assert.equal(p1.valid, true, 'Normal 8h shift should be valid');
assert.equal(p1.regularHours, 8, 'Regular hours should be 8');
assert.equal(p1.overtimeHours, 0, 'Overtime hours should be 0');
pass('Layer 1 correctly validates normal 8h shift');

// Test 2: Overtime 10h shift (8h reg + 2h OT)
const otLog = {
  id: 'LOG-002',
  employeeId: testEmp.id,
  date: '2026-11-12',
  hoursLogged: 10,
  notes: 'Overtime sprint shift',
};
const p2 = agent.perceive(otLog, []);
assert.equal(p2.valid, true, '10h shift should be valid');
assert.equal(p2.regularHours, 8, 'Regular hours should be 8');
assert.equal(p2.overtimeHours, 2, 'Overtime hours should be 2');
pass('Layer 1 correctly extracts regular and overtime components');

// Test 3: Anomaly: Suspicious 18h shift (>16h limit) flagged
const anomaly18h = {
  id: 'LOG-003',
  employeeId: testEmp.id,
  date: '2026-11-13',
  hoursLogged: 18,
  notes: 'Impossible continuous shift',
};
const p3 = agent.perceive(anomaly18h, []);
assert.equal(p3.valid, false, '18h shift must be invalid');
assert.equal(p3.status, 'FLAGGED_EXCEEDS_MAX_DAILY_SHIFT');
pass('Layer 1 flags suspicious 18h shift (>16h safety ceiling)');

// Test 4: Anomaly: Non-positive hours (0h or negative) rejected
const anomalyZero = {
  id: 'LOG-004',
  employeeId: testEmp.id,
  date: '2026-11-14',
  hoursLogged: 0,
  notes: 'Zero hours',
};
const p4 = agent.perceive(anomalyZero, []);
assert.equal(p4.valid, false, '0h shift must be rejected');
assert.equal(p4.status, 'REJECTED_NON_POSITIVE_HOURS');
pass('Layer 1 rejects 0h shift anomaly');

// Test 5: Anomaly: Duplicate worklog on same date flagged
const dupLog = {
  id: 'LOG-005',
  employeeId: testEmp.id,
  date: '2026-11-11',
  hoursLogged: 8,
  notes: 'Duplicate submission',
};
const p5 = agent.perceive(dupLog, [normalLog]);
assert.equal(p5.valid, false, 'Duplicate entry must be flagged');
assert.equal(p5.status, 'FLAGGED_DUPLICATE_WORKLOG');
pass('Layer 1 detects duplicate timesheet on same date');

// =========================================================================
// Suite 2: Layer 2 Policy Reasoning & Floating-Point Safe Math
// =========================================================================

// Test 6: Compensation evaluation for 8h @ 2.50 XLM/h
// Gross = 8 * 2.50 = 20.00 XLM
// Withholding = 20.00 * 0.05 = 1.00 XLM
// Net = 19.00 XLM
const r1 = agent.reason(normalLog, testEmp, p1);
assert.equal(r1.approved, true);
assert.equal(r1.grossXlm, 20.0);
assert.equal(r1.withholdingXlm, 1.0);
assert.equal(r1.netXlm, 19.0);
pass('Layer 2 evaluates standard wage with 5% withholding');

// Test 7: Overtime compensation evaluation (8h reg + 2h OT @ 1.25x)
// Regular Gross = 8 * 2.50 = 20.00
// Overtime Gross = 2 * (2.50 * 1.25) = 2 * 3.125 = 6.25
// Total Gross = 26.25 XLM
// Withholding = 26.25 * 0.05 = 1.3125 XLM
// Net = 24.9375 XLM
const r2 = agent.reason(otLog, testEmp, p2);
assert.equal(r2.approved, true);
assert.equal(r2.grossXlm, 26.25);
assert.equal(r2.withholdingXlm, 1.3125);
assert.equal(r2.netXlm, 24.9375);
pass('Layer 2 computes exact overtime wage with 1.25x multiplier');

// Test 8: Policy limit enforcement (maxAutoPayoutXlm guardrail)
const cappedEmp = { ...testEmp, maxAutoPayoutXlm: 15.0 }; // Limit 15 XLM
const r3 = agent.reason(normalLog, cappedEmp, p1); // Net is 19.0 > 15.0
assert.equal(r3.approved, false);
assert.equal(r3.action, 'HOLD_FOR_APPROVAL');
pass('Layer 2 halts disbursement when net exceeds maxAutoPayoutXlm');

// =========================================================================
// Suite 3: Layer 3 Autonomous Action & End-to-End Processing
// =========================================================================

// Test 9: End-to-end autonomous disbursement with mock adapter
let mockTransferCalled = false;
const mockAdapter = async (dest, amount, memo) => {
  mockTransferCalled = true;
  return {
    liveTransfer: true,
    txHash: '3d9a1f2b8c7e6a5d4c3b2a10987654321fedcba0987654321abcdef012345678',
    explorerUrl: 'https://stellar.expert/explorer/testnet/tx/3d9a1f2b8c7e6a5d4c3b2a10987654321fedcba0987654321abcdef012345678',
  };
};

const receipt1 = await agent.processWorkLog(normalLog, testEmp, [], mockAdapter);
assert.equal(mockTransferCalled, true);
assert.equal(receipt1.status, 'DISBURSED');
assert.equal(receipt1.netXlm, 19.0);
assert.ok(receipt1.txHash);
assert.ok(receipt1.explorerUrl.includes('stellar.expert'));
pass('Layer 3 executes autonomous disbursement and generates stellar.expert receipt');

// Test 10: End-to-end handling of anomalous 18h shift
const receiptAnomaly = await agent.processWorkLog(anomaly18h, testEmp, [], mockAdapter);
assert.equal(receiptAnomaly.status, 'FLAGGED_FOR_AUDIT');
assert.equal(receiptAnomaly.txHash, null, 'Anomalous shift must never execute on-chain transfer');
assert.ok(receiptAnomaly.reasoning.includes('[PERCEIVE REJECTED]'));
pass('End-to-end pipeline safely flags 18h shift without on-chain execution');

// =========================================================================
// Suite 4: Structural and Constants Verification
// =========================================================================

// Test 11: Contract IDs and Velo Keys match specifications
assert.equal(VELO_PROJECT_KEY, 'vw_pk_JfssyvlfNeu7dYgW4dXuGccU8s2m5f-X');
assert.equal(CONTRACT_IDS.DEVICE_REGISTRY, 'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5');
assert.equal(CONTRACT_IDS.AGENT_REGISTRY, 'CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV');
assert.equal(CONTRACT_IDS.PAYMENT_ESCROW, 'CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS');
assert.equal(CONTRACT_IDS.NATIVE_SAC, 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC');
pass('Contract IDs and Velo Project Key verified against specifications');

// =========================================================================
// Suite 5: Express Server Route Handlers Verification
// =========================================================================

function getHandler(method, routePath) {
  const layer = app._router.stack.find(
    (s) => s.route && s.route.path === routePath && s.route.methods[method.toLowerCase()]
  );
  if (!layer) throw new Error(`Route handler not found: ${method} ${routePath}`);
  return layer.route.stack[0].handle;
}

// Test 12: GET /api/employees
{
  const fn = getHandler('GET', '/api/employees');
  let data = null;
  fn({}, { json(d) { data = d; } });
  assert.equal(data.success, true);
  assert.ok(data.count >= 3);
  pass('Server GET /api/employees returns active roster');
}

// Test 13: POST /api/worklogs
{
  const fn = getHandler('POST', '/api/worklogs');
  let data = null, status = 200;
  const req = {
    body: {
      employeeId: 'EMP-001',
      date: '2026-11-15',
      hoursLogged: 8,
      notes: 'Verification test worklog',
    },
  };
  const res = {
    status(c) { status = c; return this; },
    json(d) { data = d; },
  };
  fn(req, res);
  assert.equal(status, 201);
  assert.equal(data.success, true);
  assert.ok(data.workLog.id);
  pass('Server POST /api/worklogs successfully ingests timesheet');
}

// Test 14: GET /api/worklogs
{
  const fn = getHandler('GET', '/api/worklogs');
  let data = null;
  fn({}, { json(d) { data = d; } });
  assert.equal(data.success, true);
  assert.ok(data.count >= 1);
  pass('Server GET /api/worklogs returns active timesheet queue');
}

// Test 15: POST /api/agent/cycle
{
  const fn = getHandler('POST', '/api/agent/cycle');
  let data = null;
  await fn({}, { json(d) { data = d; } });
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.receipts));
  pass('Server POST /api/agent/cycle processes timesheet backlog');
}

// Test 16: GET /api/payroll/audit-log
{
  const fn = getHandler('GET', '/api/payroll/audit-log');
  let data = null;
  fn({}, { json(d) { data = d; } });
  assert.equal(data.success, true);
  assert.ok(data.count >= 1);
  pass('Server GET /api/payroll/audit-log returns receipts');
}

// Test 17: GET /api/v1/wallet-config/:projectKey
{
  const fn = getHandler('GET', '/api/v1/wallet-config/:projectKey');
  let data = null, status = 200;
  const req = { params: { projectKey: 'vw_pk_JfssyvlfNeu7dYgW4dXuGccU8s2m5f-X' } };
  const res = {
    setHeader() {},
    status(c) { status = c; return this; },
    json(d) { data = d; },
  };
  await fn(req, res);
  assert.equal(status, 200);
  assert.equal(data.projectKey, 'vw_pk_JfssyvlfNeu7dYgW4dXuGccU8s2m5f-X');
  pass('Server Velo proxy returns valid wallet-config');
}

// =========================================================================
// Suite 6: Zero Emojis Compliance Scan
// =========================================================================

// Test 18: Scan all source files in sweldosync for emojis
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;

function scanDirectoryForEmojis(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const violations = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }
    if (entry.isDirectory()) {
      violations.push(...scanDirectoryForEmojis(fullPath));
    } else if (
      entry.isFile() &&
      /\.(js|html|css|json|md|template)$/i.test(entry.name) &&
      entry.name !== 'verify-all.js' // exclude the regex definition file itself
    ) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, lineIdx) => {
        if (emojiRegex.test(line)) {
          violations.push(`${fullPath}:${lineIdx + 1}: ${line.trim()}`);
        }
      });
    }
  }
  return violations;
}

const emojiViolations = scanDirectoryForEmojis(rootDir);
assert.equal(
  emojiViolations.length,
  0,
  `Emoji violation detected:\n${emojiViolations.join('\n')}`
);
pass('Zero unicode emojis across all project files verified (0 violations)');

console.log(`[PASS] All ${testsPassed} automated verification checks passed cleanly.`);
process.exit(0);
