// apps/web/src/components/Common/Badge.jsx
import React from 'react';

const VARIANTS = {
  settled: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60',
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60',
  pending: 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60',
  held: 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60',
  warning: 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60',
  blocked: 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/60',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60',
  archived: 'bg-slate-100 text-slate-500 border-slate-200/80 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
};

export function Badge({ variant = 'neutral', children, className = '', dot = false }) {
  const variantClasses = VARIANTS[variant.toLowerCase()] || VARIANTS.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border tracking-tight ${variantClasses} ${className}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            variant === 'settled' || variant === 'ready' || variant === 'active'
              ? 'bg-emerald-500'
              : variant === 'warning' || variant === 'held'
              ? 'bg-amber-500'
              : variant === 'blocked'
              ? 'bg-rose-500'
              : variant === 'pending'
              ? 'bg-blue-500'
              : 'bg-slate-400'
          }`}
        />
      )}
      {children}
    </span>
  );
}
