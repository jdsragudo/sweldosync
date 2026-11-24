// apps/web/src/context/AppContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import {
  checkFreighterInstalled,
  connectFreighter as freighterConnect,
  truncateStellarAddress,
} from '../services/stellar';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // 1. Theme State (persisted in localStorage)
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('sweldosync_theme') || 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('sweldosync_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // 2. Navigation State
  const [activeTab, setActiveTab] = useState('overview');

  // 3. Network State
  const [network, setNetworkState] = useState('testnet'); // 'testnet' | 'mainnet'

  // 4. Admin Token State (persisted in sessionStorage)
  const [adminToken, setAdminTokenState] = useState(() => {
    return sessionStorage.getItem('sweldosync_admin_token') || '';
  });

  const setAdminToken = (token) => {
    if (token) {
      sessionStorage.setItem('sweldosync_admin_token', token);
      setAdminTokenState(token);
    } else {
      sessionStorage.removeItem('sweldosync_admin_token');
      setAdminTokenState('');
    }
  };

  // 5. Freighter Wallet State
  const [freighter, setFreighter] = useState({
    isInstalled: false,
    isConnected: false,
    address: null,
    network: null,
  });

  useEffect(() => {
    checkFreighterInstalled().then((isInstalled) => {
      setFreighter((prev) => ({ ...prev, isInstalled }));
    });
  }, []);

  const connectWallet = async () => {
    try {
      const details = await freighterConnect();
      setFreighter((prev) => ({
        ...prev,
        isConnected: true,
        address: details.address,
        network: details.network,
      }));
      addToast({
        type: 'success',
        title: 'Wallet Connected',
        message: `Connected Freighter address ${truncateStellarAddress(details.address)}`,
      });
      return details;
    } catch (err) {
      addToast({
        type: 'warning',
        title: 'Freighter Not Connected',
        message: err.message || 'Could not connect to Freighter wallet.',
      });
      throw err;
    }
  };

  const disconnectWallet = () => {
    setFreighter((prev) => ({
      ...prev,
      isConnected: false,
      address: null,
      network: null,
    }));
    addToast({
      type: 'info',
      title: 'Wallet Disconnected',
      message: 'Freighter session cleared.',
    });
  };

  // 6. Toasts State
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback(({ type = 'info', title, message, duration = 4000 }) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 7);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // 7. Core Application Data (Bootstrap)
  const [data, setData] = useState({
    employees: [],
    timesheets: [],
    policy: {
      standardWorkHours: 8,
      maxShiftHours: 16,
      overtimeMultiplier: 1.25,
      defaultWithholdingPct: 5,
      defaultMaxAutoPayout: 1000,
    },
    treasury: {
      address: '',
      publicKey: '',
      xlmBalance: 10000,
      usdcBalance: 5000,
      balances: [
        { asset_type: 'native', balance: '10000.0000000' },
        { asset_code: 'USDC', balance: '5000.0000000' },
      ],
      isFunded: true,
      usdPerXlm: 0.24,
    },
    recentPayRuns: [],
    payRuns: [],
    overrideAuditLog: [],
    contracts: {
      noirVerifier: 'CBX...NOIR',
      payrollEngine: 'CDY...ENGINE',
      deviceRegistry: 'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5',
      agentRegistry: 'CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV',
      paymentEscrow: 'CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS',
      nativeSac: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    },
    storageNotice: 'Local SQLite Database active',
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refreshData = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const bootstrap = await api.getBootstrap(network);

      // 1. Normalize Treasury & FX
      const treasuryRaw = bootstrap.treasury || {};
      const fxRate = Number(bootstrap.fx?.usdPerXlm ?? treasuryRaw.usdPerXlm ?? 0.24);
      const xlmBal = Number(treasuryRaw.xlmBalance ?? treasuryRaw.availableXlm ?? 0);
      const usdcBal = Number(treasuryRaw.usdcBalance ?? 0);
      const treasuryAddr = treasuryRaw.address || treasuryRaw.publicKey || '';

      const normalizedTreasury = {
        address: treasuryAddr,
        publicKey: treasuryAddr,
        xlmBalance: xlmBal,
        usdcBalance: usdcBal,
        balances: [
          { asset_type: 'native', balance: xlmBal.toFixed(7) },
          { asset_code: 'USDC', balance: usdcBal.toFixed(7) },
        ],
        isFunded: xlmBal > 0,
        usdPerXlm: fxRate,
      };

      // 2. Normalize Pay Runs
      const rawPayRuns = bootstrap.payRuns || bootstrap.recentPayRuns || [];
      const normalizedPayRuns = rawPayRuns.map((run) => {
        const xlmOutflow = Number(run.totalSettlementXlm || run.totalOutflow || 0);
        const usdcOutflow = Number(run.totalSettlementUsdc || 0);
        const totalOutflow =
          xlmOutflow > 0
            ? `${xlmOutflow.toFixed(2)} XLM`
            : usdcOutflow > 0
            ? `${usdcOutflow.toFixed(2)} USDC`
            : run.totalOutflow || '190.00 XLM';

        const txHash = run.txHash || run.chunks?.[0]?.txHash;
        const memoHash = run.memoHashHex || run.chunks?.[0]?.memoHashHex || run.memoHash;
        const explorerUrl = run.explorerUrl || run.chunks?.[0]?.explorerUrl;

        return {
          ...run,
          totalOutflow,
          txHash,
          memoHash,
          explorerUrl,
          recipientCount: run.recipientCount || run.items?.length || 3,
        };
      });

      // 3. Normalize Timesheets
      const rawTimesheets = bootstrap.timesheets || [];
      const normalizedTimesheets = rawTimesheets.map((t) => {
        const flags = t.flags || t.guardrail?.flags || [];
        const isOverridden = Boolean(
          t.isOverridden || t.overrideReason || t.overrideStatus === 'APPROVED'
        );
        const overrideReason = t.overrideReason || t.overrideAudit?.reason || '';
        const guardrailStatus = t.guardrail?.status || t.status || 'READY';

        let status = t.status || 'READY';
        if (status !== 'PAID' && status !== 'HELD') {
          if (flags.length > 0 && !isOverridden) {
            status = 'FLAGGED';
          } else {
            status = 'READY';
          }
        }

        return {
          ...t,
          flags,
          isOverridden,
          overrideReason,
          guardrailStatus,
          status,
          calculation: t.calculation || t.guardrail?.calculation,
        };
      });

      // 4. Normalize Contracts
      const contractsRaw = bootstrap.contracts || {};
      const normalizedContracts = {
        noirVerifier: contractsRaw.DEVICE_REGISTRY || contractsRaw.noirVerifier || 'CBX...NOIR',
        payrollEngine: contractsRaw.PAYMENT_ESCROW || contractsRaw.payrollEngine || 'CDY...ENGINE',
        deviceRegistry: contractsRaw.DEVICE_REGISTRY || 'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5',
        agentRegistry: contractsRaw.AGENT_REGISTRY || 'CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV',
        paymentEscrow: contractsRaw.PAYMENT_ESCROW || 'CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS',
        nativeSac: contractsRaw.NATIVE_SAC || 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      };

      setData((prev) => ({
        ...prev,
        ...bootstrap,
        treasury: normalizedTreasury,
        payRuns: normalizedPayRuns,
        recentPayRuns: normalizedPayRuns,
        timesheets: normalizedTimesheets,
        contracts: normalizedContracts,
        employees: bootstrap.employees || prev.employees,
        policy: bootstrap.policy || prev.policy,
        overrideAuditLog: bootstrap.overrideAuditLog || prev.overrideAuditLog,
      }));
    } catch (err) {
      console.warn('Bootstrap fetch failed; keeping active data state:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [network]);

  useEffect(() => {
    refreshData();
  }, [refreshData, network]);

  const value = {
    theme,
    toggleTheme,
    activeTab,
    setActiveTab,
    network,
    setNetwork: setNetworkState,
    adminToken,
    setAdminToken,
    freighter,
    connectWallet,
    disconnectWallet,
    toasts,
    addToast,
    removeToast,
    data,
    loading,
    refreshing,
    refreshData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
