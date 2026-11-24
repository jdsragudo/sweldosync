// apps/web/src/App.jsx
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/Shell/Sidebar';
import { TopBar } from './components/Shell/TopBar';
import { ToastStack } from './components/Common/ToastStack';

import { OverviewView } from './components/Views/OverviewView';
import { RunPayrollView } from './components/Views/RunPayrollView/RunPayrollView';
import { PeopleView } from './components/Views/PeopleView';
import { TimesheetsView } from './components/Views/TimesheetsView';
import { TreasurySettingsView } from './components/Views/TreasurySettingsView';

function MainAppShell() {
  const { activeTab, loading } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090D16] text-slate-900 dark:text-slate-100 flex flex-col md:flex-row transition-colors duration-200">
      {/* Sidebar */}
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

      {/* Main App Layout */}
      <div className="flex-1 flex flex-col md:pl-64 min-w-0">
        <TopBar setMobileOpen={setMobileOpen} />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-full overflow-x-hidden">
          <AnimatePresence mode="wait">
            {activeTab === 'overview' && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <OverviewView />
              </motion.div>
            )}

            {activeTab === 'run_payroll' && (
              <motion.div
                key="run_payroll"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <RunPayrollView />
              </motion.div>
            )}

            {activeTab === 'people' && (
              <motion.div
                key="people"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <PeopleView />
              </motion.div>
            )}

            {activeTab === 'timesheets' && (
              <motion.div
                key="timesheets"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <TimesheetsView />
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <TreasurySettingsView />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <ToastStack />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainAppShell />
    </AppProvider>
  );
}
