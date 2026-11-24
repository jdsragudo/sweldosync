// apps/web/src/components/Shell/TopBar.jsx
import React, { useState } from 'react';
import {
  Menu,
  Sun,
  Moon,
  RefreshCw,
  Wallet,
  Lock,
  Unlock,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AddressChip } from '../Common/AddressChip';
import { AdminUnlockModal } from './AdminUnlockModal';

export function TopBar({ setMobileOpen }) {
  const {
    theme,
    toggleTheme,
    network,
    setNetwork,
    freighter,
    connectWallet,
    disconnectWallet,
    adminToken,
    refreshData,
    refreshing,
    addToast,
  } = useApp();

  const [adminModalOpen, setAdminModalOpen] = useState(false);

  const handleNetworkSwitch = (newNet) => {
    if (newNet === 'mainnet' && !adminToken) {
      setAdminModalOpen(true);
      addToast({
        type: 'warning',
        title: 'Admin Token Required for Mainnet',
        message: 'Provide ADMIN_TOKEN to enable real-capital operations on Stellar Mainnet.',
      });
      return;
    }
    setNetwork(newNet);
    addToast({
      type: 'info',
      title: `Switched to Stellar ${newNet === 'mainnet' ? 'Mainnet' : 'Testnet'}`,
      message: newNet === 'mainnet' ? 'Production Horizon RPC' : 'Testnet Horizon & Friendbot active',
    });
  };

  return (
    <header className="h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-20 px-4 sm:px-6 flex items-center justify-between">
      {/* Left section: Hamburger on mobile + View Title */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-900 dark:text-slate-100">SweldoSync</span>
          <span>/</span>
          <span>Fintech Global Payroll</span>
        </div>
      </div>

      {/* Right Controls: Network Switcher + Wallet Control + Theme Toggle + Refresh */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Network Switcher Pill */}
        <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 text-xs">
          <button
            type="button"
            onClick={() => handleNetworkSwitch('testnet')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors ${
              network === 'testnet'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Testnet</span>
          </button>

          <button
            type="button"
            onClick={() => handleNetworkSwitch('mainnet')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors ${
              network === 'mainnet'
                ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {adminToken ? (
              <Unlock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Lock className="w-3 h-3 text-slate-400" />
            )}
            <span>Mainnet</span>
          </button>
        </div>

        {/* Wallet Control */}
        {freighter.isConnected ? (
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-lg px-2 py-1">
            <Wallet className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <AddressChip address={freighter.address} showLink={false} />
            <button
              type="button"
              onClick={disconnectWallet}
              title="Disconnect Freighter"
              className="text-[11px] text-slate-400 hover:text-rose-500 ml-1 font-medium transition-colors p-0.5 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={connectWallet}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Connect Freighter</span>
              <span className="sm:hidden">Connect</span>
            </button>

            {/* Testnet 1-Click Demo Treasury Ready Indicator */}
            {network === 'testnet' && (
              <div
                title="1-Click Demo Treasury is configured on backend. No browser extension required to test!"
                className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-[11px] text-emerald-700 dark:text-emerald-300 font-medium"
              >
                <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>Demo Treasury Ready</span>
              </div>
            )}
          </div>
        )}

        {/* Refresh button */}
        <button
          type="button"
          onClick={() => refreshData()}
          disabled={refreshing}
          title="Refresh Data from Stellar & SQLite"
          className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-600' : ''}`} />
        </button>

        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Daylight' : 'Switch to Obsidian Dark'}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600" />
          )}
        </button>
      </div>

      <AdminUnlockModal isOpen={adminModalOpen} onClose={() => setAdminModalOpen(false)} />
    </header>
  );
}
