// apps/web/src/components/Shell/Sidebar.jsx
import React from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  PlayCircle,
  Users,
  Clock,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export function Sidebar({ mobileOpen, setMobileOpen }) {
  const { activeTab, setActiveTab, data, network } = useApp();

  const pendingTimesheetsCount = (data.timesheets || []).filter(
    (t) => t.status === 'PENDING' || t.status === 'FLAGGED'
  ).length;

  const activeEmployeesCount = (data.employees || []).filter(
    (e) => e.isActive !== false
  ).length;

  const navItems = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'run_payroll',
      label: 'Run Payroll',
      icon: PlayCircle,
      badge: pendingTimesheetsCount > 0 ? pendingTimesheetsCount : null,
      badgeVariant: 'warning',
    },
    {
      id: 'people',
      label: 'People',
      icon: Users,
      badge: activeEmployeesCount,
      badgeVariant: 'neutral',
    },
    {
      id: 'timesheets',
      label: 'Timesheets',
      icon: Clock,
      badge: pendingTimesheetsCount > 0 ? pendingTimesheetsCount : null,
      badgeVariant: 'neutral',
    },
    {
      id: 'settings',
      label: 'Treasury & Settings',
      icon: ShieldCheck,
      badge: null,
    },
  ];

  const handleNavClick = (id) => {
    setActiveTab(id);
    if (mobileOpen && setMobileOpen) {
      setMobileOpen(false);
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-xs md:hidden"
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 flex flex-col transition-transform duration-200 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand Mark */}
        <div className="h-16 px-6 flex items-center border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-900 dark:text-slate-100 tracking-tight text-base">
                  SweldoSync
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60">
                  2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Stellar Global Payroll
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`relative w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/60 dark:hover:bg-slate-800/60'
                }`}
              >
                {/* Active Indicator Spring */}
                {isActive && (
                  <motion.div
                    layoutId="activeNavIndicator"
                    className="absolute inset-0 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/60 rounded-lg -z-0"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}

                <div className="flex items-center gap-3 relative z-10">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge !== null && (
                  <span
                    className={`relative z-10 px-2 py-0.5 rounded-full text-xs font-mono font-medium ${
                      item.badgeVariant === 'warning'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Network & Protocol Details Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Protocol</span>
            <span className="font-mono text-slate-700 dark:text-slate-300">Soroban + Horizon</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Runtime</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
              <span
                className={`w-2 h-2 rounded-full ${
                  network === 'mainnet' ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
              <span className="capitalize">{network}</span>
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
