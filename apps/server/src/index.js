/**
 * SweldoSync 2.0 Express API Server
 *
 * Hardened REST API, SQLite persistence (sql.js), Stellar Testnet & Mainnet XDR builder,
 * constant-time ADMIN_TOKEN auth, rate limiting, and static SPA serving.
 * Zero hardcoded secrets. Zero emojis.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { Networks, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  CONTRACT_IDS,
  NETWORKS_CONFIG,
  PAYROLL_CONFIG,
  formatExplorerTxUrl,
  fromStroopsToString,
  toStroops,
} from '../../../packages/shared/src/index.js';
import {
  calculateTimesheetPay,
  computePayRunMemoHash,
  convertStroopsBetweenAssets,
  evaluateGuardrails,
  verifyPayRunMemoHash,
} from '../../../packages/agent/src/payroll-agent.js';
import { createDatabase } from './db.js';
import {
  assertDemoSignAllowed,
  buildChunkTransaction,
  fundTestnetAccount,
  getFxQuote,
  getHorizonServer,
  getNetworkConfig,
  getTreasuryStatus,
  isFxQuoteStale,
  resolveDemoTreasuryKeypair,
  submitSignedChunkXdr,
} from './stellar-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SWELDOSYNC_ROOT = path.resolve(__dirname, '../../../');

function hydrateEnv() {
  const candidates = [path.join(SWELDOSYNC_ROOT, '.env')];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

hydrateEnv();

function checkBearerToken(req, expectedToken) {
  if (!expectedToken) return false;
  const header = String(req.headers?.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  const token = header.slice(7).trim();
  const providedBuf = Buffer.from(token, 'utf8');
  const expectedBuf = Buffer.from(String(expectedToken), 'utf8');
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function createRateLimiter({ windowMs, maxRequests }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > maxRequests) {
      return res.status(429).json({
        ok: false,
        error: 'Rate limit exceeded. Please wait before retrying.',
      });
    }
    return next();
  };
}

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseCsvLines(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const splitRow = (line) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const firstCells = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const hasHeader =
    firstCells.includes('employeeid') ||
    firstCells.includes('hourslogged') ||
    firstCells.includes('hours') ||
    firstCells.includes('date');

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const colIdx = hasHeader
    ? {
        employeeId: firstCells.findIndex((h) => h === 'employeeid' || h === 'employee'),
        date: firstCells.findIndex((h) => h === 'date' || h === 'shiftdate'),
        hoursLogged: firstCells.findIndex((h) => h === 'hourslogged' || h === 'hours'),
        notes: firstCells.findIndex((h) => h === 'notes' || h === 'memo' || h === 'description'),
      }
    : { employeeId: 0, date: 1, hoursLogged: 2, notes: 3 };

  return dataLines.map((line) => {
    const cells = splitRow(line);
    return {
      employeeId: cells[colIdx.employeeId >= 0 ? colIdx.employeeId : 0] || '',
      date: cells[colIdx.date >= 0 ? colIdx.date : 1] || new Date().toISOString().slice(0, 10),
      hoursLogged: Number(cells[colIdx.hoursLogged >= 0 ? colIdx.hoursLogged : 2]),
      notes: cells[colIdx.notes >= 0 ? colIdx.notes : 3] || 'Imported via CSV',
    };
  });
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function createApp({ dbPath, adminToken, env = process.env } = {}) {
  const dataDir = dbPath
    ? path.dirname(dbPath)
    : env.DATA_DIR || path.join(SWELDOSYNC_ROOT, 'data');
  const resolvedDbPath = dbPath || path.join(dataDir, 'sweldosync.sqlite');
  const configuredAdminToken =
    adminToken !== undefined ? adminToken : env.ADMIN_TOKEN ? String(env.ADMIN_TOKEN).trim() : '';

  const db = await createDatabase(resolvedDbPath);
  const demoTreasury = resolveDemoTreasuryKeypair(dataDir, env);

  const app = express();
  app.disable('x-powered-by');

  const closeDb = async () => {
    await db.close();
  };
  app.locals.close = closeDb;
  app.close = closeDb;

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // Locked CORS origin
  const allowedOrigin = env.CORS_ORIGIN ? String(env.CORS_ORIGIN).trim() : '';
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (allowedOrigin) {
        const list = allowedOrigin.split(',').map((s) => s.trim());
        if (list.includes(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
      } else if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  });

  app.use(express.json({ limit: '512kb' }));

  const fundLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
  const demoSignLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

  function requireMainnetAdmin(req, res, network) {
    if (network === 'mainnet') {
      if (!configuredAdminToken || !checkBearerToken(req, configuredAdminToken)) {
        res.status(403).json({
          ok: false,
          error: 'Mainnet operations require ADMIN_TOKEN configuration and valid Bearer authorization.',
        });
        return false;
      }
    }
    return true;
  }

  function requireAdminIfConfigured(req, res, next) {
    if (configuredAdminToken && !checkBearerToken(req, configuredAdminToken)) {
      return res.status(403).json({
        ok: false,
        error: 'Valid Authorization Bearer token is required.',
      });
    }
    return next();
  }

  function computeTimesheetsWithGuardrails() {
    const policy = db.getPolicy();
    const employees = db.listEmployees({ includeInactive: true });
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const timesheets = db.listTimesheets();
    const treasuryPublicKey = demoTreasury.publicKey();

    return timesheets.map((ts) => {
      const employee = empMap.get(ts.employeeId);
      const guardrail = evaluateGuardrails({
        log: ts,
        employee,
        existingLogs: timesheets,
        policy,
        treasuryPublicKey,
      });
      return {
        ...ts,
        employeeName: employee?.name || 'Unknown',
        settlementAsset: employee?.settlementAsset || 'USDC',
        rateCurrency: employee?.currency || 'USD',
        guardrail,
      };
    });
  }

  // Healthcheck
  app.get('/healthz', (req, res) => {
    res.status(200).json({
      ok: true,
      service: 'sweldosync',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  // Bootstrap state
  app.get('/api/bootstrap', async (req, res, next) => {
    try {
      const network = req.query.network === 'mainnet' ? 'mainnet' : 'testnet';
      const policy = db.getPolicy();
      const employees = db.listEmployees({ includeInactive: true });
      const timesheets = computeTimesheetsWithGuardrails();
      const payRuns = db.listPayRuns();
      const overrideAuditLog = db.listOverrideAuditLog();

      const targetPublicKey =
        network === 'testnet'
          ? String(req.query.treasuryPublicKey || demoTreasury.publicKey())
          : req.query.treasuryPublicKey
          ? String(req.query.treasuryPublicKey)
          : null;

      const [treasury, fx] = await Promise.all([
        getTreasuryStatus({ publicKey: targetPublicKey, network }),
        getFxQuote(),
      ]);

      const isRender = env.RENDER === 'true';
      const storageNotice = isRender
        ? 'Render free-tier storage is ephemeral: SQLite records and the Testnet Demo Treasury reset on deploy or restart. Export a JSON backup anytime.'
        : `SQLite persisted locally (${path.basename(resolvedDbPath)}). Export JSON backups anytime from Treasury & Settings.`;

      res.json({
        ok: true,
        network,
        networks: NETWORKS_CONFIG,
        contracts: CONTRACT_IDS,
        adminTokenRequired: Boolean(configuredAdminToken),
        mainnetUnlocked: Boolean(configuredAdminToken),
        demoTreasuryPublicKey: demoTreasury.publicKey(),
        storageNotice,
        treasury,
        fx,
        policy,
        employees,
        timesheets,
        payRuns,
        overrideAuditLog,
      });
    } catch (err) {
      next(err);
    }
  });

  // Employees CRUD
  app.post('/api/employees', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const walletAddress = String(body.walletAddress || '').trim();
      if (!name) {
        return res.status(400).json({ ok: false, error: 'Employee name is required.' });
      }
      if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
        return res.status(400).json({ ok: false, error: 'Invalid Stellar Ed25519 public key.' });
      }
      const rateStroops = toStroops(body.hourlyRate ?? '0');
      if (rateStroops <= 0n) {
        return res.status(400).json({ ok: false, error: 'Hourly rate must be greater than 0.' });
      }
      const currency = ['USD', 'USDC', 'XLM'].includes(String(body.currency || '').toUpperCase())
        ? String(body.currency).toUpperCase()
        : 'USD';
      const settlementAsset = ['XLM', 'USDC'].includes(
        String(body.settlementAsset || '').toUpperCase()
      )
        ? String(body.settlementAsset).toUpperCase()
        : 'USDC';

      const employee = await db.createEmployee({
        id: body.id ? String(body.id).trim() : undefined,
        name,
        role: String(body.role || 'Team Member').trim(),
        department: String(body.department || 'Operations').trim(),
        hourlyRate: String(body.hourlyRate),
        currency,
        settlementAsset,
        regularHoursCap: Number(body.regularHoursCap ?? 8),
        overtimeMultiplier: Number(body.overtimeMultiplier ?? 1.25),
        withholdingPct: Number(body.withholdingPct ?? 5),
        maxAutoPayout: String(body.maxAutoPayout ?? '1000.00'),
        walletAddress,
        isActive: body.isActive !== false,
      });
      return res.status(201).json({ ok: true, employee });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/employees/:id', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (body.walletAddress !== undefined) {
        const cleanWallet = String(body.walletAddress).trim();
        if (!StrKey.isValidEd25519PublicKey(cleanWallet)) {
          return res.status(400).json({ ok: false, error: 'Invalid Stellar Ed25519 public key.' });
        }
        body.walletAddress = cleanWallet;
      }
      if (body.hourlyRate !== undefined && toStroops(body.hourlyRate) <= 0n) {
        return res.status(400).json({ ok: false, error: 'Hourly rate must be greater than 0.' });
      }
      const employee = await db.updateEmployee(req.params.id, body);
      if (!employee) {
        return res.status(404).json({ ok: false, error: 'Employee not found.' });
      }
      return res.json({ ok: true, employee });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/employees/:id', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const deleted = await db.deleteEmployee(req.params.id);
      if (!deleted) {
        return res.status(404).json({ ok: false, error: 'Employee not found.' });
      }
      return res.json({ ok: true, deletedId: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  // Timesheets CRUD + CSV + Scenarios
  app.post('/api/timesheets', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const body = req.body || {};
      const employeeId = String(body.employeeId || '').trim();
      const employee = db.getEmployee(employeeId);
      if (!employee) {
        return res.status(400).json({ ok: false, error: `Unknown employeeId: ${employeeId}` });
      }
      const hours = Number(body.hoursLogged);
      if (!Number.isFinite(hours)) {
        return res.status(400).json({ ok: false, error: 'hoursLogged must be a valid number.' });
      }
      const ts = await db.createTimesheet({
        employeeId,
        date: String(body.date || new Date().toISOString().slice(0, 10)),
        hoursLogged: hours,
        notes: String(body.notes || ''),
        status: 'PENDING',
      });
      const existingLogs = db.listTimesheets();
      const guardrail = evaluateGuardrails({
        log: ts,
        employee,
        existingLogs,
        policy: db.getPolicy(),
        treasuryPublicKey: demoTreasury.publicKey(),
      });
      return res.status(201).json({ ok: true, timesheet: { ...ts, guardrail } });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/timesheets/import-csv', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const rows = Array.isArray(req.body?.rows)
        ? req.body.rows
        : parseCsvLines(req.body?.csv || '');
      if (rows.length === 0) {
        return res.status(400).json({ ok: false, error: 'No valid CSV rows provided.' });
      }

      const validItems = [];
      for (const row of rows) {
        const emp = db.getEmployee(String(row.employeeId || '').trim());
        if (!emp) {
          return res.status(400).json({
            ok: false,
            error: `CSV references unknown employeeId: ${row.employeeId}`,
          });
        }
        if (!Number.isFinite(Number(row.hoursLogged))) {
          return res.status(400).json({
            ok: false,
            error: `Invalid hoursLogged value for ${row.employeeId}`,
          });
        }
        validItems.push({
          employeeId: emp.id,
          date: String(row.date || new Date().toISOString().slice(0, 10)),
          hoursLogged: Number(row.hoursLogged),
          notes: String(row.notes || 'Imported CSV shift'),
          status: 'PENDING',
        });
      }

      const created = await db.createTimesheetsBulk(validItems);
      return res.status(201).json({
        ok: true,
        importedCount: created.length,
        timesheets: created,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/timesheets/load-scenario', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const scenario = String(req.body?.scenario || 'compliant_cutoff');
      const activeEmployees = db.listEmployees({ includeInactive: false });
      if (activeEmployees.length === 0) {
        return res.status(400).json({ ok: false, error: 'No active employees available.' });
      }

      const today = new Date().toISOString().slice(0, 10);
      const e = (idx) => activeEmployees[idx % activeEmployees.length].id;
      let items = [];

      if (scenario === 'overtime_sprint') {
        items = [
          { employeeId: e(0), date: today, hoursLogged: 10.5, notes: 'Release candidate hotfix + 2.5h OT' },
          { employeeId: e(1), date: today, hoursLogged: 11, notes: 'Mainnet preflight UI verification + 3h OT' },
          { employeeId: e(2), date: today, hoursLogged: 9.5, notes: 'Node telemetry calibration + 1.5h OT' },
          { employeeId: e(3), date: today, hoursLogged: 8, notes: 'Compliance signoff shift' },
        ];
      } else if (scenario === 'anomaly_stress') {
        items = [
          { employeeId: e(0), date: today, hoursLogged: 8, notes: 'Baseline compliant shift' },
          { employeeId: e(0), date: today, hoursLogged: 6, notes: 'Duplicate date test entry' },
          { employeeId: e(1), date: today, hoursLogged: 18.5, notes: 'Excessive shift >16h guardrail' },
          { employeeId: e(2), date: today, hoursLogged: 0, notes: 'Zero-hour invalid submission' },
        ];
      } else {
        items = activeEmployees.slice(0, 4).map((emp) => ({
          employeeId: emp.id,
          date: today,
          hoursLogged: 8,
          notes: 'Standard cutoff 8h shift',
        }));
      }

      const created = await db.createTimesheetsBulk(items);
      return res.status(201).json({
        ok: true,
        scenario,
        createdCount: created.length,
        timesheets: created,
      });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/timesheets/:id', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const body = req.body || {};
      const existing = db.getTimesheet(req.params.id);
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'Timesheet not found.' });
      }

      let auditEntry = null;
      const updates = { ...body };
      if (body.action === 'APPROVE_OVERRIDE' || body.overrideReason) {
        const reason = String(body.reason || body.overrideReason || '').trim();
        if (!reason) {
          return res.status(400).json({
            ok: false,
            error: 'An override reason is required to approve a guardrail exception.',
          });
        }
        const employee = db.getEmployee(existing.employeeId);
        const guardrail = evaluateGuardrails({
          log: existing,
          employee,
          existingLogs: db.listTimesheets(),
          policy: db.getPolicy(),
          treasuryPublicKey: demoTreasury.publicKey(),
        });
        if (guardrail.status === 'BLOCKED') {
          return res.status(400).json({
            ok: false,
            error: 'Hard-blocked timesheets (invalid hours, wallet, or self-payment) cannot be overridden.',
          });
        }
        updates.overrideReason = reason;
        updates.overrideActor = String(body.actor || 'payroll-operator');
        updates.overrideAt = new Date().toISOString();
        updates.status = 'PENDING';
        auditEntry = {
          action: 'OVERRIDE_APPROVED',
          actor: updates.overrideActor,
          reason,
          flags: guardrail.flags,
        };
      }

      const timesheet = await db.updateTimesheet(req.params.id, updates, auditEntry);
      return res.json({ ok: true, timesheet });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/timesheets/:id', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const deleted = await db.deleteTimesheet(req.params.id);
      if (!deleted) {
        return res.status(404).json({ ok: false, error: 'Timesheet not found.' });
      }
      return res.json({ ok: true, deletedId: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  // Policy update
  app.patch('/api/policy', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const policy = await db.updatePolicy(req.body || {});
      return res.json({ ok: true, policy });
    } catch (err) {
      next(err);
    }
  });

  // Testnet Friendbot funding
  app.post('/api/demo/fund', fundLimiter, async (req, res, next) => {
    try {
      if (req.body?.network === 'mainnet') {
        return res.status(403).json({ ok: false, error: 'Friendbot is Testnet only.' });
      }
      const targetKey = String(req.body?.publicKey || demoTreasury.publicKey()).trim();
      const result = await fundTestnetAccount(targetKey);
      return res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  function buildPayRunPreviewData({ timesheetIds, network, fx, treasuryPublicKey }) {
    const policy = db.getPolicy();
    const employees = db.listEmployees({ includeInactive: true });
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const allLogs = db.listTimesheets();

    const selected = Array.isArray(timesheetIds) && timesheetIds.length > 0
      ? allLogs.filter((t) => timesheetIds.includes(t.id))
      : allLogs.filter((t) => t.status === 'PENDING');

    const items = [];
    let totalGrossUsdStroops = 0n;
    let totalWithholdingUsdStroops = 0n;
    let totalNetUsdStroops = 0n;
    let totalXlmStroops = 0n;
    let totalUsdcStroops = 0n;
    let hasBlocked = false;
    let hasUnapprovedFlags = false;

    for (const ts of selected) {
      const employee = empMap.get(ts.employeeId);
      const guardrail = evaluateGuardrails({
        log: ts,
        employee,
        existingLogs: allLogs,
        policy,
        treasuryPublicKey,
      });

      if (guardrail.status === 'BLOCKED') hasBlocked = true;
      if (guardrail.status === 'FLAGGED' && !ts.overrideReason) hasUnapprovedFlags = true;

      const calc =
        guardrail.calculation ||
        calculateTimesheetPay({
          hoursLogged: 0,
          hourlyRate: '0',
        });

      const rateCurrency = employee?.currency || 'USD';
      const settlementAsset = employee?.settlementAsset || 'USDC';

      const settlementStroops = convertStroopsBetweenAssets(
        calc.netStroops,
        rateCurrency,
        settlementAsset,
        fx.usdPerXlm
      );

      const grossUsdStroops = convertStroopsBetweenAssets(
        calc.grossStroops,
        rateCurrency,
        'USD',
        fx.usdPerXlm
      );
      const whUsdStroops = convertStroopsBetweenAssets(
        calc.withholdingStroops,
        rateCurrency,
        'USD',
        fx.usdPerXlm
      );
      const netUsdStroops = convertStroopsBetweenAssets(
        calc.netStroops,
        rateCurrency,
        'USD',
        fx.usdPerXlm
      );

      totalGrossUsdStroops += grossUsdStroops;
      totalWithholdingUsdStroops += whUsdStroops;
      totalNetUsdStroops += netUsdStroops;
      if (settlementAsset === 'XLM') {
        totalXlmStroops += settlementStroops;
      } else {
        totalUsdcStroops += settlementStroops;
      }

      items.push({
        timesheetId: ts.id,
        employeeId: employee?.id || ts.employeeId,
        employeeName: employee?.name || 'Unknown',
        walletAddress: employee?.walletAddress || '',
        date: ts.date,
        hoursLogged: ts.hoursLogged,
        regularHours: calc.regularHours,
        overtimeHours: calc.overtimeHours,
        hourlyRate: String(employee?.hourlyRate || '0'),
        overtimeMultiplier: Number(
          employee?.overtimeMultiplier ??
            policy.overtimeMultiplier ??
            PAYROLL_CONFIG.OVERTIME_MULTIPLIER
        ),
        withholdingPct: Number(
          employee?.withholdingPct ??
            policy.defaultWithholdingPct ??
            PAYROLL_CONFIG.DEFAULT_WITHHOLDING_PCT
        ),
        currency: rateCurrency,
        rateCurrency,
        settlementAsset,
        regularAmount: calc.regularAmount,
        overtimeAmount: calc.overtimeAmount,
        grossAmount: calc.grossAmount,
        withholdingAmount: calc.withholdingAmount,
        netAmount: calc.netAmount,
        settlementAmount: fromStroopsToString(settlementStroops),
        overrideReason: ts.overrideReason || null,
        guardrail,
      });
    }

    const xlmItems = items.filter((i) => i.settlementAsset === 'XLM');
    const usdcItems = items.filter((i) => i.settlementAsset === 'USDC');
    const groupedChunks = [
      ...chunkArray(usdcItems, PAYROLL_CONFIG.MAX_OPS_PER_CHUNK).map((group) => ({
        assetCode: 'USDC',
        items: group,
      })),
      ...chunkArray(xlmItems, PAYROLL_CONFIG.MAX_OPS_PER_CHUNK).map((group) => ({
        assetCode: 'XLM',
        items: group,
      })),
    ].map((ch, chunkIndex) => ({
      chunkIndex,
      assetCode: ch.assetCode,
      opCount: ch.items.length,
      items: ch.items,
    }));

    return {
      network,
      fx,
      items,
      chunks: groupedChunks,
      hasBlocked,
      hasUnapprovedFlags,
      totals: {
        recipientCount: items.length,
        totalGrossUsd: fromStroopsToString(totalGrossUsdStroops),
        totalWithholdingUsd: fromStroopsToString(totalWithholdingUsdStroops),
        totalNetUsd: fromStroopsToString(totalNetUsdStroops),
        totalSettlementXlm: fromStroopsToString(totalXlmStroops),
        totalSettlementUsdc: fromStroopsToString(totalUsdcStroops),
      },
    };
  }

  // Pay Run Preview
  app.post('/api/payruns/preview', async (req, res, next) => {
    try {
      const network = req.body?.network === 'mainnet' ? 'mainnet' : 'testnet';
      const fx = await getFxQuote({ forceRefresh: Boolean(req.body?.refreshFx) });
      const treasuryPublicKey = req.body?.treasuryPublicKey || demoTreasury.publicKey();
      const preview = buildPayRunPreviewData({
        timesheetIds: req.body?.timesheetIds,
        network,
        fx,
        treasuryPublicKey,
      });
      return res.json({ ok: true, ...preview });
    } catch (err) {
      next(err);
    }
  });

  // Create Pay Run (persists DRAFT + chunk manifests + salted MemoHashes)
  app.post('/api/payruns', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const network = req.body?.network === 'mainnet' ? 'mainnet' : 'testnet';
      if (!requireMainnetAdmin(req, res, network)) return;

      const timesheetIds = req.body?.timesheetIds;
      if (!Array.isArray(timesheetIds) || timesheetIds.length === 0) {
        return res.status(400).json({ ok: false, error: 'At least one timesheetId is required.' });
      }

      let fx = await getFxQuote({ forceRefresh: network === 'mainnet' });
      if (network === 'mainnet' && isFxQuoteStale(fx.timestamp)) {
        fx = await getFxQuote({ forceRefresh: true });
        if (isFxQuoteStale(fx.timestamp)) {
          return res.status(400).json({
            ok: false,
            error: 'Live XLM/USD FX quote is stale or unavailable for Mainnet settlement.',
          });
        }
      }

      const treasuryPublicKey = req.body?.treasuryPublicKey || demoTreasury.publicKey();
      const preview = buildPayRunPreviewData({
        timesheetIds,
        network,
        fx,
        treasuryPublicKey,
      });

      if (preview.items.length === 0) {
        return res.status(400).json({ ok: false, error: 'No matching timesheets found.' });
      }
      if (preview.hasBlocked) {
        return res.status(400).json({
          ok: false,
          error: 'Pay run contains BLOCKED timesheets (invalid hours, invalid wallet, or self-payment).',
        });
      }
      if (preview.hasUnapprovedFlags && !req.body?.overrideReason) {
        return res.status(400).json({
          ok: false,
          error: 'Flagged shifts must be overridden with a reason or excluded before creating pay run.',
        });
      }

      const now = new Date().toISOString();
      const payRunId = `RUN-${now.slice(0, 10).replace(/-/g, '')}-${crypto
        .randomBytes(2)
        .toString('hex')
        .toUpperCase()}`;
      const saltHex = crypto.randomBytes(16).toString('hex');
      const cfg = getNetworkConfig(network);

      const payRunItems = [];
      const payRunChunks = [];

      for (const ch of preview.chunks) {
        const chunkItems = ch.items.map((it, idx) => {
          const itemRecord = {
            id: `ITEM-${payRunId}-C${ch.chunkIndex}-${idx + 1}`,
            payRunId,
            timesheetId: it.timesheetId,
            employeeId: it.employeeId,
            employeeName: it.employeeName,
            walletAddress: it.walletAddress,
            currency: it.currency || it.rateCurrency,
            rateCurrency: it.rateCurrency,
            settlementAsset: it.settlementAsset,
            hoursLogged: it.hoursLogged,
            regularHours: it.regularHours,
            overtimeHours: it.overtimeHours,
            hourlyRate: it.hourlyRate,
            overtimeMultiplier: it.overtimeMultiplier,
            withholdingPct: it.withholdingPct,
            regularAmount: it.regularAmount,
            overtimeAmount: it.overtimeAmount,
            grossAmount: it.grossAmount,
            withholdingAmount: it.withholdingAmount,
            netAmount: it.netAmount,
            settlementAmount: it.settlementAmount,
            routingKind: null,
            chunkIndex: ch.chunkIndex,
            txHash: null,
            explorerUrl: null,
            status: 'PENDING',
          };
          payRunItems.push(itemRecord);
          return itemRecord;
        });

        const manifest = {
          payRunId,
          network,
          assetCode: ch.assetCode,
          saltHex,
          chunkIndex: ch.chunkIndex,
          items: chunkItems.map((it) => ({
            employeeId: it.employeeId,
            walletAddress: it.walletAddress,
            netAmount: it.settlementAmount,
          })),
        };
        const { canonicalJson, sha256Hex } = computePayRunMemoHash(manifest);

        payRunChunks.push({
          id: `${payRunId}-C${ch.chunkIndex}`,
          payRunId,
          chunkIndex: ch.chunkIndex,
          assetCode: ch.assetCode,
          assetIssuer: ch.assetCode === 'USDC' ? cfg.usdcIssuer : null,
          network,
          networkPassphrase: cfg.networkPassphrase,
          sourceAccount: null,
          sequenceNumber: null,
          unsignedXdr: null,
          signedXdr: null,
          txHash: null,
          memoHashHex: sha256Hex,
          manifestJson: canonicalJson,
          opCount: chunkItems.length,
          routingSummary: {},
          status: 'PENDING',
          ledger: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          submittedAt: null,
        });
      }

      const payRun = await db.createPayRun({
        payRun: {
          id: payRunId,
          periodLabel: String(req.body?.periodLabel || `Pay Run ${now.slice(0, 10)}`),
          network,
          status: 'DRAFT',
          saltHex,
          fxRateUsdPerXlm: fx.usdPerXlm,
          fxSource: fx.source,
          fxTimestamp: fx.timestamp,
          totalGrossUsd: preview.totals.totalGrossUsd,
          totalWithholdingUsd: preview.totals.totalWithholdingUsd,
          totalNetUsd: preview.totals.totalNetUsd,
          totalSettlementXlm: preview.totals.totalSettlementXlm,
          totalSettlementUsdc: preview.totals.totalSettlementUsdc,
          recipientCount: payRunItems.length,
          isSimulatedSeed: false,
          createdAt: now,
          settledAt: null,
        },
        items: payRunItems,
        chunks: payRunChunks,
      });

      return res.status(201).json({ ok: true, payRun });
    } catch (err) {
      next(err);
    }
  });

  // Build unsigned XDR for a Pay Run Chunk
  app.post(
    '/api/payruns/:id/chunks/:chunkIndex/build-xdr',
    requireAdminIfConfigured,
    async (req, res, next) => {
      try {
        const payRun = db.getPayRun(req.params.id);
        const requestedNetwork = req.body?.network === 'mainnet' ? 'mainnet' : payRun?.network || 'testnet';
        if (!requireMainnetAdmin(req, res, requestedNetwork)) return;

        if (!payRun) {
          return res.status(404).json({ ok: false, error: 'Pay run not found.' });
        }
        if (payRun.network === 'mainnet' && !requireMainnetAdmin(req, res, 'mainnet')) return;

        const chunkIdx = Number(req.params.chunkIndex);
        const chunk = db.getPayRunChunk(payRun.id, chunkIdx);
        if (!chunk) {
          return res.status(404).json({ ok: false, error: 'Pay run chunk not found.' });
        }
        if (chunk.status === 'SETTLED') {
          return res.status(409).json({ ok: false, error: 'Chunk is already settled on-chain.' });
        }

        const treasuryAddress =
          payRun.network === 'mainnet'
            ? String(req.body?.treasuryAddress || '').trim()
            : String(req.body?.treasuryAddress || demoTreasury.publicKey()).trim();

        const chunkItems = payRun.items.filter((i) => i.chunkIndex === chunkIdx);
        const built = await buildChunkTransaction({
          network: payRun.network,
          treasuryAddress,
          chunkItems,
          memoHashHex: chunk.memoHashHex,
          assetCode: chunk.assetCode,
          assetIssuer: chunk.assetIssuer,
        });

        const updatedRun = await db.updatePayRunChunkAndItems(
          payRun.id,
          chunkIdx,
          {
            sourceAccount: treasuryAddress,
            sequenceNumber: built.sequenceNumber,
            unsignedXdr: built.unsignedXdr,
            txHash: built.txHash,
            opCount: built.opCount,
            routingSummary: built.routingSummary,
            status: 'BUILT',
            errorMessage: null,
          },
          built.itemRoutings.map((r) => ({
            id: r.id,
            routingKind: r.routingKind,
          }))
        );

        const updatedChunk = updatedRun.chunks.find((c) => c.chunkIndex === chunkIdx);
        return res.json({
          ok: true,
          payRun: updatedRun,
          chunk: updatedChunk,
          unsignedXdr: built.unsignedXdr,
          txHash: built.txHash,
          memoHashHex: chunk.memoHashHex,
          networkPassphrase: built.networkPassphrase,
          routingSummary: built.routingSummary,
          preflight: built.preflight,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Testnet-only 1-Click Demo Treasury Sign & Settle
  app.post(
    '/api/payruns/:id/chunks/:chunkIndex/demo-sign',
    demoSignLimiter,
    requireAdminIfConfigured,
    async (req, res, next) => {
      try {
        if (req.body?.network === 'mainnet') {
          return res.status(403).json({ ok: false, error: 'Demo signer forbidden on Mainnet.' });
        }

        const payRun = db.getPayRun(req.params.id);
        if (!payRun) {
          return res.status(404).json({ ok: false, error: 'Pay run not found.' });
        }
        if (payRun.network === 'mainnet') {
          return res.status(403).json({ ok: false, error: 'Demo signer forbidden on Mainnet.' });
        }

        const chunkIdx = Number(req.params.chunkIndex);
        let chunk = db.getPayRunChunk(payRun.id, chunkIdx);
        if (!chunk) {
          return res.status(404).json({ ok: false, error: 'Pay run chunk not found.' });
        }
        if (chunk.status === 'SETTLED') {
          return res.json({
            ok: true,
            payRun,
            chunk,
            txHash: chunk.txHash,
            ledger: chunk.ledger,
            explorerUrl: formatExplorerTxUrl(chunk.txHash, payRun.network),
          });
        }

        const demoPub = demoTreasury.publicKey();
        const chunkItems = payRun.items.filter((i) => i.chunkIndex === chunkIdx);
        if (!chunk.unsignedXdr || chunk.sourceAccount !== demoPub) {
          const built = await buildChunkTransaction({
            network: 'testnet',
            treasuryAddress: demoPub,
            chunkItems,
            memoHashHex: chunk.memoHashHex,
            assetCode: chunk.assetCode,
            assetIssuer: chunk.assetIssuer,
          });
          const rebuiltRun = await db.updatePayRunChunkAndItems(
            payRun.id,
            chunkIdx,
            {
              sourceAccount: demoPub,
              sequenceNumber: built.sequenceNumber,
              unsignedXdr: built.unsignedXdr,
              txHash: built.txHash,
              opCount: built.opCount,
              routingSummary: built.routingSummary,
              status: 'BUILT',
              errorMessage: null,
            },
            built.itemRoutings.map((r) => ({ id: r.id, routingKind: r.routingKind }))
          );
          chunk = rebuiltRun.chunks.find((c) => c.chunkIndex === chunkIdx);
        }

        assertDemoSignAllowed(chunk.unsignedXdr, {
          network: payRun.network,
          networkPassphrase: chunk.networkPassphrase,
          expectedTestnetHash: chunk.txHash,
        });

        const tx = TransactionBuilder.fromXDR(chunk.unsignedXdr, Networks.TESTNET);
        tx.sign(demoTreasury);
        const signedXdr = tx.toXDR();

        const submitted = await submitSignedChunkXdr({
          network: 'testnet',
          signedXdr,
          expectedTxHash: chunk.txHash,
          expectedSourceAccount: demoPub,
        });

        const settledRun = await db.updatePayRunChunkAndItems(
          payRun.id,
          chunkIdx,
          {
            signedXdr,
            txHash: submitted.txHash,
            ledger: submitted.ledger,
            status: 'SETTLED',
            submittedAt: new Date().toISOString(),
            errorMessage: null,
          },
          chunkItems.map((it) => ({
            id: it.id,
            timesheetId: it.timesheetId,
            txHash: submitted.txHash,
            explorerUrl: submitted.explorerUrl,
            status: 'SETTLED',
          }))
        );

        const settledChunk = settledRun.chunks.find((c) => c.chunkIndex === chunkIdx);
        return res.json({
          ok: true,
          payRun: settledRun,
          chunk: settledChunk,
          txHash: submitted.txHash,
          ledger: submitted.ledger,
          explorerUrl: submitted.explorerUrl,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Freighter-signed XDR
  app.post(
    '/api/payruns/:id/chunks/:chunkIndex/submit-signed',
    requireAdminIfConfigured,
    async (req, res, next) => {
      try {
        const payRun = db.getPayRun(req.params.id);
        const requestedNetwork = req.body?.network === 'mainnet' ? 'mainnet' : payRun?.network || 'testnet';
        if (!requireMainnetAdmin(req, res, requestedNetwork)) return;

        if (!payRun) {
          return res.status(404).json({ ok: false, error: 'Pay run not found.' });
        }
        if (payRun.network === 'mainnet' && !requireMainnetAdmin(req, res, 'mainnet')) return;

        const chunkIdx = Number(req.params.chunkIndex);
        const chunk = db.getPayRunChunk(payRun.id, chunkIdx);
        if (!chunk) {
          return res.status(404).json({ ok: false, error: 'Pay run chunk not found.' });
        }
        if (chunk.status === 'SETTLED') {
          return res.json({
            ok: true,
            payRun,
            chunk,
            txHash: chunk.txHash,
            ledger: chunk.ledger,
            explorerUrl: formatExplorerTxUrl(chunk.txHash, payRun.network),
          });
        }

        const signedXdr = req.body?.signedXdr;
        const submitted = await submitSignedChunkXdr({
          network: payRun.network,
          signedXdr,
          expectedTxHash: chunk.txHash,
          expectedSourceAccount: chunk.sourceAccount,
        });

        const chunkItems = payRun.items.filter((i) => i.chunkIndex === chunkIdx);
        const settledRun = await db.updatePayRunChunkAndItems(
          payRun.id,
          chunkIdx,
          {
            signedXdr,
            txHash: submitted.txHash,
            ledger: submitted.ledger,
            status: 'SETTLED',
            submittedAt: new Date().toISOString(),
            errorMessage: null,
          },
          chunkItems.map((it) => ({
            id: it.id,
            timesheetId: it.timesheetId,
            txHash: submitted.txHash,
            explorerUrl: submitted.explorerUrl,
            status: 'SETTLED',
          }))
        );

        const settledChunk = settledRun.chunks.find((c) => c.chunkIndex === chunkIdx);
        return res.json({
          ok: true,
          payRun: settledRun,
          chunk: settledChunk,
          txHash: submitted.txHash,
          ledger: submitted.ledger,
          explorerUrl: submitted.explorerUrl,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cryptographic MemoHash Verifier (RFC-8785 + optional live Horizon memo verification)
  app.post('/api/verify-memo', async (req, res, next) => {
    try {
      const body = req.body || {};
      let manifest = body.manifest;
      let expectedHashHex = body.expectedHash || '';
      let txHash = body.txHash || null;
      let network = body.network === 'mainnet' ? 'mainnet' : 'testnet';

      if (body.payRunId) {
        const payRun = db.getPayRun(String(body.payRunId));
        if (!payRun) {
          return res.status(404).json({ ok: false, error: 'Pay run not found.' });
        }
        const chunkIdx = Number(body.chunkIndex || 0);
        const chunk = payRun.chunks.find((c) => c.chunkIndex === chunkIdx);
        if (!chunk) {
          return res.status(404).json({ ok: false, error: 'Pay run chunk not found.' });
        }
        manifest = manifest || JSON.parse(chunk.manifestJson);
        expectedHashHex = expectedHashHex || chunk.memoHashHex;
        txHash = txHash || chunk.txHash;
        network = payRun.network;
      }

      if (!manifest || typeof manifest !== 'object') {
        return res.status(400).json({ ok: false, error: 'Manifest object or payRunId is required.' });
      }

      const { canonicalJson, sha256Hex } = computePayRunMemoHash(manifest);
      const verified = expectedHashHex
        ? verifyPayRunMemoHash(manifest, expectedHashHex)
        : true;

      let horizonVerified = null;
      let horizonMemoHex = null;
      if (txHash && /^[0-9a-f]{64}$/i.test(txHash)) {
        try {
          const server = getHorizonServer(network);
          const txRecord = await server.transactions().transaction(txHash).call();
          if (txRecord?.memo_type === 'hash' && txRecord?.memo) {
            horizonMemoHex = Buffer.from(txRecord.memo, 'base64').toString('hex');
            horizonVerified = horizonMemoHex === sha256Hex;
          } else {
            horizonVerified = false;
          }
        } catch {
          horizonVerified = null;
        }
      }

      return res.json({
        ok: true,
        verified,
        computedHashHex: sha256Hex,
        expectedHashHex: expectedHashHex || sha256Hex,
        canonicalJson,
        horizonVerified,
        horizonMemoHex,
        onChainMemoHex: horizonMemoHex,
      });
    } catch (err) {
      next(err);
    }
  });

  // Export Pay Run CSV
  app.get('/api/payruns/:id/export.csv', (req, res) => {
    const payRun = db.getPayRun(req.params.id);
    if (!payRun) {
      return res.status(404).json({ ok: false, error: 'Pay run not found.' });
    }
    const headers = [
      'PayRunID',
      'Period',
      'Network',
      'EmployeeID',
      'EmployeeName',
      'WalletAddress',
      'HoursLogged',
      'RegularHours',
      'OvertimeHours',
      'HourlyRate',
      'RateCurrency',
      'GrossAmount',
      'WithholdingAmount',
      'NetAmount',
      'SettlementAsset',
      'SettlementAmount',
      'RoutingKind',
      'TxHash',
      'ExplorerURL',
      'Status',
    ];
    const lines = [headers.join(',')];
    for (const item of payRun.items) {
      lines.push(
        [
          payRun.id,
          payRun.periodLabel,
          payRun.network,
          item.employeeId,
          item.employeeName,
          item.walletAddress,
          item.hoursLogged,
          item.regularHours,
          item.overtimeHours,
          item.hourlyRate,
          item.rateCurrency,
          item.grossAmount,
          item.withholdingAmount,
          item.netAmount,
          item.settlementAsset,
          item.settlementAmount,
          item.routingKind || '',
          item.txHash || '',
          item.explorerUrl || '',
          item.status,
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sweldosync-${payRun.id}.csv"`);
    return res.send(lines.join('\n'));
  });

  // Workspace Backup / Restore (zero secrets guaranteed)
  app.get('/api/workspace/export', requireAdminIfConfigured, (req, res) => {
    const data = db.exportWorkspace();
    return res.json(data);
  });

  app.post('/api/workspace/import', requireAdminIfConfigured, async (req, res, next) => {
    try {
      const imported = await db.importWorkspace(req.body);
      return res.json({ ok: true, workspace: imported });
    } catch (err) {
      next(err);
    }
  });

  // Serve built React SPA from apps/web/dist (with SPA fallback)
  const webDistDir = path.join(SWELDOSYNC_ROOT, 'apps', 'web', 'dist');
  const distIndexPath = path.join(webDistDir, 'index.html');
  if (fs.existsSync(distIndexPath)) {
    app.use(express.static(webDistDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/healthz') {
        return next();
      }
      return res.sendFile(distIndexPath);
    });
  }

  // Unified error handler
  app.use((err, req, res, _next) => {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    const message = err?.message || 'Internal server error';
    res.status(status).json({
      ok: false,
      error: message,
      ...(err?.resultCodes ? { resultCodes: err.resultCodes } : {}),
    });
  });

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 3001);
  if (process.env.STELLAR_NETWORK === 'mainnet' && !process.env.ADMIN_TOKEN) {
    console.error('[FATAL] Refusing to start in Mainnet mode without ADMIN_TOKEN configured.');
    process.exit(1);
  }
  const app = await createApp();
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[START] SweldoSync 2.0 Server listening on http://0.0.0.0:${port}`);
  });
  const shutdown = async () => {
    server.close(async () => {
      await app.locals.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
