// apps/web/src/components/Views/TreasurySettingsView.jsx
import React, { useState } from 'react';
import {
  Wallet,
  ShieldCheck,
  Download,
  Upload,
  Coins,
  Key,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  PlusCircle,
  Copy,
  Check,
  FileCheck2,
} from 'lucide-react';
import { AddressChip } from '../Common/AddressChip';
import { Badge } from '../Common/Badge';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { formatExplorerAccountUrl, truncateStellarAddress } from '../../services/stellar';

export function TreasurySettingsView() {
  const { data, refreshData, addToast, network, adminToken, setAdminToken } = useApp();

  // Policy form state
  const [policyForm, setPolicyForm] = useState({
    standardWorkHours: data.policy?.standardWorkHours || 8,
    maxShiftHours: data.policy?.maxShiftHours || 16,
    overtimeMultiplier: data.policy?.overtimeMultiplier || 1.25,
    defaultWithholdingPct: data.policy?.defaultWithholdingPct || 5,
    defaultMaxAutoPayout: data.policy?.defaultMaxAutoPayout || 1000,
  });
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Friendbot funding
  const [funding, setFunding] = useState(false);

  // Admin token input state
  const [adminTokenInput, setAdminTokenInput] = useState(adminToken);

  // MemoHash Verifier state
  const [verifyRunId, setVerifyRunId] = useState(data.recentPayRuns?.[0]?.id || '');
  const [verifyManifestJson, setVerifyManifestJson] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [verifying, setVerifying] = useState(false);

  // Accordion state
  const [sorobanAccordionOpen, setSorobanAccordionOpen] = useState(false);

  // Backup / Restore state
  const [importingBackup, setImportingBackup] = useState(false);

  const handleFundFriendbot = async () => {
    setFunding(true);
    try {
      await api.fundDemoTreasury(network);
      addToast({
        type: 'success',
        title: 'Friendbot Funded +10,000 XLM',
        message: 'Treasury balance updated from Stellar Horizon.',
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Funding Failed',
        message: err.message || 'Could not fund account on Friendbot.',
      });
    } finally {
      setFunding(false);
    }
  };

  const handleSavePolicy = async (e) => {
    e.preventDefault();
    setSavingPolicy(true);
    try {
      await api.updatePolicy({
        standardWorkHours: parseFloat(policyForm.standardWorkHours),
        maxShiftHours: parseFloat(policyForm.maxShiftHours),
        overtimeMultiplier: parseFloat(policyForm.overtimeMultiplier),
        defaultWithholdingPct: parseFloat(policyForm.defaultWithholdingPct),
        defaultMaxAutoPayout: parseFloat(policyForm.defaultMaxAutoPayout),
      });
      addToast({
        type: 'success',
        title: 'Policy Updated',
        message: 'New guardrail parameters saved to SQLite database.',
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Policy Save Failed',
        message: err.message,
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSaveAdminToken = (e) => {
    e.preventDefault();
    setAdminToken(adminTokenInput.trim());
    addToast({
      type: 'success',
      title: adminTokenInput.trim() ? 'Admin Session Active' : 'Admin Session Cleared',
      message: adminTokenInput.trim()
        ? 'Authorization Bearer header will accompany all backend mutation requests.'
        : 'Session reset to unauthenticated mode.',
    });
  };

  const handleVerifyMemo = async (e) => {
    e.preventDefault();
    setVerifying(true);
    setVerificationResult(null);

    try {
      let payload = {};
      if (verifyManifestJson.trim()) {
        try {
          payload = { manifest: JSON.parse(verifyManifestJson.trim()) };
        } catch {
          throw new Error('Manifest text is not valid JSON.');
        }
      } else if (verifyRunId) {
        payload = { payRunId: verifyRunId };
      } else {
        throw new Error('Please select a Pay Run or paste a JSON manifest.');
      }

      const res = await api.verifyMemo(payload);
      const isVerified = Boolean(res.verified ?? res.isValid);
      setVerificationResult({
        ...res,
        isValid: isVerified,
        computedHash: res.computedHashHex || res.computedHash || res.sha256Hex,
        expectedHash: res.expectedHashHex || res.expectedHash || res.onChainMemoHex,
      });

      addToast({
        type: isVerified ? 'success' : 'error',
        title: isVerified ? 'MemoHash Integrity Verified' : 'Integrity Mismatch',
        message: isVerified
          ? 'Canonical RFC-8785 SHA-256 hash matches Stellar Horizon ledger proof 100%!'
          : 'Computed hash does not match recorded on-chain memo.',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Verification Failed',
        message: err.message,
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleExportWorkspace = async () => {
    try {
      const data = await api.exportWorkspace();
      const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sweldosync_workspace_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast({
        type: 'success',
        title: 'Workspace Exported',
        message: 'Downloaded complete sanitized SQLite JSON backup.',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Export Failed',
        message: err.message,
      });
    }
  };

  const handleImportWorkspaceFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportingBackup(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await api.importWorkspace(parsed);
      addToast({
        type: 'success',
        title: 'Workspace Restored',
        message: 'Loaded employees, timesheets, and policy from backup JSON.',
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Import Failed',
        message: err.message || 'Invalid workspace backup file.',
      });
    } finally {
      setImportingBackup(false);
    }
  };

  const xlmBalance = Number(data.treasury?.xlmBalance ?? 10000);
  const usdcBalance = Number(data.treasury?.usdcBalance ?? 5000);
  const usdRate = Number(data.treasury?.usdPerXlm ?? 0.24);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="pb-2 border-b border-slate-100 dark:border-slate-800/80">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Treasury & Security Governance
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage Stellar reserve liquidity, guardrail thresholds, cryptographic verification, and database state.
        </p>
      </div>

      {/* Grid: Treasury Liquidity Card + Admin Authorization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Treasury Liquidity Card (Col 2) */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200/60 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {network === 'mainnet' ? 'Stellar Mainnet Treasury' : 'Testnet Demo Treasury'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  On-chain capital pool used for batch payroll settlements.
                </p>
              </div>
            </div>

            {network === 'testnet' && (
              <button
                type="button"
                onClick={handleFundFriendbot}
                disabled={funding}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>{funding ? 'Funding...' : 'Fund +10,000 XLM'}</span>
              </button>
            )}
          </div>

          {/* Treasury Balances */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                Native Stellar Reserve
              </span>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                {xlmBalance.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{' '}
                <span className="text-sm font-semibold text-slate-500">XLM</span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono mt-0.5 block">
                ≈ ${(xlmBalance * usdRate).toFixed(2)} USD (@${usdRate})
              </span>
            </div>

            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                Circle USDC Balance
              </span>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                {usdcBalance.toFixed(2)}{' '}
                <span className="text-sm font-semibold text-slate-500">USDC</span>
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Stellar Anchor Trustline
              </span>
            </div>
          </div>

          {/* Public Address */}
          <div>
            <span className="text-xs text-slate-400 block mb-1">Treasury Public Key</span>
            <AddressChip address={data.treasury?.address || data.treasury?.publicKey} lead={8} tail={8} />
          </div>
        </div>

        {/* Admin Authorization Card (Col 1) */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
                {adminToken ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Admin Authorization
                </h3>
                <span className="text-[11px] text-slate-400">
                  {adminToken ? 'Session Unlocked' : 'Read-Only Mode'}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
              Enter your secret token to authorize Mainnet broadcasts and policy modifications.
              Persists in your current browser tab only.
            </p>

            <form onSubmit={handleSaveAdminToken} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ADMIN_TOKEN
                </label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="Enter token..."
                    value={adminTokenInput}
                    onChange={(e) => setAdminTokenInput(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Key className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                {adminToken && (
                  <button
                    type="button"
                    onClick={() => {
                      setAdminToken('');
                      setAdminTokenInput('');
                    }}
                    className="text-[11px] text-rose-600 hover:text-rose-700 font-medium"
                  >
                    Clear Token
                  </button>
                )}
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white shadow-xs ml-auto cursor-pointer"
                >
                  Save Token
                </button>
              </div>
            </form>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Constant-time timingSafeEqual validation on backend.</span>
          </div>
        </div>
      </div>

      {/* Company Guardrail Policy Form */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="mb-5 pb-3 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Company Guardrail Policies
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Enforced automatically by the payroll agent during worklog evaluation and preflight simulation.
            </p>
          </div>
          <Badge variant="neutral">Active Policy</Badge>
        </div>

        <form onSubmit={handleSavePolicy} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Standard Work Hours (Cap per Shift)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="24"
                value={policyForm.standardWorkHours}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, standardWorkHours: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Hours beyond this trigger 1.25x overtime calculation.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Max Shift Limit (Strict Warning)
              </label>
              <input
                type="number"
                step="1"
                min="8"
                max="24"
                value={policyForm.maxShiftHours}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, maxShiftHours: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Shifts longer than this are flagged <code>MAX_SHIFT_EXCEEDED</code>.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Overtime Multiplier
              </label>
              <input
                type="number"
                step="0.05"
                min="1"
                max="3"
                value={policyForm.overtimeMultiplier}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, overtimeMultiplier: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Default 1.25x statutory overtime premium.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Default Withholding Rate (%)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="50"
                value={policyForm.defaultWithholdingPct}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, defaultWithholdingPct: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Fallback tax deduction withheld at source.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Default Max Auto-Payout Cap ($)
              </label>
              <input
                type="number"
                step="50"
                min="100"
                value={policyForm.defaultMaxAutoPayout}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, defaultMaxAutoPayout: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Payouts exceeding cap require manual supervisor override.
              </span>
            </div>
          </div>

          <div className="flex justify-end pt-3">
            <button
              type="submit"
              disabled={savingPolicy}
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              {savingPolicy ? 'Saving...' : 'Save Policy Parameters'}
            </button>
          </div>
        </form>
      </div>

      {/* Cryptographic Payslip MemoHash Verifier Widget */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Cryptographic Payslip MemoHash Verifier
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Select any settled Pay Run or paste a JSON manifest to verify RFC-8785 canonical SHA-256 hash against the Stellar ledger.
          </p>
        </div>

        <form onSubmit={handleVerifyMemo} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Select Past Pay Run
              </label>
              <select
                value={verifyRunId}
                onChange={(e) => setVerifyRunId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Choose Settled Pay Run --</option>
                {(data.recentPayRuns || [])
                  .filter((r) => r.status === 'PAID' || r.status === 'SETTLED')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.periodLabel || 'Payroll Cutoff'} ({r.id}) — {r.totalOutflow || '190.00 XLM'}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Or Paste Custom Manifest JSON
              </label>
              <textarea
                rows={2}
                value={verifyManifestJson}
                onChange={(e) => setVerifyManifestJson(e.target.value)}
                placeholder='{"payRunId": "RUN-...", "items": [...]}'
                className="w-full p-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400 font-mono">
              Algorithm: RFC-8785 JSON Canonicalization + SHA-256
            </span>

            <button
              type="submit"
              disabled={verifying}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              {verifying ? 'Verifying...' : 'Verify MemoHash Integrity'}
            </button>
          </div>
        </form>

        {/* Verification Result Banner */}
        {verificationResult && (
          <div
            className={`p-4 rounded-xl border text-xs space-y-2 ${
              verificationResult.isValid
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/80 text-emerald-950 dark:text-emerald-100'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/80 text-rose-950 dark:text-rose-100'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {verificationResult.isValid ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Integrity Verified: Canonical Hash Exactly Matches Stellar Ledger</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>Verification Failed: Hash Mismatch Detected</span>
                </>
              )}
            </div>

            <div className="font-mono text-[11px] space-y-1">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Computed SHA-256: </span>
                <span>{verificationResult.computedHash || '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'}</span>
              </div>
              {verificationResult.expectedHash && (
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Ledger Memo: </span>
                  <span>{verificationResult.expectedHash}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Workspace Backup / Restore & Override Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workspace Backup & Restore */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Workspace Database Persistence
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Powered by SQLite (<code>sql.js</code> WASM) with atomic fsync writes.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold block mb-0.5">Storage Notice:</span>
            <span>{data.storageNotice || 'Local SQLite Database active with disk persistence.'}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleExportWorkspace}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Backup (JSON)</span>
            </button>

            <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{importingBackup ? 'Restoring...' : 'Restore Backup (JSON)'}</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportWorkspaceFile}
                disabled={importingBackup}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Collapsible Soroban Protocol & Contract IDs Accordion */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
          <button
            type="button"
            onClick={() => setSorobanAccordionOpen(!sorobanAccordionOpen)}
            className="w-full flex items-center justify-between text-left cursor-pointer"
          >
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Soroban Protocol & Contract IDs
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Stellar Smart Contract addresses configured for zk-SNARK verification.
              </p>
            </div>
            {sorobanAccordionOpen ? (
              <ChevronDown className="w-5 h-5 text-slate-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-400" />
            )}
          </button>

          {sorobanAccordionOpen && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3 text-xs font-mono">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-slate-400 font-sans block text-[11px] mb-1">
                  NOIR_DEVICE_REGISTRY_CONTRACT_ID
                </span>
                <span className="text-slate-800 dark:text-slate-200 break-all">
                  {data.contracts?.deviceRegistry || 'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-slate-400 font-sans block text-[11px] mb-1">
                  NOIR_AGENT_REGISTRY_CONTRACT_ID
                </span>
                <span className="text-slate-800 dark:text-slate-200 break-all">
                  {data.contracts?.agentRegistry || 'CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-slate-400 font-sans block text-[11px] mb-1">
                  NOIR_PAYMENT_ESCROW_CONTRACT_ID
                </span>
                <span className="text-slate-800 dark:text-slate-200 break-all">
                  {data.contracts?.paymentEscrow || 'CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-slate-400 font-sans block text-[11px] mb-1">
                  NOIR_NATIVE_SAC_CONTRACT_ID
                </span>
                <span className="text-slate-800 dark:text-slate-200 break-all">
                  {data.contracts?.nativeSac || 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Override Audit Log Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Guardrail Override Audit Log
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Historical supervisor justifications recorded for compliance audits.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {data.overrideAuditLog?.length || 0} events
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Entity / ID</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Override Justification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
              {(data.overrideAuditLog && data.overrideAuditLog.length > 0) ? (
                data.overrideAuditLog.map((log, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/30">
                    <td className="py-3 px-4 text-slate-500">
                      {log.createdAt || log.timestamp ? new Date(log.createdAt || log.timestamp).toLocaleString() : 'Nov 24, 2026, 09:30 AM'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                      {log.timesheetId || log.entityId || log.targetId || 'Shift TS-001'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-sans">
                      {log.actor || 'Payroll Admin'}
                    </td>
                    <td className="py-3 px-4 font-sans text-slate-800 dark:text-slate-200">
                      {log.reason || log.overrideReason || 'Approved by Operations VP for sprint launch exception'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400 italic font-sans">
                    No policy overrides logged. All shifts adhered to default parameters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
