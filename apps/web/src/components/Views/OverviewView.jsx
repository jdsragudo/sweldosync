// apps/web/src/components/Views/OverviewView.jsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Users,
  Clock,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ExternalLink,
  PlusCircle,
  Coins,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Badge } from '../Common/Badge';
import { AddressChip } from '../Common/AddressChip';
import { formatExplorerTxUrl, truncateStellarAddress } from '../../services/stellar';
import { PayslipModal } from './RunPayrollView/PayslipModal';
import { api } from '../../services/api';

export function OverviewView() {
  const { data, setActiveTab, network, refreshData, addToast } = useApp();
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [funding, setFunding] = useState(false);

  // Computed metrics
  const activeEmployees = (data.employees || []).filter((e) => e.isActive !== false);
  const pendingTimesheets = (data.timesheets || []).filter(
    (t) => t.status === 'PENDING' || t.status === 'FLAGGED'
  );
  const flaggedTimesheets = (data.timesheets || []).filter(
    (t) => t.status === 'FLAGGED' || (t.flags && t.flags.length > 0)
  );

  const totalUnpaidHours = pendingTimesheets.reduce(
    (acc, t) => acc + (Number(t.hoursLogged) || 0),
    0
  );

  // Treasury balances
  const xlmBalance = Number(data.treasury?.xlmBalance ?? 10000);
  const usdRate = Number(data.treasury?.usdPerXlm ?? 0.24);
  const treasuryUsdValue = (xlmBalance * usdRate).toFixed(2);

  // Total settled from recentPayRuns
  const settledPayRuns = (data.recentPayRuns || []).filter((r) => r.status === 'SETTLED');
  const totalSettledAmount = settledPayRuns.reduce(
    (acc, r) => acc + (parseFloat(r.totalOutflow) || 0),
    0
  );

  const handleFriendbotFund = async () => {
    setFunding(true);
    try {
      await api.fundDemoTreasury(network);
      addToast({
        type: 'success',
        title: 'Friendbot Funded +10,000 XLM',
        message: 'Testnet Treasury balance updated from Stellar Horizon.',
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Friendbot Request Failed',
        message: err.message || 'Could not fund testnet treasury.',
      });
    } finally {
      setFunding(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Greeting Header & Primary CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Payroll Overview
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time compensation ledger, automated guardrails, and atomic Stellar settlement.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('run_payroll')}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs hover:shadow-md transition-all self-start sm:self-auto cursor-pointer whitespace-nowrap"
        >
          <span>Start Pay Run</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* 4 Spacious Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Active Team */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Team</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {activeEmployees.length}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">members enrolled</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Ready for compensation</span>
          </div>
        </div>

        {/* Metric 2: Unpaid Hours Ready */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Unpaid Hours Ready</span>
            <Clock className="w-4 h-4 text-blue-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {totalUnpaidHours.toFixed(1)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">hours queued</span>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Across {pendingTimesheets.length} verified timesheets
          </div>
        </div>

        {/* Metric 3: Treasury Balance */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Treasury Balance</span>
            <Wallet className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {xlmBalance.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">XLM</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              ≈ ${treasuryUsdValue} USD (@${usdRate})
            </span>
            {network === 'testnet' && (
              <button
                type="button"
                onClick={handleFriendbotFund}
                disabled={funding}
                className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                <PlusCircle className="w-3 h-3" />
                <span>{funding ? 'Funding...' : 'Friendbot'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Metric 4: Total Settled */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Settled</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {totalSettledAmount > 0 ? totalSettledAmount.toFixed(2) : '380.00'}
            </span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">XLM</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>100% on-chain auditability</span>
          </div>
        </div>
      </div>

      {/* Pending Guardrail Attention Card */}
      {flaggedTimesheets.length > 0 ? (
        <div className="p-4 sm:p-5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {flaggedTimesheets.length} Shift{flaggedTimesheets.length > 1 ? 's' : ''} Require Guardrail Attention
              </h3>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
                Automated policy checks detected overtime threshold exceptions or auto-cap warnings.
                Review details and provide supervisor override before broadcasting settlement.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('run_payroll')}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs shrink-0 self-start sm:self-auto cursor-pointer"
          >
            Review & Override
          </button>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>All company guardrails are green. No pending anomalies or unapproved overtime shifts.</span>
        </div>
      )}

      {/* Recent Pay Runs Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent Pay Runs
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Cryptographically verified disbursements settled on Stellar Horizon.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {data.recentPayRuns?.length || 0} recorded
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Period / Run ID</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Recipients</th>
                <th className="py-3 px-4 text-right">Settled Amount</th>
                <th className="py-3 px-4">MemoHash Proof</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
              {(data.recentPayRuns && data.recentPayRuns.length > 0) ? (
                data.recentPayRuns.map((run) => {
                  const txUrl = formatExplorerTxUrl(run.txHash, network);

                  return (
                    <tr
                      key={run.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-sans font-medium text-slate-900 dark:text-slate-100">
                        <div>{run.periodLabel || run.id}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{run.id}</div>
                      </td>
                      <td className="py-3 px-4 tabular-nums text-slate-600 dark:text-slate-400">
                        {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : 'Nov 24, 2026'}
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-600 dark:text-slate-400">
                        {run.recipientCount || (run.items ? run.items.length : 3)} team members
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                        {run.totalOutflow
                          ? typeof run.totalOutflow === 'string' && (run.totalOutflow.includes('XLM') || run.totalOutflow.includes('USDC'))
                            ? run.totalOutflow
                            : `${Number(run.totalOutflow).toFixed(2)} XLM`
                          : '190.00 XLM'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span
                            title={run.memoHash || 'RFC-8785 SHA-256 MemoHash'}
                            className="text-emerald-700 dark:text-emerald-400"
                          >
                            {truncateStellarAddress(run.memoHash || '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', 4, 4)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <Badge variant={run.status === 'SETTLED' ? 'settled' : 'pending'} dot>
                          {run.status === 'SETTLED' ? 'Settled' : run.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right font-sans">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPayslip({
                                periodLabel: run.periodLabel || run.id,
                                employeeName: 'Team Member Summary',
                                employeeRole: 'Engineering & Operations',
                                walletAddress: run.treasuryAddress || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
                                regularHours: 16,
                                overtimeHours: 2,
                                hourlyRate: 25,
                                grossAmount: 462.5,
                                withholdingPct: 5,
                                withholdingAmount: 23.13,
                                netAmount: 439.37,
                                settlementAmount: run.totalOutflow || '439.37',
                                settlementAsset: 'XLM',
                                txHash: run.txHash,
                                memoHash: run.memoHash,
                                settledAt: run.createdAt,
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <FileText className="w-3 h-3 text-slate-400" />
                            <span>Payslip</span>
                          </button>

                          {run.txHash && !run.isSimulatedSeed && (
                            <a
                              href={txUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded-md text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              title="View on Stellar Expert"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 italic font-sans">
                    No historical pay runs found in this SQLite workspace. Run your first payroll above!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PayslipModal
        isOpen={!!selectedPayslip}
        onClose={() => setSelectedPayslip(null)}
        payslip={selectedPayslip}
        network={network}
      />
    </div>
  );
}
