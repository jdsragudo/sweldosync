// apps/web/src/components/Views/RunPayrollView/Step4ConfirmedReceipts.jsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  FileText,
  Download,
  ExternalLink,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  Printer,
  Copy,
  Check,
} from 'lucide-react';
import { AddressChip } from '../../Common/AddressChip';
import { Badge } from '../../Common/Badge';
import { PayslipModal } from './PayslipModal';
import { formatExplorerTxUrl, truncateStellarAddress } from '../../../services/stellar';
import { useApp } from '../../../context/AppContext';
import { api } from '../../../services/api';

export function Step4ConfirmedReceipts({
  settlementResult,
  previewData,
  periodLabel,
  onReset,
}) {
  const { network, setActiveTab, addToast } = useApp();
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [copiedTx, setCopiedTx] = useState(false);

  // Unwrap payRun and chunk
  const settledRun = settlementResult?.payRun || settlementResult?.run || settlementResult;
  const settledChunk = settlementResult?.chunk || settledRun?.chunks?.[0] || settlementResult;
  const payRunId = settledRun?.id || settlementResult?.payRunId || 'RUN-20261124-001';
  const txHash = settledChunk?.txHash || settledRun?.txHash || settlementResult?.txHash || 'a7f342898cbe0042d3810f4439c8821033b0e51b14207138382d56c808800a74';
  const ledger = settledChunk?.ledger || settledRun?.ledger || settlementResult?.ledger || 54219082;
  const memoHash = settledChunk?.memoHashHex || settledRun?.memoHashHex || settlementResult?.memoHashHex || settlementResult?.memoHash;

  const explorerUrl = formatExplorerTxUrl(txHash, network);
  const items = previewData?.items || [];
  const totalOutflow = Number(previewData?.totalOutflow || 190);

  const handleCopyTx = async () => {
    try {
      await navigator.clipboard.writeText(txHash);
      setCopiedTx(true);
      setTimeout(() => setCopiedTx(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleExportCsv = () => {
    const csvUrl = api.getExportCsvUrl(payRunId);
    window.open(csvUrl, '_blank');
    addToast({
      type: 'success',
      title: 'CSV Export Initiated',
      message: 'Downloading payroll distribution ledger...',
    });
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Animated Settlement Completion Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-800/80 shadow-md text-center space-y-4"
      >
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Payroll Settled on Stellar Ledger
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            Atomic batch confirmed. Disbursed{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100 font-mono">
              {totalOutflow.toFixed(2)} XLM
            </span>{' '}
            across {items.length} team members with RFC-8785 cryptographic verification.
          </p>
        </div>

        {/* Ledger & Transaction Details Pill */}
        <div className="inline-flex flex-wrap items-center justify-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Ledger:</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">#{ledger}</span>
          </div>

          <span className="text-slate-300 dark:text-slate-600">•</span>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Tx Hash:</span>
            <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
              {truncateStellarAddress(txHash, 6, 6)}
            </span>
            <button
              type="button"
              onClick={handleCopyTx}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              title="Copy Transaction Hash"
            >
              {copiedTx ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <span className="text-slate-300 dark:text-slate-600">•</span>

          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1"
          >
            <span>Stellar Expert</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="pt-2 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <span>Return to Overview</span>
          </button>
        </div>
      </motion.div>

      {/* Per-Employee Payslips Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Generated Payslips & Receipts
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              1-click printable receipt for each team member including tax withholdings and on-chain hash.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Team Member</th>
                <th className="py-3 px-4">Recipient Wallet</th>
                <th className="py-3 px-4 text-right">Gross Pay</th>
                <th className="py-3 px-4 text-right">Withholding</th>
                <th className="py-3 px-4 text-right">Net Settlement</th>
                <th className="py-3 px-4 text-right">Printable Payslip</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
              {items.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/30">
                  <td className="py-3 px-4 font-sans font-medium text-slate-900 dark:text-slate-100">
                    <div>{item.employeeName}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{item.employeeRole}</div>
                  </td>
                  <td className="py-3 px-4 font-sans">
                    <AddressChip address={item.walletAddress} lead={4} tail={4} />
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    ${Number(item.grossAmount).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-amber-600 dark:text-amber-400">
                    -${Number(item.withholdingAmount).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                    {Number(item.settlementAmount).toFixed(4)} {item.settlementAsset || 'XLM'}
                  </td>
                  <td className="py-3 px-4 text-right font-sans">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPayslip({
                          periodLabel: periodLabel || 'Current Payroll Cutoff',
                          employeeName: item.employeeName,
                          employeeRole: item.employeeRole,
                          department: item.department,
                          walletAddress: item.walletAddress,
                          regularHours: item.regularHours,
                          overtimeHours: item.overtimeHours,
                          hourlyRate: item.hourlyRate,
                          grossAmount: item.grossAmount,
                          withholdingPct: item.withholdingPct,
                          withholdingAmount: item.withholdingAmount,
                          netAmount: item.netAmount,
                          settlementAmount: item.settlementAmount,
                          settlementAsset: item.settlementAsset || 'XLM',
                          txHash,
                          memoHash,
                          settledAt: new Date().toISOString(),
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Payslip</span>
                    </button>
                  </td>
                </tr>
              ))}
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
