// apps/web/src/components/Common/ToastStack.jsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export function ToastStack() {
  const { toasts, removeToast } = useApp();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => {
          const isSuccess = toast.type === 'success';
          const isWarning = toast.type === 'warning';
          const isError = toast.type === 'error';

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              className={`pointer-events-auto p-4 rounded-xl border shadow-lg flex items-start gap-3 bg-white dark:bg-slate-900 ${
                isSuccess
                  ? 'border-emerald-200 dark:border-emerald-800/80 text-emerald-950 dark:text-emerald-100'
                  : isWarning
                  ? 'border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-100'
                  : isError
                  ? 'border-rose-200 dark:border-rose-800/80 text-rose-950 dark:text-rose-100'
                  : 'border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
                {isWarning && <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
                {isError && <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
                {!isSuccess && !isWarning && !isError && (
                  <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                {toast.title && (
                  <h4 className="text-sm font-semibold leading-tight">{toast.title}</h4>
                )}
                {toast.message && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    {toast.message}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
