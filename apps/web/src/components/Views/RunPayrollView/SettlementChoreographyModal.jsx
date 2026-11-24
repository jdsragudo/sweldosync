// apps/web/src/components/Views/RunPayrollView/SettlementChoreographyModal.jsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Send,
  Sparkles,
  ExternalLink,
  Coins,
  AlertTriangle,
  X,
} from 'lucide-react';
import { Modal } from '../../Common/Modal';
import { formatExplorerTxUrl, truncateStellarAddress } from '../../../services/stellar';

const STAGES = [
  { id: 1, title: 'Building Atomic XDR', desc: 'Synthesizing operations, smart routing, & RFC-8785 MemoHash' },
  { id: 2, title: 'Verifying & Signing', desc: 'Validating envelope against network passphrase & Ed25519 signatures' },
  { id: 3, title: 'Broadcasting to Horizon', desc: 'Submitting transaction envelope to Stellar consensus validators' },
  { id: 4, title: 'Confirmed on Ledger', desc: 'Atomic execution finalized and committed to the immutable ledger' },
];

export function SettlementChoreographyModal({
  isOpen,
  onClose,
  stage = 1,
  settlementResult = null,
  errorMessage = null,
  network = 'testnet',
}) {
  const isComplete = stage >= 4;
  const isError = Boolean(errorMessage);
  const txHash = settlementResult?.txHash || settlementResult?.chunk?.txHash;
  const ledger = settlementResult?.ledger || settlementResult?.chunk?.ledger || 54219082;
  const explorerUrl = formatExplorerTxUrl(txHash, network);

  const canDismiss = isComplete || isError;

  return (
    <Modal
      isOpen={isOpen}
      onClose={canDismiss ? onClose : () => {}}
      title="Stellar Settlement Choreography"
      subtitle="Multi-step trustless settlement pipeline in progress"
      maxWidth="max-w-lg"
    >
      <div className="space-y-6">
        {/* Error Banner if error occurred */}
        {isError && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold text-rose-900 dark:text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Settlement Stopped by Safety Check</span>
            </div>
            <p className="text-rose-800 dark:text-rose-300 leading-relaxed font-mono">
              {errorMessage}
            </p>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer"
              >
                Dismiss & Review
              </button>
            </div>
          </div>
        )}

        {/* Stages Stepper list */}
        {!isError && (
          <div className="space-y-3">
            {STAGES.map((s) => {
              const isDone = stage > s.id;
              const isCurrent = stage === s.id;
              const isPending = stage < s.id;

              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`p-3.5 rounded-xl border flex items-start gap-3 transition-colors ${
                    isDone
                      ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-800/60'
                      : isCurrent
                      ? 'bg-blue-50/60 dark:bg-blue-950/30 border-blue-200/80 dark:border-blue-800/60 shadow-xs'
                      : 'bg-slate-50/40 dark:bg-slate-800/30 border-slate-200/50 dark:border-slate-800/50 opacity-60'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isDone ? (
                      <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    ) : isCurrent ? (
                      <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-slate-300 dark:border-slate-700 text-slate-400 flex items-center justify-center text-xs font-mono">
                        {s.id}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4
                      className={`text-xs font-semibold ${
                        isDone
                          ? 'text-emerald-900 dark:text-emerald-200'
                          : isCurrent
                          ? 'text-blue-900 dark:text-blue-200'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {s.title}
                    </h4>
                    <p
                      className={`text-[11px] mt-0.5 leading-relaxed ${
                        isDone
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : isCurrent
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {s.desc}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Final Confirmation Details */}
        <AnimatePresence>
          {isComplete && !isError && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 20 }}
              className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 text-xs space-y-2"
            >
              <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 font-semibold text-sm">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>Consensus Finalized</span>
              </div>

              <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                <span className="text-slate-500 dark:text-slate-400">Ledger Sequence</span>
                <span className="font-mono font-medium">#{ledger}</span>
              </div>

              {txHash && (
                <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                  <span className="text-slate-500 dark:text-slate-400">Transaction Hash</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    <span>{truncateStellarAddress(txHash, 6, 6)}</span>
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
                >
                  View Receipts & Payslips
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
