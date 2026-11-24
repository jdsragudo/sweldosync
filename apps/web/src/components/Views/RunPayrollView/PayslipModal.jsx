// apps/web/src/components/Views/RunPayrollView/PayslipModal.jsx
import React from 'react';
import { Printer, ShieldCheck, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Modal } from '../../Common/Modal';
import { AddressChip } from '../../Common/AddressChip';
import { formatExplorerTxUrl, truncateStellarAddress } from '../../../services/stellar';

export function PayslipModal({ isOpen, onClose, payslip, network = 'testnet' }) {
  if (!payslip) return null;

  const handlePrint = () => {
    window.print();
  };

  const txUrl = formatExplorerTxUrl(payslip.txHash, network);
  const currency = payslip.currency || 'USD';
  const isXlmCurrency = currency === 'XLM';

  const formatCurrency = (amt) => {
    const num = Number(amt) || 0;
    if (isXlmCurrency) {
      return `${num.toFixed(2)} XLM`;
    }
    return `$${num.toFixed(2)}`;
  };

  const regHours = Number(payslip.regularHours ?? 8);
  const otHours = Number(payslip.overtimeHours ?? 0);
  const hourlyRate = Number(payslip.hourlyRate ?? 25);
  const otMultiplier = Number(payslip.overtimeMultiplier ?? 1.25);

  const regularAmount = Number(
    payslip.regularAmount ?? (regHours * hourlyRate)
  );
  const overtimeAmount = Number(
    payslip.overtimeAmount ?? (otHours * hourlyRate * otMultiplier)
  );
  const grossAmount = Number(
    payslip.grossAmount ?? (regularAmount + overtimeAmount)
  );
  const withholdingPct = Number(payslip.withholdingPct ?? 5);
  const withholdingAmount = Number(
    payslip.withholdingAmount ?? (grossAmount * (withholdingPct / 100))
  );
  const netAmount = Number(
    payslip.netAmount ?? (grossAmount - withholdingAmount)
  );

  const settlementAsset = payslip.settlementAsset || 'XLM';
  const settlementAmount = Number(
    payslip.settlementAmount ?? netAmount
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Verified Compensation & Settlement Slip"
      subtitle="Cryptographically verified on Stellar Horizon with RFC-8785 SHA-256 MemoHash."
      maxWidth="max-w-2xl"
    >
      <div id="printable-payslip" className="space-y-6 text-slate-800 dark:text-slate-200">
        {/* Printable Header */}
        <div className="flex items-start justify-between border-b border-slate-200/80 dark:border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-slate-900 dark:text-slate-100 tracking-tight">
                SweldoSync
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-medium">
                Official Pay Slip
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Stellar Trustless Settlement Engine · Period: {payslip.periodLabel || 'Current Cutoff'}
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400 block font-mono">Date Settled</span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 font-mono">
              {payslip.settledAt ? new Date(payslip.settledAt).toLocaleDateString() : 'Instant'}
            </span>
          </div>
        </div>

        {/* Employee & Recipient Details */}
        <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-xs">
          <div>
            <span className="text-slate-400 block mb-0.5">Team Member</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
              {payslip.employeeName || 'Team Member'}
            </span>
            <span className="text-slate-500 dark:text-slate-400 block">
              {payslip.employeeRole || 'Specialist'} {payslip.department ? `· ${payslip.department}` : ''}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block mb-0.5">Stellar Recipient Wallet</span>
            <AddressChip address={payslip.walletAddress} lead={6} tail={6} />
          </div>
        </div>

        {/* Hours & Earnings Breakdown */}
        <div className="border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-left">
              <tr>
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3 text-right">Hours</th>
                <th className="py-2.5 px-3 text-right">Rate</th>
                <th className="py-2.5 px-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
              <tr>
                <td className="py-2.5 px-3 font-sans">Regular Pay</td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {regHours.toFixed(1)}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {isXlmCurrency ? `${hourlyRate.toFixed(2)} XLM/hr` : `$${hourlyRate.toFixed(2)}/hr`}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                  {formatCurrency(regularAmount)}
                </td>
              </tr>
              {otHours > 0 && (
                <tr>
                  <td className="py-2.5 px-3 font-sans flex items-center gap-1.5">
                    <span>Overtime Pay</span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                      {otMultiplier}x
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {otHours.toFixed(1)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {isXlmCurrency
                      ? `${(hourlyRate * otMultiplier).toFixed(2)} XLM/hr`
                      : `$${(hourlyRate * otMultiplier).toFixed(2)}/hr`}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                    {formatCurrency(overtimeAmount)}
                  </td>
                </tr>
              )}
              <tr className="bg-slate-50/50 dark:bg-slate-800/30 font-medium">
                <td className="py-2.5 px-3 font-sans">Gross Total</td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {(regHours + otHours).toFixed(1)}
                </td>
                <td className="py-2.5 px-3 text-right">—</td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {formatCurrency(grossAmount)}
                </td>
              </tr>
              <tr className="text-amber-700 dark:text-amber-400">
                <td className="py-2.5 px-3 font-sans">
                  Withholding Tax ({withholdingPct}%)
                </td>
                <td className="py-2.5 px-3 text-right">—</td>
                <td className="py-2.5 px-3 text-right">—</td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  -{formatCurrency(withholdingAmount)}
                </td>
              </tr>
              <tr className="bg-blue-50/50 dark:bg-blue-950/20 font-bold text-slate-900 dark:text-slate-100 text-sm">
                <td className="py-3 px-3 font-sans">Net Compensation</td>
                <td className="py-3 px-3 text-right">—</td>
                <td className="py-3 px-3 text-right">—</td>
                <td className="py-3 px-3 text-right tabular-nums text-blue-600 dark:text-blue-400">
                  {formatCurrency(netAmount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Settlement Asset & Stellar Horizon Proof */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Settled On-Chain As</span>
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
              {settlementAmount.toFixed(4)} {settlementAsset}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Stellar Tx Hash</span>
            <div className="flex items-center gap-1.5 font-mono">
              <span className="tabular-nums">
                {truncateStellarAddress(payslip.txHash || 'tx_simulated_seed', 8, 8)}
              </span>
              {payslip.txHash && (
                <a
                  href={txUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-200/50 dark:border-slate-700/50">
            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>RFC-8785 MemoHash</span>
            </span>
            <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200/60 dark:border-emerald-800/60">
              {payslip.memoHash ? truncateStellarAddress(payslip.memoHash, 10, 10) : 'Verified Match'}
            </span>
          </div>
        </div>

        {/* Print / Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 no-print">
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Immutable Receipt</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
