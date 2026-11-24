// apps/web/src/components/Shell/AdminUnlockModal.jsx
import React, { useState } from 'react';
import { Shield, Key, Check } from 'lucide-react';
import { Modal } from '../Common/Modal';
import { useApp } from '../../context/AppContext';

export function AdminUnlockModal({ isOpen, onClose }) {
  const { adminToken, setAdminToken, addToast } = useApp();
  const [inputVal, setInputVal] = useState(adminToken);

  const handleSave = (e) => {
    e.preventDefault();
    setAdminToken(inputVal.trim());
    addToast({
      type: 'success',
      title: inputVal.trim() ? 'Admin Session Unlocked' : 'Admin Token Cleared',
      message: inputVal.trim()
        ? 'Admin authentication bearer token is active for Mainnet sign actions.'
        : 'Session reset to unauthenticated.',
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Admin Session Authorization"
      subtitle="Required for Stellar Mainnet broadcasts and protected company policies."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-300">
          <p className="font-medium">Protected Mainnet Guardrail</p>
          <p className="mt-0.5">
            Mainnet XDR building and submission strictly enforce backend Bearer authorization.
            Stored securely in your current browser session only (<code>sessionStorage</code>).
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            ADMIN_TOKEN Secret
          </label>
          <div className="relative">
            <input
              type="password"
              placeholder="Paste admin secret token..."
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <Key className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          {adminToken ? (
            <button
              type="button"
              onClick={() => {
                setAdminToken('');
                setInputVal('');
                addToast({
                  type: 'info',
                  title: 'Admin Token Removed',
                  message: 'Switched to standard read-only session.',
                });
                onClose();
              }}
              className="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 font-medium"
            >
              Clear Session Token
            </button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-xs flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Save & Unlock
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
