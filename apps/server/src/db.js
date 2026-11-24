/**
 * SweldoSync 2.0 SQLite Persistence Layer (sql.js WASM)
 * Single-writer async mutex + atomic same-directory temp + fsync + rename.
 * Zero hardcoded secrets. Zero emojis.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { StrKey } from '@stellar/stellar-sdk';
import {
  DEFAULT_EMPLOYEES,
  PAYROLL_CONFIG,
  fromStroopsToString,
  toStroops,
} from '../../../packages/shared/src/index.js';
import {
  calculateTimesheetPay,
  computePayRunMemoHash,
  convertStroopsBetweenAssets,
} from '../../../packages/agent/src/payroll-agent.js';

const require = createRequire(import.meta.url);
const SQL_WASM_PATH = require.resolve('sql.js/dist/sql-wasm.wasm');

let sqlJsPromise = null;
function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file) =>
        file === 'sql-wasm.wasm' ? SQL_WASM_PATH : path.join(path.dirname(SQL_WASM_PATH), file),
    });
  }
  return sqlJsPromise;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  standardWorkHours REAL NOT NULL,
  maxShiftHours REAL NOT NULL,
  overtimeMultiplier REAL NOT NULL,
  defaultWithholdingPct REAL NOT NULL,
  defaultMaxAutoPayout TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT NOT NULL,
  hourlyRate TEXT NOT NULL,
  currency TEXT NOT NULL,
  settlementAsset TEXT NOT NULL,
  regularHoursCap REAL NOT NULL,
  overtimeMultiplier REAL NOT NULL,
  withholdingPct REAL NOT NULL,
  maxAutoPayout TEXT NOT NULL,
  walletAddress TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timesheets (
  id TEXT PRIMARY KEY,
  employeeId TEXT NOT NULL,
  date TEXT NOT NULL,
  hoursLogged REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  payRunId TEXT,
  overrideReason TEXT,
  overrideActor TEXT,
  overrideAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pay_runs (
  id TEXT PRIMARY KEY,
  periodLabel TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL,
  saltHex TEXT NOT NULL,
  fxRateUsdPerXlm TEXT NOT NULL,
  fxSource TEXT NOT NULL,
  fxTimestamp TEXT NOT NULL,
  totalGrossUsd TEXT NOT NULL DEFAULT '0.0000000',
  totalWithholdingUsd TEXT NOT NULL DEFAULT '0.0000000',
  totalNetUsd TEXT NOT NULL DEFAULT '0.0000000',
  totalSettlementXlm TEXT NOT NULL DEFAULT '0.0000000',
  totalSettlementUsdc TEXT NOT NULL DEFAULT '0.0000000',
  recipientCount INTEGER NOT NULL DEFAULT 0,
  isSimulatedSeed INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  settledAt TEXT
);

CREATE TABLE IF NOT EXISTS pay_run_items (
  id TEXT PRIMARY KEY,
  payRunId TEXT NOT NULL,
  timesheetId TEXT NOT NULL,
  employeeId TEXT NOT NULL,
  employeeName TEXT NOT NULL,
  walletAddress TEXT NOT NULL,
  rateCurrency TEXT NOT NULL,
  settlementAsset TEXT NOT NULL,
  hoursLogged REAL NOT NULL,
  regularHours REAL NOT NULL,
  overtimeHours REAL NOT NULL,
  hourlyRate TEXT NOT NULL,
  regularAmount TEXT NOT NULL,
  overtimeAmount TEXT NOT NULL,
  grossAmount TEXT NOT NULL,
  withholdingAmount TEXT NOT NULL,
  netAmount TEXT NOT NULL,
  settlementAmount TEXT NOT NULL,
  routingKind TEXT,
  chunkIndex INTEGER NOT NULL DEFAULT 0,
  txHash TEXT,
  explorerUrl TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS pay_run_chunks (
  id TEXT PRIMARY KEY,
  payRunId TEXT NOT NULL,
  chunkIndex INTEGER NOT NULL,
  assetCode TEXT NOT NULL,
  assetIssuer TEXT,
  network TEXT NOT NULL,
  networkPassphrase TEXT NOT NULL,
  sourceAccount TEXT,
  sequenceNumber TEXT,
  unsignedXdr TEXT,
  signedXdr TEXT,
  txHash TEXT,
  memoHashHex TEXT NOT NULL,
  manifestJson TEXT NOT NULL,
  opCount INTEGER NOT NULL DEFAULT 0,
  routingSummaryJson TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  ledger INTEGER,
  errorMessage TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  submittedAt TEXT
);

CREATE TABLE IF NOT EXISTS override_audit_log (
  id TEXT PRIMARY KEY,
  timesheetId TEXT NOT NULL,
  employeeId TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  flagsJson TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`;

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(db, sql, params = []) {
  const rows = queryAll(db, sql, params);
  return rows[0] || null;
}

function normalizeEmployeeRow(row) {
  if (!row) return null;
  return {
    ...row,
    isActive: Boolean(row.isActive),
  };
}

function normalizePayRunRow(row) {
  if (!row) return null;
  return {
    ...row,
    isSimulatedSeed: Boolean(row.isSimulatedSeed),
  };
}

export async function createDatabase(dbPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const SQL = await getSqlJs();
  let db;
  if (fs.existsSync(dbPath)) {
    const fileBuf = fs.readFileSync(dbPath);
    db = new SQL.Database(new Uint8Array(fileBuf));
  } else {
    db = new SQL.Database();
  }

  db.run(SCHEMA_SQL);

  let writeQueue = Promise.resolve();
  let closed = false;

  function persistSync() {
    if (closed) return;
    const exported = db.export();
    const buffer = Buffer.from(exported);
    const tmpPath = path.join(dir, `.${path.basename(dbPath)}.${process.pid}.${Date.now()}.tmp`);
    const fd = fs.openSync(tmpPath, 'w', 0o600);
    try {
      fs.writeSync(fd, buffer);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, dbPath);
  }

  function withWriteLock(fn) {
    const task = writeQueue.then(async () => {
      if (closed) throw new Error('Database is closed');
      return fn();
    });
    writeQueue = task.catch(() => {});
    return task;
  }

  function seedIfEmpty() {
    const now = '2026-11-22T09:00:00.000Z';
    const policyRow = queryOne(db, 'SELECT id FROM policy WHERE id = 1');
    if (!policyRow) {
      db.run(
        `INSERT INTO policy (id, standardWorkHours, maxShiftHours, overtimeMultiplier, defaultWithholdingPct, defaultMaxAutoPayout, updatedAt)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
        [
          PAYROLL_CONFIG.STANDARD_WORK_HOURS,
          PAYROLL_CONFIG.MAX_SHIFT_HOURS,
          PAYROLL_CONFIG.OVERTIME_MULTIPLIER,
          PAYROLL_CONFIG.DEFAULT_WITHHOLDING_PCT,
          String(PAYROLL_CONFIG.DEFAULT_MAX_AUTO_PAYOUT),
          now,
        ]
      );
    }

    const empCount = queryOne(db, 'SELECT COUNT(*) AS cnt FROM employees');
    if ((empCount?.cnt || 0) === 0) {
      for (const emp of DEFAULT_EMPLOYEES) {
        db.run(
          `INSERT INTO employees (
            id, name, role, department, hourlyRate, currency, settlementAsset,
            regularHoursCap, overtimeMultiplier, withholdingPct, maxAutoPayout,
            walletAddress, isActive, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            emp.id,
            emp.name,
            emp.role,
            emp.department,
            String(emp.hourlyRate),
            emp.currency,
            emp.settlementAsset,
            emp.regularHoursCap,
            emp.overtimeMultiplier,
            emp.withholdingPct,
            String(emp.maxAutoPayout),
            emp.walletAddress,
            emp.isActive ? 1 : 0,
            now,
            now,
          ]
        );
      }

      const seedTimesheets = [
        {
          id: 'TS-SEED-001',
          employeeId: 'EMP-001',
          date: '2026-11-21',
          hoursLogged: 8,
          notes: 'Soroban escrow integration and signature audit',
          status: 'PENDING',
          payRunId: null,
        },
        {
          id: 'TS-SEED-002',
          employeeId: 'EMP-002',
          date: '2026-11-21',
          hoursLogged: 10,
          notes: 'Trustless XDR decoder and Freighter v4 checkout flow',
          status: 'PENDING',
          payRunId: null,
        },
        {
          id: 'TS-SEED-003',
          employeeId: 'EMP-003',
          date: '2026-11-22',
          hoursLogged: 17.5,
          notes: 'APAC field terminal deployment (>16h guardrail check)',
          status: 'PENDING',
          payRunId: null,
        },
        {
          id: 'TS-SEED-004',
          employeeId: 'EMP-004',
          date: '2026-11-22',
          hoursLogged: 8,
          notes: 'Q4 withholding compliance and payroll reconciliation',
          status: 'PENDING',
          payRunId: null,
        },
        {
          id: 'TS-HIST-001',
          employeeId: 'EMP-001',
          date: '2026-11-14',
          hoursLogged: 8,
          notes: 'Mid-month protocol maintenance shift',
          status: 'PAID',
          payRunId: 'RUN-DEMO-20261115',
        },
        {
          id: 'TS-HIST-002',
          employeeId: 'EMP-002',
          date: '2026-11-14',
          hoursLogged: 8,
          notes: 'Mid-month UI telemetry and accessibility pass',
          status: 'PAID',
          payRunId: 'RUN-DEMO-20261115',
        },
      ];

      for (const ts of seedTimesheets) {
        db.run(
          `INSERT INTO timesheets (
            id, employeeId, date, hoursLogged, notes, status, payRunId, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ts.id, ts.employeeId, ts.date, ts.hoursLogged, ts.notes, ts.status, ts.payRunId, now, now]
        );
      }

      // Seed 1 historical Demo Seed Pay Run with verified RFC-8785 MemoHash (no fake Horizon txHash)
      const histPayRunId = 'RUN-DEMO-20261115';
      const saltHex = crypto.createHash('sha256').update('sweldosync-demo-seed-20261115').digest('hex').slice(0, 32);
      const fxRate = PAYROLL_CONFIG.DEFAULT_FX_USD_PER_XLM;
      const histItems = [];
      let totalGrossUsd = 0n;
      let totalWhUsd = 0n;
      let totalNetUsd = 0n;
      let totalXlm = 0n;
      let totalUsdc = 0n;

      for (const [idx, ts] of [seedTimesheets[4], seedTimesheets[5]].entries()) {
        const emp = DEFAULT_EMPLOYEES[idx];
        const calc = calculateTimesheetPay({
          hoursLogged: ts.hoursLogged,
          hourlyRate: emp.hourlyRate,
          regularHoursCap: emp.regularHoursCap,
          overtimeMultiplier: emp.overtimeMultiplier,
          withholdingPct: emp.withholdingPct,
        });
        const settlementStroops = convertStroopsBetweenAssets(
          calc.netStroops,
          emp.currency,
          emp.settlementAsset,
          fxRate
        );
        const settlementAmount = fromStroopsToString(settlementStroops);
        totalGrossUsd += BigInt(calc.grossStroops);
        totalWhUsd += BigInt(calc.withholdingStroops);
        totalNetUsd += BigInt(calc.netStroops);
        if (emp.settlementAsset === 'XLM') {
          totalXlm += settlementStroops;
        } else {
          totalUsdc += settlementStroops;
        }

        histItems.push({
          id: `ITEM-HIST-00${idx + 1}`,
          payRunId: histPayRunId,
          timesheetId: ts.id,
          employeeId: emp.id,
          employeeName: emp.name,
          walletAddress: emp.walletAddress,
          rateCurrency: emp.currency,
          settlementAsset: emp.settlementAsset,
          hoursLogged: ts.hoursLogged,
          regularHours: calc.regularHours,
          overtimeHours: calc.overtimeHours,
          hourlyRate: emp.hourlyRate,
          regularAmount: calc.regularAmount,
          overtimeAmount: calc.overtimeAmount,
          grossAmount: calc.grossAmount,
          withholdingAmount: calc.withholdingAmount,
          netAmount: calc.netAmount,
          settlementAmount,
          routingKind: 'demo_sample',
          chunkIndex: 0,
          txHash: null,
          explorerUrl: null,
          status: 'SETTLED',
        });
      }

      const histAsset = DEFAULT_EMPLOYEES[0].settlementAsset;
      const manifest = {
        payRunId: histPayRunId,
        network: 'testnet',
        assetCode: histAsset,
        saltHex,
        chunkIndex: 0,
        items: histItems.map((it) => ({
          employeeId: it.employeeId,
          walletAddress: it.walletAddress,
          netAmount: it.settlementAmount,
        })),
      };
      const { canonicalJson, sha256Hex } = computePayRunMemoHash(manifest);

      db.run(
        `INSERT INTO pay_runs (
          id, periodLabel, network, status, saltHex, fxRateUsdPerXlm, fxSource, fxTimestamp,
          totalGrossUsd, totalWithholdingUsd, totalNetUsd, totalSettlementXlm, totalSettlementUsdc,
          recipientCount, isSimulatedSeed, createdAt, settledAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          histPayRunId,
          'Nov 1-15, 2026 (Demo Seed)',
          'testnet',
          'SETTLED',
          saltHex,
          fxRate,
          'cached_seed',
          '2026-11-15T16:00:00.000Z',
          fromStroopsToString(totalGrossUsd),
          fromStroopsToString(totalWhUsd),
          fromStroopsToString(totalNetUsd),
          fromStroopsToString(totalXlm),
          fromStroopsToString(totalUsdc),
          histItems.length,
          1,
          '2026-11-15T15:55:00.000Z',
          '2026-11-15T16:00:00.000Z',
        ]
      );

      for (const it of histItems) {
        db.run(
          `INSERT INTO pay_run_items (
            id, payRunId, timesheetId, employeeId, employeeName, walletAddress, rateCurrency,
            settlementAsset, hoursLogged, regularHours, overtimeHours, hourlyRate, regularAmount,
            overtimeAmount, grossAmount, withholdingAmount, netAmount, settlementAmount,
            routingKind, chunkIndex, txHash, explorerUrl, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            it.id,
            it.payRunId,
            it.timesheetId,
            it.employeeId,
            it.employeeName,
            it.walletAddress,
            it.rateCurrency,
            it.settlementAsset,
            it.hoursLogged,
            it.regularHours,
            it.overtimeHours,
            it.hourlyRate,
            it.regularAmount,
            it.overtimeAmount,
            it.grossAmount,
            it.withholdingAmount,
            it.netAmount,
            it.settlementAmount,
            it.routingKind,
            it.chunkIndex,
            it.txHash,
            it.explorerUrl,
            it.status,
          ]
        );
      }

      db.run(
        `INSERT INTO pay_run_chunks (
          id, payRunId, chunkIndex, assetCode, assetIssuer, network, networkPassphrase,
          sourceAccount, sequenceNumber, unsignedXdr, signedXdr, txHash, memoHashHex,
          manifestJson, opCount, routingSummaryJson, status, ledger, errorMessage,
          createdAt, updatedAt, submittedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${histPayRunId}-C0`,
          histPayRunId,
          0,
          histAsset,
          histAsset === 'USDC' ? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' : null,
          'testnet',
          'Test SDF Network ; September 2015',
          null,
          null,
          null,
          null,
          null,
          sha256Hex,
          canonicalJson,
          histItems.length,
          JSON.stringify({ demo_sample: histItems.length }),
          'SETTLED',
          null,
          null,
          '2026-11-15T15:55:00.000Z',
          '2026-11-15T16:00:00.000Z',
          '2026-11-15T16:00:00.000Z',
        ]
      );
    } else {
      // Migrate legacy v1/initial seed addresses that collided with demo treasury keys
      const legacySeedWallets = {
        'EMP-001': 'GBZOFVJBXQADCCG2BOBC4DTBUSSSTA4OYJR3P4EZCZ75JHYHHQ6PLOLD',
        'EMP-002': 'GATDP2GAYZZB6PONNZDUKDQCN5YEZUU6VF6M3KSZ7KRDPKPGXVBQVYTU',
        'EMP-003': 'GCIOXLXP636L6FZUARPXNHFPTXU3WDTGX2UJFZUP2LOGTG32OSDMJHWL',
        'EMP-004': 'GBFIEW4QNE6HV7I5T5MUEMGKYRHH67QUUAMBYDBIICSQVJJ57NKKXONQ',
      };
      for (const def of DEFAULT_EMPLOYEES) {
        const legacyAddr = legacySeedWallets[def.id];
        if (!legacyAddr) continue;
        const row = queryOne(
          db,
          'SELECT walletAddress, hourlyRate, settlementAsset FROM employees WHERE id = ?',
          [def.id]
        );
        if (!row) continue;
        const nowIso = new Date().toISOString();
        if (row.walletAddress === legacyAddr) {
          db.run('UPDATE employees SET walletAddress = ?, updatedAt = ? WHERE id = ?', [
            def.walletAddress,
            nowIso,
            def.id,
          ]);
        }
        if (
          (def.id === 'EMP-001' || def.id === 'EMP-002') &&
          row.settlementAsset === 'USDC' &&
          row.hourlyRate === def.hourlyRate
        ) {
          db.run('UPDATE employees SET settlementAsset = ?, updatedAt = ? WHERE id = ?', [
            'XLM',
            nowIso,
            def.id,
          ]);
        }
        if (def.id === 'EMP-003' && row.hourlyRate === '60.00') {
          db.run('UPDATE employees SET hourlyRate = ?, updatedAt = ? WHERE id = ?', [
            def.hourlyRate,
            nowIso,
            def.id,
          ]);
        }
      }
    }

    persistSync();
  }

  seedIfEmpty();

  return {
    dbPath,
    getPolicy() {
      return queryOne(db, 'SELECT * FROM policy WHERE id = 1');
    },
    async updatePolicy(updates) {
      return withWriteLock(() => {
        const cur = queryOne(db, 'SELECT * FROM policy WHERE id = 1');
        const next = {
          standardWorkHours: Number(updates.standardWorkHours ?? cur.standardWorkHours),
          maxShiftHours: Number(updates.maxShiftHours ?? cur.maxShiftHours),
          overtimeMultiplier: Number(updates.overtimeMultiplier ?? cur.overtimeMultiplier),
          defaultWithholdingPct: Number(updates.defaultWithholdingPct ?? cur.defaultWithholdingPct),
          defaultMaxAutoPayout: String(updates.defaultMaxAutoPayout ?? cur.defaultMaxAutoPayout),
          updatedAt: new Date().toISOString(),
        };
        db.run(
          `UPDATE policy SET standardWorkHours=?, maxShiftHours=?, overtimeMultiplier=?, defaultWithholdingPct=?, defaultMaxAutoPayout=?, updatedAt=? WHERE id=1`,
          [
            next.standardWorkHours,
            next.maxShiftHours,
            next.overtimeMultiplier,
            next.defaultWithholdingPct,
            next.defaultMaxAutoPayout,
            next.updatedAt,
          ]
        );
        persistSync();
        return queryOne(db, 'SELECT * FROM policy WHERE id = 1');
      });
    },
    listEmployees({ includeInactive = true } = {}) {
      const sql = includeInactive
        ? 'SELECT * FROM employees ORDER BY id ASC'
        : 'SELECT * FROM employees WHERE isActive = 1 ORDER BY id ASC';
      return queryAll(db, sql).map(normalizeEmployeeRow);
    },
    getEmployee(id) {
      return normalizeEmployeeRow(queryOne(db, 'SELECT * FROM employees WHERE id = ?', [id]));
    },
    async createEmployee(emp) {
      return withWriteLock(() => {
        const now = new Date().toISOString();
        const id = emp.id || `EMP-${Date.now().toString(36).toUpperCase()}`;
        db.run(
          `INSERT INTO employees (
            id, name, role, department, hourlyRate, currency, settlementAsset,
            regularHoursCap, overtimeMultiplier, withholdingPct, maxAutoPayout,
            walletAddress, isActive, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            emp.name,
            emp.role || 'Team Member',
            emp.department || 'Operations',
            String(emp.hourlyRate),
            emp.currency || 'USD',
            emp.settlementAsset || 'USDC',
            Number(emp.regularHoursCap ?? 8),
            Number(emp.overtimeMultiplier ?? 1.25),
            Number(emp.withholdingPct ?? 5),
            String(emp.maxAutoPayout ?? '1000.00'),
            emp.walletAddress,
            emp.isActive === false ? 0 : 1,
            now,
            now,
          ]
        );
        persistSync();
        return normalizeEmployeeRow(queryOne(db, 'SELECT * FROM employees WHERE id = ?', [id]));
      });
    },
    async updateEmployee(id, updates) {
      return withWriteLock(() => {
        const cur = queryOne(db, 'SELECT * FROM employees WHERE id = ?', [id]);
        if (!cur) return null;
        const now = new Date().toISOString();
        const merged = {
          name: updates.name ?? cur.name,
          role: updates.role ?? cur.role,
          department: updates.department ?? cur.department,
          hourlyRate: updates.hourlyRate !== undefined ? String(updates.hourlyRate) : cur.hourlyRate,
          currency: updates.currency ?? cur.currency,
          settlementAsset: updates.settlementAsset ?? cur.settlementAsset,
          regularHoursCap:
            updates.regularHoursCap !== undefined ? Number(updates.regularHoursCap) : cur.regularHoursCap,
          overtimeMultiplier:
            updates.overtimeMultiplier !== undefined
              ? Number(updates.overtimeMultiplier)
              : cur.overtimeMultiplier,
          withholdingPct:
            updates.withholdingPct !== undefined ? Number(updates.withholdingPct) : cur.withholdingPct,
          maxAutoPayout:
            updates.maxAutoPayout !== undefined ? String(updates.maxAutoPayout) : cur.maxAutoPayout,
          walletAddress: updates.walletAddress ?? cur.walletAddress,
          isActive: updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : cur.isActive,
        };
        db.run(
          `UPDATE employees SET name=?, role=?, department=?, hourlyRate=?, currency=?, settlementAsset=?, regularHoursCap=?, overtimeMultiplier=?, withholdingPct=?, maxAutoPayout=?, walletAddress=?, isActive=?, updatedAt=? WHERE id=?`,
          [
            merged.name,
            merged.role,
            merged.department,
            merged.hourlyRate,
            merged.currency,
            merged.settlementAsset,
            merged.regularHoursCap,
            merged.overtimeMultiplier,
            merged.withholdingPct,
            merged.maxAutoPayout,
            merged.walletAddress,
            merged.isActive,
            now,
            id,
          ]
        );
        persistSync();
        return normalizeEmployeeRow(queryOne(db, 'SELECT * FROM employees WHERE id = ?', [id]));
      });
    },
    async deleteEmployee(id) {
      return withWriteLock(() => {
        const cur = queryOne(db, 'SELECT * FROM employees WHERE id = ?', [id]);
        if (!cur) return false;
        db.run('DELETE FROM employees WHERE id = ?', [id]);
        persistSync();
        return true;
      });
    },
    listTimesheets() {
      return queryAll(db, 'SELECT * FROM timesheets ORDER BY date DESC, createdAt DESC');
    },
    getTimesheet(id) {
      return queryOne(db, 'SELECT * FROM timesheets WHERE id = ?', [id]);
    },
    async createTimesheet(ts) {
      return withWriteLock(() => {
        const now = new Date().toISOString();
        const id = ts.id || `TS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        db.run(
          `INSERT INTO timesheets (
            id, employeeId, date, hoursLogged, notes, status, payRunId, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            ts.employeeId,
            ts.date || now.slice(0, 10),
            Number(ts.hoursLogged),
            String(ts.notes || ''),
            ts.status || 'PENDING',
            ts.payRunId || null,
            now,
            now,
          ]
        );
        persistSync();
        return queryOne(db, 'SELECT * FROM timesheets WHERE id = ?', [id]);
      });
    },
    async createTimesheetsBulk(items) {
      return withWriteLock(() => {
        const now = new Date().toISOString();
        const created = [];
        db.run('BEGIN TRANSACTION');
        try {
          for (const ts of items) {
            const id =
              ts.id || `TS-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
            db.run(
              `INSERT INTO timesheets (
                id, employeeId, date, hoursLogged, notes, status, payRunId, createdAt, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                ts.employeeId,
                ts.date || now.slice(0, 10),
                Number(ts.hoursLogged),
                String(ts.notes || ''),
                ts.status || 'PENDING',
                ts.payRunId || null,
                now,
                now,
              ]
            );
            created.push(queryOne(db, 'SELECT * FROM timesheets WHERE id = ?', [id]));
          }
          db.run('COMMIT');
        } catch (err) {
          db.run('ROLLBACK');
          throw err;
        }
        persistSync();
        return created;
      });
    },
    async updateTimesheet(id, updates, auditEntry = null) {
      return withWriteLock(() => {
        const cur = queryOne(db, 'SELECT * FROM timesheets WHERE id = ?', [id]);
        if (!cur) return null;
        const now = new Date().toISOString();
        const next = {
          date: updates.date ?? cur.date,
          hoursLogged: updates.hoursLogged !== undefined ? Number(updates.hoursLogged) : cur.hoursLogged,
          notes: updates.notes !== undefined ? String(updates.notes) : cur.notes,
          status: updates.status ?? cur.status,
          payRunId: updates.payRunId !== undefined ? updates.payRunId : cur.payRunId,
          overrideReason: updates.overrideReason !== undefined ? updates.overrideReason : cur.overrideReason,
          overrideActor: updates.overrideActor !== undefined ? updates.overrideActor : cur.overrideActor,
          overrideAt: updates.overrideAt !== undefined ? updates.overrideAt : cur.overrideAt,
        };
        db.run(
          `UPDATE timesheets SET date=?, hoursLogged=?, notes=?, status=?, payRunId=?, overrideReason=?, overrideActor=?, overrideAt=?, updatedAt=? WHERE id=?`,
          [
            next.date,
            next.hoursLogged,
            next.notes,
            next.status,
            next.payRunId,
            next.overrideReason,
            next.overrideActor,
            next.overrideAt,
            now,
            id,
          ]
        );
        if (auditEntry) {
          db.run(
            `INSERT INTO override_audit_log (id, timesheetId, employeeId, action, actor, reason, flagsJson, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `OVR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
              id,
              cur.employeeId,
              auditEntry.action || 'OVERRIDE_APPROVED',
              auditEntry.actor || 'payroll-admin',
              auditEntry.reason || '',
              JSON.stringify(auditEntry.flags || []),
              now,
            ]
          );
        }
        persistSync();
        return queryOne(db, 'SELECT * FROM timesheets WHERE id = ?', [id]);
      });
    },
    async deleteTimesheet(id) {
      return withWriteLock(() => {
        const cur = queryOne(db, 'SELECT * FROM timesheets WHERE id = ?', [id]);
        if (!cur) return false;
        db.run('DELETE FROM timesheets WHERE id = ?', [id]);
        persistSync();
        return true;
      });
    },
    listPayRuns() {
      const empMap = new Map(this.listEmployees({ includeInactive: true }).map((e) => [e.id, e]));
      const enrichItem = (it) => {
        const emp = empMap.get(it.employeeId);
        return {
          ...it,
          currency: it.currency || it.rateCurrency || emp?.currency || 'USD',
          overtimeMultiplier: Number(it.overtimeMultiplier ?? emp?.overtimeMultiplier ?? 1.25),
          withholdingPct: Number(it.withholdingPct ?? emp?.withholdingPct ?? 5),
        };
      };
      const runs = queryAll(db, 'SELECT * FROM pay_runs ORDER BY createdAt DESC').map(normalizePayRunRow);
      return runs.map((run) => {
        const items = queryAll(db, 'SELECT * FROM pay_run_items WHERE payRunId = ? ORDER BY chunkIndex ASC, id ASC', [
          run.id,
        ]).map(enrichItem);
        const chunks = queryAll(
          db,
          'SELECT * FROM pay_run_chunks WHERE payRunId = ? ORDER BY chunkIndex ASC',
          [run.id]
        ).map((c) => ({
          ...c,
          routingSummary: c.routingSummaryJson ? JSON.parse(c.routingSummaryJson) : {},
        }));
        return { ...run, items, chunks };
      });
    },
    getPayRun(id) {
      const run = normalizePayRunRow(queryOne(db, 'SELECT * FROM pay_runs WHERE id = ?', [id]));
      if (!run) return null;
      const empMap = new Map(this.listEmployees({ includeInactive: true }).map((e) => [e.id, e]));
      const items = queryAll(db, 'SELECT * FROM pay_run_items WHERE payRunId = ? ORDER BY chunkIndex ASC, id ASC', [
        id,
      ]).map((it) => {
        const emp = empMap.get(it.employeeId);
        return {
          ...it,
          currency: it.currency || it.rateCurrency || emp?.currency || 'USD',
          overtimeMultiplier: Number(it.overtimeMultiplier ?? emp?.overtimeMultiplier ?? 1.25),
          withholdingPct: Number(it.withholdingPct ?? emp?.withholdingPct ?? 5),
        };
      });
      const chunks = queryAll(
        db,
        'SELECT * FROM pay_run_chunks WHERE payRunId = ? ORDER BY chunkIndex ASC',
        [id]
      ).map((c) => ({
        ...c,
        routingSummary: c.routingSummaryJson ? JSON.parse(c.routingSummaryJson) : {},
      }));
      return { ...run, items, chunks };
    },
    async createPayRun({ payRun, items, chunks }) {
      return withWriteLock(() => {
        db.run('BEGIN TRANSACTION');
        try {
          db.run(
            `INSERT INTO pay_runs (
              id, periodLabel, network, status, saltHex, fxRateUsdPerXlm, fxSource, fxTimestamp,
              totalGrossUsd, totalWithholdingUsd, totalNetUsd, totalSettlementXlm, totalSettlementUsdc,
              recipientCount, isSimulatedSeed, createdAt, settledAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              payRun.id,
              payRun.periodLabel,
              payRun.network,
              payRun.status,
              payRun.saltHex,
              payRun.fxRateUsdPerXlm,
              payRun.fxSource,
              payRun.fxTimestamp,
              payRun.totalGrossUsd,
              payRun.totalWithholdingUsd,
              payRun.totalNetUsd,
              payRun.totalSettlementXlm,
              payRun.totalSettlementUsdc,
              payRun.recipientCount,
              payRun.isSimulatedSeed ? 1 : 0,
              payRun.createdAt,
              payRun.settledAt || null,
            ]
          );

          for (const it of items) {
            db.run(
              `INSERT INTO pay_run_items (
                id, payRunId, timesheetId, employeeId, employeeName, walletAddress, rateCurrency,
                settlementAsset, hoursLogged, regularHours, overtimeHours, hourlyRate, regularAmount,
                overtimeAmount, grossAmount, withholdingAmount, netAmount, settlementAmount,
                routingKind, chunkIndex, txHash, explorerUrl, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                it.id,
                payRun.id,
                it.timesheetId,
                it.employeeId,
                it.employeeName,
                it.walletAddress,
                it.rateCurrency,
                it.settlementAsset,
                it.hoursLogged,
                it.regularHours,
                it.overtimeHours,
                it.hourlyRate,
                it.regularAmount,
                it.overtimeAmount,
                it.grossAmount,
                it.withholdingAmount,
                it.netAmount,
                it.settlementAmount,
                it.routingKind || null,
                it.chunkIndex,
                it.txHash || null,
                it.explorerUrl || null,
                it.status || 'PENDING',
              ]
            );
            db.run(
              `UPDATE timesheets SET status = 'LOCKED', payRunId = ?, updatedAt = ? WHERE id = ?`,
              [payRun.id, payRun.createdAt, it.timesheetId]
            );
          }

          for (const ch of chunks) {
            db.run(
              `INSERT INTO pay_run_chunks (
                id, payRunId, chunkIndex, assetCode, assetIssuer, network, networkPassphrase,
                sourceAccount, sequenceNumber, unsignedXdr, signedXdr, txHash, memoHashHex,
                manifestJson, opCount, routingSummaryJson, status, ledger, errorMessage,
                createdAt, updatedAt, submittedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                ch.id,
                payRun.id,
                ch.chunkIndex,
                ch.assetCode,
                ch.assetIssuer || null,
                ch.network,
                ch.networkPassphrase,
                ch.sourceAccount || null,
                ch.sequenceNumber || null,
                ch.unsignedXdr || null,
                ch.signedXdr || null,
                ch.txHash || null,
                ch.memoHashHex,
                ch.manifestJson,
                ch.opCount,
                JSON.stringify(ch.routingSummary || {}),
                ch.status || 'PENDING',
                ch.ledger || null,
                ch.errorMessage || null,
                ch.createdAt,
                ch.updatedAt,
                ch.submittedAt || null,
              ]
            );
          }

          db.run('COMMIT');
        } catch (err) {
          db.run('ROLLBACK');
          throw err;
        }
        persistSync();
        return this.getPayRun(payRun.id);
      });
    },
    getPayRunChunk(payRunId, chunkIndex) {
      const ch = queryOne(
        db,
        'SELECT * FROM pay_run_chunks WHERE payRunId = ? AND chunkIndex = ?',
        [payRunId, Number(chunkIndex)]
      );
      if (!ch) return null;
      return {
        ...ch,
        routingSummary: ch.routingSummaryJson ? JSON.parse(ch.routingSummaryJson) : {},
      };
    },
    async updatePayRunChunkAndItems(payRunId, chunkIndex, chunkUpdates, itemUpdates = []) {
      return withWriteLock(() => {
        const now = new Date().toISOString();
        const ch = queryOne(
          db,
          'SELECT * FROM pay_run_chunks WHERE payRunId = ? AND chunkIndex = ?',
          [payRunId, Number(chunkIndex)]
        );
        if (!ch) return null;

        db.run('BEGIN TRANSACTION');
        try {
          db.run(
            `UPDATE pay_run_chunks SET
              sourceAccount=?, sequenceNumber=?, unsignedXdr=?, signedXdr=?, txHash=?,
              opCount=?, routingSummaryJson=?, status=?, ledger=?, errorMessage=?,
              updatedAt=?, submittedAt=?
             WHERE payRunId=? AND chunkIndex=?`,
            [
              chunkUpdates.sourceAccount !== undefined ? chunkUpdates.sourceAccount : ch.sourceAccount,
              chunkUpdates.sequenceNumber !== undefined ? chunkUpdates.sequenceNumber : ch.sequenceNumber,
              chunkUpdates.unsignedXdr !== undefined ? chunkUpdates.unsignedXdr : ch.unsignedXdr,
              chunkUpdates.signedXdr !== undefined ? chunkUpdates.signedXdr : ch.signedXdr,
              chunkUpdates.txHash !== undefined ? chunkUpdates.txHash : ch.txHash,
              chunkUpdates.opCount !== undefined ? chunkUpdates.opCount : ch.opCount,
              chunkUpdates.routingSummary !== undefined
                ? JSON.stringify(chunkUpdates.routingSummary)
                : ch.routingSummaryJson,
              chunkUpdates.status !== undefined ? chunkUpdates.status : ch.status,
              chunkUpdates.ledger !== undefined ? chunkUpdates.ledger : ch.ledger,
              chunkUpdates.errorMessage !== undefined ? chunkUpdates.errorMessage : ch.errorMessage,
              now,
              chunkUpdates.submittedAt !== undefined ? chunkUpdates.submittedAt : ch.submittedAt,
              payRunId,
              Number(chunkIndex),
            ]
          );

          for (const upd of itemUpdates) {
            db.run(
              `UPDATE pay_run_items SET routingKind = COALESCE(?, routingKind), txHash = COALESCE(?, txHash), explorerUrl = COALESCE(?, explorerUrl), status = COALESCE(?, status) WHERE id = ?`,
              [
                upd.routingKind ?? null,
                upd.txHash ?? null,
                upd.explorerUrl ?? null,
                upd.status ?? null,
                upd.id,
              ]
            );
            if (upd.status === 'SETTLED' && upd.timesheetId) {
              db.run(`UPDATE timesheets SET status = 'PAID', payRunId = ?, updatedAt = ? WHERE id = ?`, [
                payRunId,
                now,
                upd.timesheetId,
              ]);
            }
          }

          // Recompute PayRun overall status from chunks
          const allChunks = queryAll(db, 'SELECT status FROM pay_run_chunks WHERE payRunId = ?', [payRunId]);
          const allSettled = allChunks.length > 0 && allChunks.every((c) => c.status === 'SETTLED');
          const anySettled = allChunks.some((c) => c.status === 'SETTLED');
          const anyBuilt = allChunks.some((c) => c.status === 'BUILT' || c.status === 'SIGNED');
          const nextRunStatus = allSettled
            ? 'SETTLED'
            : anySettled
            ? 'PARTIAL'
            : anyBuilt
            ? 'READY_TO_SIGN'
            : 'DRAFT';

          db.run(`UPDATE pay_runs SET status = ?, settledAt = COALESCE(?, settledAt) WHERE id = ?`, [
            nextRunStatus,
            allSettled ? now : null,
            payRunId,
          ]);

          db.run('COMMIT');
        } catch (err) {
          db.run('ROLLBACK');
          throw err;
        }
        persistSync();
        return this.getPayRun(payRunId);
      });
    },
    listOverrideAuditLog() {
      return queryAll(db, 'SELECT * FROM override_audit_log ORDER BY createdAt DESC').map((r) => ({
        ...r,
        flags: r.flagsJson ? JSON.parse(r.flagsJson) : [],
      }));
    },
    exportWorkspace() {
      const sanitizedPayRuns = this.listPayRuns().map(({ isSimulatedSeed, ...rest }) => ({
        ...rest,
        isSimulatedDemo: Boolean(isSimulatedSeed),
      }));
      return {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        policy: this.getPolicy(),
        employees: this.listEmployees({ includeInactive: true }),
        timesheets: this.listTimesheets(),
        payRuns: sanitizedPayRuns,
        overrideAuditLog: this.listOverrideAuditLog(),
      };
    },
    async importWorkspace(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw Object.assign(new Error('Workspace payload must be a JSON object'), { status: 400 });
      }
      if (!Array.isArray(payload.employees) || !Array.isArray(payload.timesheets)) {
        throw Object.assign(new Error('Workspace payload must contain employees and timesheets arrays'), {
          status: 400,
        });
      }
      for (const emp of payload.employees) {
        if (!emp?.id || !emp?.name || !StrKey.isValidEd25519PublicKey(String(emp.walletAddress || ''))) {
          throw Object.assign(
            new Error(`Invalid employee record or Stellar address for ${emp?.id || 'unknown'}`),
            { status: 400 }
          );
        }
        toStroops(emp.hourlyRate ?? '0');
      }
      for (const ts of payload.timesheets) {
        if (!ts?.id || !ts?.employeeId || !Number.isFinite(Number(ts.hoursLogged))) {
          throw Object.assign(new Error(`Invalid timesheet record ${ts?.id || 'unknown'}`), { status: 400 });
        }
      }

      return withWriteLock(() => {
        const now = new Date().toISOString();
        db.run('BEGIN TRANSACTION');
        try {
          if (payload.policy && typeof payload.policy === 'object') {
            const p = payload.policy;
            db.run(
              `UPDATE policy SET standardWorkHours=?, maxShiftHours=?, overtimeMultiplier=?, defaultWithholdingPct=?, defaultMaxAutoPayout=?, updatedAt=? WHERE id=1`,
              [
                Number(p.standardWorkHours ?? PAYROLL_CONFIG.STANDARD_WORK_HOURS),
                Number(p.maxShiftHours ?? PAYROLL_CONFIG.MAX_SHIFT_HOURS),
                Number(p.overtimeMultiplier ?? PAYROLL_CONFIG.OVERTIME_MULTIPLIER),
                Number(p.defaultWithholdingPct ?? PAYROLL_CONFIG.DEFAULT_WITHHOLDING_PCT),
                String(p.defaultMaxAutoPayout ?? PAYROLL_CONFIG.DEFAULT_MAX_AUTO_PAYOUT),
                now,
              ]
            );
          }

          db.run('DELETE FROM employees');
          for (const emp of payload.employees) {
            db.run(
              `INSERT INTO employees (
                id, name, role, department, hourlyRate, currency, settlementAsset,
                regularHoursCap, overtimeMultiplier, withholdingPct, maxAutoPayout,
                walletAddress, isActive, createdAt, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                String(emp.id),
                String(emp.name),
                String(emp.role || 'Team Member'),
                String(emp.department || 'Operations'),
                String(emp.hourlyRate),
                String(emp.currency || 'USD'),
                String(emp.settlementAsset || 'USDC'),
                Number(emp.regularHoursCap ?? 8),
                Number(emp.overtimeMultiplier ?? 1.25),
                Number(emp.withholdingPct ?? 5),
                String(emp.maxAutoPayout ?? '1000.00'),
                String(emp.walletAddress),
                emp.isActive === false ? 0 : 1,
                emp.createdAt || now,
                now,
              ]
            );
          }

          db.run('DELETE FROM timesheets');
          for (const ts of payload.timesheets) {
            db.run(
              `INSERT INTO timesheets (
                id, employeeId, date, hoursLogged, notes, status, payRunId,
                overrideReason, overrideActor, overrideAt, createdAt, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                String(ts.id),
                String(ts.employeeId),
                String(ts.date || now.slice(0, 10)),
                Number(ts.hoursLogged),
                String(ts.notes || ''),
                String(ts.status || 'PENDING'),
                ts.payRunId || null,
                ts.overrideReason || null,
                ts.overrideActor || null,
                ts.overrideAt || null,
                ts.createdAt || now,
                now,
              ]
            );
          }

          if (Array.isArray(payload.payRuns)) {
            db.run('DELETE FROM pay_run_chunks');
            db.run('DELETE FROM pay_run_items');
            db.run('DELETE FROM pay_runs');
            for (const run of payload.payRuns) {
              db.run(
                `INSERT INTO pay_runs (
                  id, periodLabel, network, status, saltHex, fxRateUsdPerXlm, fxSource, fxTimestamp,
                  totalGrossUsd, totalWithholdingUsd, totalNetUsd, totalSettlementXlm, totalSettlementUsdc,
                  recipientCount, isSimulatedSeed, createdAt, settledAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  String(run.id),
                  String(run.periodLabel || 'Imported Pay Run'),
                  String(run.network || 'testnet'),
                  String(run.status || 'SETTLED'),
                  String(run.saltHex || '00000000000000000000000000000000'),
                  String(run.fxRateUsdPerXlm || PAYROLL_CONFIG.DEFAULT_FX_USD_PER_XLM),
                  String(run.fxSource || 'imported'),
                  String(run.fxTimestamp || now),
                  String(run.totalGrossUsd || '0.0000000'),
                  String(run.totalWithholdingUsd || '0.0000000'),
                  String(run.totalNetUsd || '0.0000000'),
                  String(run.totalSettlementXlm || '0.0000000'),
                  String(run.totalSettlementUsdc || '0.0000000'),
                  Number(run.recipientCount || 0),
                  run.isSimulatedDemo || run.isSimulatedSeed ? 1 : 0,
                  String(run.createdAt || now),
                  run.settledAt || null,
                ]
              );
              for (const it of run.items || []) {
                db.run(
                  `INSERT INTO pay_run_items (
                    id, payRunId, timesheetId, employeeId, employeeName, walletAddress, rateCurrency,
                    settlementAsset, hoursLogged, regularHours, overtimeHours, hourlyRate, regularAmount,
                    overtimeAmount, grossAmount, withholdingAmount, netAmount, settlementAmount,
                    routingKind, chunkIndex, txHash, explorerUrl, status
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    String(it.id),
                    String(run.id),
                    String(it.timesheetId),
                    String(it.employeeId),
                    String(it.employeeName),
                    String(it.walletAddress),
                    String(it.rateCurrency || 'USD'),
                    String(it.settlementAsset || 'USDC'),
                    Number(it.hoursLogged || 0),
                    Number(it.regularHours || 0),
                    Number(it.overtimeHours || 0),
                    String(it.hourlyRate || '0'),
                    String(it.regularAmount || '0.0000000'),
                    String(it.overtimeAmount || '0.0000000'),
                    String(it.grossAmount || '0.0000000'),
                    String(it.withholdingAmount || '0.0000000'),
                    String(it.netAmount || '0.0000000'),
                    String(it.settlementAmount || '0.0000000'),
                    it.routingKind || null,
                    Number(it.chunkIndex || 0),
                    it.txHash || null,
                    it.explorerUrl || null,
                    String(it.status || 'SETTLED'),
                  ]
                );
              }
              for (const ch of run.chunks || []) {
                db.run(
                  `INSERT INTO pay_run_chunks (
                    id, payRunId, chunkIndex, assetCode, assetIssuer, network, networkPassphrase,
                    sourceAccount, sequenceNumber, unsignedXdr, signedXdr, txHash, memoHashHex,
                    manifestJson, opCount, routingSummaryJson, status, ledger, errorMessage,
                    createdAt, updatedAt, submittedAt
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    String(ch.id),
                    String(run.id),
                    Number(ch.chunkIndex || 0),
                    String(ch.assetCode || 'XLM'),
                    ch.assetIssuer || null,
                    String(ch.network || 'testnet'),
                    String(ch.networkPassphrase || 'Test SDF Network ; September 2015'),
                    ch.sourceAccount || null,
                    ch.sequenceNumber || null,
                    ch.unsignedXdr || null,
                    ch.signedXdr || null,
                    ch.txHash || null,
                    String(ch.memoHashHex || ''),
                    String(ch.manifestJson || '{}'),
                    Number(ch.opCount || 0),
                    JSON.stringify(ch.routingSummary || {}),
                    String(ch.status || 'SETTLED'),
                    ch.ledger || null,
                    ch.errorMessage || null,
                    String(ch.createdAt || now),
                    String(ch.updatedAt || now),
                    ch.submittedAt || null,
                  ]
                );
              }
            }
          }

          db.run('COMMIT');
        } catch (err) {
          db.run('ROLLBACK');
          throw err;
        }
        persistSync();
        return this.exportWorkspace();
      });
    },
    async close() {
      await writeQueue;
      if (!closed) {
        persistSync();
        closed = true;
        db.close();
      }
    },
  };
}
