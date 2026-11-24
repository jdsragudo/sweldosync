// apps/web/src/components/Views/PeopleView.jsx
import React, { useState } from 'react';
import {
  UserPlus,
  Search,
  Users,
  Edit2,
  Archive,
  RotateCcw,
  Sparkles,
  Wallet,
  Coins,
  ShieldAlert,
  Check,
  Percent,
} from 'lucide-react';
import { Drawer } from '../Common/Drawer';
import { AddressChip } from '../Common/AddressChip';
import { Badge } from '../Common/Badge';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { generateTestWallet } from '../../services/stellar';

export function PeopleView() {
  const { data, refreshData, addToast, network } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'all' | 'active' | 'archived'

  // Drawer states
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);

  // Form state
  const initialFormState = {
    name: '',
    role: '',
    department: 'Engineering',
    hourlyRate: 35,
    currency: 'USD',
    settlementAsset: 'XLM',
    regularHoursCap: 8,
    overtimeMultiplier: 1.25,
    withholdingPct: 5,
    maxAutoPayout: 1000,
    walletAddress: '',
  };
  const [formData, setFormData] = useState(initialFormState);
  const [generatingWallet, setGeneratingWallet] = useState(false);

  // Filter employees
  const employees = data.employees || [];
  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      (emp.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.role || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.department || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.walletAddress || '').toLowerCase().includes(searchTerm.toLowerCase());

    const isEmpActive = emp.isActive !== false;
    if (statusFilter === 'active') return matchesSearch && isEmpActive;
    if (statusFilter === 'archived') return matchesSearch && !isEmpActive;
    return matchesSearch;
  });

  const handleOpenAdd = () => {
    setEditingEmployee(null);
    setFormData(initialFormState);
    setDrawerOpen(true);
  };

  const handleOpenEdit = (emp) => {
    setEditingEmployee(emp);
    setFormData({
      name: emp.name || '',
      role: emp.role || '',
      department: emp.department || 'Engineering',
      hourlyRate: emp.hourlyRate || 35,
      currency: emp.currency || 'USD',
      settlementAsset: emp.settlementAsset || 'XLM',
      regularHoursCap: emp.regularHoursCap || 8,
      overtimeMultiplier: emp.overtimeMultiplier || 1.25,
      withholdingPct: emp.withholdingPct || 5,
      maxAutoPayout: emp.maxAutoPayout || 1000,
      walletAddress: emp.walletAddress || '',
    });
    setDrawerOpen(true);
  };

  const handleGenerateTestWallet = async () => {
    setGeneratingWallet(true);
    try {
      const generated = generateTestWallet();
      setFormData((prev) => ({ ...prev, walletAddress: generated.publicKey }));

      // If testnet, optionally trigger Friendbot funding for this wallet
      if (network === 'testnet') {
        try {
          await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(generated.publicKey)}`);
          addToast({
            type: 'success',
            title: 'Test Wallet Generated & Funded',
            message: `Created ${generated.publicKey.slice(0, 8)}... and funded with 10,000 XLM on Friendbot!`,
          });
        } catch {
          addToast({
            type: 'info',
            title: 'Test Wallet Generated',
            message: `Keypair created: ${generated.publicKey.slice(0, 8)}...`,
          });
        }
      }
    } finally {
      setGeneratingWallet(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingEmployee) {
        await api.updateEmployee(editingEmployee.id, formData);
        addToast({
          type: 'success',
          title: 'Member Profile Updated',
          message: `Saved changes for ${formData.name}.`,
        });
      } else {
        await api.createEmployee(formData);
        addToast({
          type: 'success',
          title: 'Team Member Added',
          message: `${formData.name} enrolled into payroll roster.`,
        });
      }
      setDrawerOpen(false);
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Save Failed',
        message: err.message || 'Could not save employee profile.',
      });
    }
  };

  const handleToggleArchive = async (emp) => {
    const newActiveState = emp.isActive === false;
    try {
      await api.updateEmployee(emp.id, { isActive: newActiveState });
      addToast({
        type: 'info',
        title: newActiveState ? 'Member Restored' : 'Member Archived',
        message: `${emp.name} is now ${newActiveState ? 'active' : 'archived'}.`,
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Action Failed',
        message: err.message,
      });
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Team & Compensation Roster
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Global contributors, individual hourly rates, tax withholding percentages, and Stellar payout addresses.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors self-start sm:self-auto cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add Team Member</span>
        </button>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder="Search by name, role, department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>

        <div className="flex items-center p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-xs self-start sm:self-auto">
          {['active', 'archived', 'all'].map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1 rounded-md font-medium capitalize transition-colors ${
                statusFilter === filter
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Responsive Employee Grid / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredEmployees.length > 0 ? (
          filteredEmployees.map((emp) => {
            const isActive = emp.isActive !== false;

            return (
              <div
                key={emp.id}
                className={`p-5 rounded-xl border bg-white dark:bg-slate-900 shadow-xs flex flex-col justify-between transition-all ${
                  isActive
                    ? 'border-slate-200/80 dark:border-slate-800'
                    : 'border-slate-200/50 dark:border-slate-800/50 opacity-70 bg-slate-50/50 dark:bg-slate-900/50'
                }`}
              >
                <div>
                  {/* Top Bar of Card */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {emp.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {emp.role} {emp.department ? `· ${emp.department}` : ''}
                      </p>
                    </div>
                    <Badge variant={isActive ? 'active' : 'archived'} dot>
                      {isActive ? 'Active' : 'Archived'}
                    </Badge>
                  </div>

                  {/* Compensation Stats */}
                  <div className="grid grid-cols-2 gap-2 my-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800/80 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Hourly Rate</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        ${emp.hourlyRate}/hr
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Settlement Asset</span>
                      <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {emp.settlementAsset || 'XLM'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Withholding</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {emp.withholdingPct || 5}%
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Auto Payout Cap</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        ${emp.maxAutoPayout || 1000}
                      </span>
                    </div>
                  </div>

                  {/* Recipient Wallet Chip */}
                  <div className="space-y-1 mb-4">
                    <span className="text-[11px] text-slate-400 block">Stellar Payout Address</span>
                    <AddressChip address={emp.walletAddress} lead={6} tail={6} />
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleToggleArchive(emp)}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  >
                    {isActive ? (
                      <>
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archive</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restore</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEdit(emp)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Profile</span>
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-full py-12 text-center text-slate-400 italic">
            No team members found matching your search.
          </div>
        )}
      </div>

      {/* Slide-over Right Drawer for Add / Edit */}
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingEmployee ? `Edit ${editingEmployee.name}` : 'Add New Team Member'}
        subtitle="Configure compensation structure and Stellar recipient public key."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Full Legal Name
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Maria Santos"
              className="w-full px-3 py-2 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Role / Title
              </label>
              <input
                type="text"
                required
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                placeholder="e.g. Frontend Engineer"
                className="w-full px-3 py-2 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Department
              </label>
              <input
                type="text"
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                placeholder="e.g. Engineering"
                className="w-full px-3 py-2 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Hourly Base Rate (USD)
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                required
                value={formData.hourlyRate}
                onChange={(e) => setFormData({ ...formData, hourlyRate: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Settlement Asset
              </label>
              <select
                value={formData.settlementAsset}
                onChange={(e) => setFormData({ ...formData, settlementAsset: e.target.value })}
                className="w-full px-3 py-2 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="XLM">Native Stellar (XLM)</option>
                <option value="USDC">Circle USDC</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tax Withholding (%)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="50"
                value={formData.withholdingPct}
                onChange={(e) => setFormData({ ...formData, withholdingPct: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Max Auto Payout Cap ($)
              </label>
              <input
                type="number"
                step="50"
                min="100"
                value={formData.maxAutoPayout}
                onChange={(e) => setFormData({ ...formData, maxAutoPayout: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Wallet Input + Generate Test Wallet Helper */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Stellar Recipient Wallet (Public Key)
              </label>
              {network === 'testnet' && (
                <button
                  type="button"
                  onClick={handleGenerateTestWallet}
                  disabled={generatingWallet}
                  className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{generatingWallet ? 'Generating...' : 'Generate & Fund Test Wallet'}</span>
                </button>
              )}
            </div>

            <input
              type="text"
              required
              placeholder="G..."
              value={formData.walletAddress}
              onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value.trim() })}
              className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Ed25519 Stellar public key starting with G. Funds are disbursed directly to this address.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer"
            >
              {editingEmployee ? 'Save Changes' : 'Enroll Team Member'}
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
